import { create } from 'zustand';
import type { HubConnection } from '@microsoft/signalr';

type CarUiStateModel = {
  id: string;
  isConnected: boolean;
  driverId?: string | null;
  driverName?: string | null;
};

type CarUiState = {
  states: Record<number, CarUiStateModel>;
  isConnected: boolean;
  /** Counts OnboardVersionChanged events and reconnects; version views reload when it changes. */
  versionEpoch: number;
  connect: () => Promise<void>;
};

let _connection: HubConnection | null = null;
let _connectPromise: Promise<void> | null = null;

function toStateMap(states: CarUiStateModel[]): Record<number, CarUiStateModel> {
  return states.reduce<Record<number, CarUiStateModel>>((accumulator, state) => {
    const id = Number(state.id);
    if (Number.isInteger(id)) {
      accumulator[id] = state;
    }
    return accumulator;
  }, {});
}

export const useCarUiStore = create<CarUiState>((set) => ({
  states: {},
  isConnected: false,
  versionEpoch: 0,

  async connect() {
    if (_connection) {
      return;
    }

    if (_connectPromise) {
      return _connectPromise;
    }

    _connectPromise = (async () => {
      const signalR = await import('@microsoft/signalr');
      const connection = new signalR.HubConnectionBuilder()
        .withUrl('/hubs/connection')
        .withAutomaticReconnect()
        .build();

      connection.on('CarStateUpdated', (state: CarUiStateModel) => {
        const id = Number(state.id);
        if (!Number.isInteger(id)) {
          return;
        }

        set(currentState => ({
          states: {
            ...currentState.states,
            [id]: state,
          },
        }));
      });

      // The onboard reported its version or disconnected: GET version-sync has news.
      connection.on('OnboardVersionChanged', () => {
        set(currentState => ({ versionEpoch: currentState.versionEpoch + 1 }));
      });

      connection.onclose(() => {
        set({ isConnected: false });
      });

      connection.onreconnected(async () => {
        set({ isConnected: true });
        const snapshot = await connection.invoke('UiClientConnected') as CarUiStateModel[];
        // Events may have been missed while reconnecting.
        set(currentState => ({ states: toStateMap(snapshot), versionEpoch: currentState.versionEpoch + 1 }));
      });

      await connection.start();
      const snapshot = await connection.invoke('UiClientConnected') as CarUiStateModel[];
      _connection = connection;
      set({
        isConnected: true,
        states: toStateMap(snapshot),
      });
    })().finally(() => {
      _connectPromise = null;
    });

    return _connectPromise;
  },
}));