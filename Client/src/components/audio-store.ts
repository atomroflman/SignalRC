import { useCallback, useEffect, useState } from 'react';
import type { HubConnection } from '@microsoft/signalr';
import { create } from 'zustand';

// Shared push-to-talk state: the vehicle audio player mutes while the driver talks (half-duplex),
// so the driver doesn't hear their own voice coming back through the vehicle mic.
type PushToTalkState = {
  talking: boolean;
  setTalking: (talking: boolean) => void;
};

export const usePushToTalkStore = create<PushToTalkState>((set) => ({
  talking: false,
  setTalking: (talking) => set({ talking }),
}));

/** Car-level audio settings as stored on the server (SignalRC.Shared.Audio.AudioSettings). */
export type CarAudioSettings = {
  inputDevice: string | null;
  inputChannel: 'mix' | 'left' | 'right';
  inputGain: number;
  denoise: boolean;
  bitrateKbps: number;
  outputDevice: string | null;
  outputVolume: number;
  muteInputWhileTalking: boolean;
};

export const DEFAULT_CAR_AUDIO_SETTINGS: CarAudioSettings = {
  inputDevice: null,
  inputChannel: 'mix',
  inputGain: 1,
  denoise: false,
  bitrateKbps: 32,
  outputDevice: null,
  outputVolume: 1,
  muteInputWhileTalking: true,
};

/**
 * Car-level audio settings. `inputDevice` null hides listening, `outputDevice` null hides
 * push-to-talk. `settings` is undefined while loading.
 */
export function useCarAudioSettings(carId?: number) {
  const [settings, setSettings] = useState<CarAudioSettings | undefined>(undefined);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (carId == null) {
      setSettings(undefined);
      return;
    }
    let cancelled = false;
    fetch(`/api/cars/${carId}/channels/audio-settings`)
      .then((r) => (r.ok ? r.json() : null))
      .then((loaded) => {
        if (!cancelled) setSettings({ ...DEFAULT_CAR_AUDIO_SETTINGS, ...(loaded ?? {}) });
      })
      .catch(() => {
        if (!cancelled) setSettings({ ...DEFAULT_CAR_AUDIO_SETTINGS });
      });
    return () => {
      cancelled = true;
    };
  }, [carId, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  return {
    settings,
    inputDevice: settings?.inputDevice ?? null,
    outputDevice: settings?.outputDevice ?? null,
    reload,
  };
}

/** Per-browser number preference (volume, gain) in localStorage; blocked storage just isn't remembered. */
export function useStoredNumber(key: string, fallback: number) {
  const [value, setValue] = useState(fallback);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      const parsed = raw == null ? NaN : Number(raw);
      if (Number.isFinite(parsed)) setValue(parsed);
    } catch {
      // Storage blocked (private mode).
    }
  }, [key]);

  const update = useCallback(
    (next: number) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, String(next));
      } catch {
        // Storage blocked (private mode).
      }
    },
    [key],
  );

  return [value, update] as const;
}

/** Live audio state reported by the Onboard (SignalRC.Shared.Audio.AudioStatus). Levels in dBFS, null = silent. */
export type CarAudioStatus = {
  uplinkRunning: boolean;
  inputLevelDb: number | null;
  inputMuted: boolean;
  outputOpen: boolean;
  outputLevelDb: number | null;
  talking: boolean;
  outputVolume: number;
  sounds: string[];
};

type AudioStatusState = { statusByCar: Record<number, CarAudioStatus | null> };

const useAudioStatusStore = create<AudioStatusState>(() => ({ statusByCar: {} }));

// One shared hub connection for all status subscribers on the page, ref-counted per car.
let statusConnection: Promise<HubConnection> | null = null;
const statusRefs = new Map<number, number>();

function setStatus(carId: number, status: CarAudioStatus | null) {
  useAudioStatusStore.setState((state) => ({ statusByCar: { ...state.statusByCar, [carId]: status } }));
}

async function subscribeStatus(connection: HubConnection, carId: number) {
  const last = (await connection.invoke('SubscribeToAudioStatus', carId)) as CarAudioStatus | null;
  setStatus(carId, last ?? null);
}

function getStatusConnection(): Promise<HubConnection> {
  if (!statusConnection) {
    statusConnection = (async () => {
      const signalR = await import('@microsoft/signalr');
      const connection = new signalR.HubConnectionBuilder().withUrl('/hubs/connection').withAutomaticReconnect().build();
      connection.on('AudioStatusUpdated', (carId: number, status: CarAudioStatus) => setStatus(carId, status));
      // Groups don't survive a reconnect: subscribe again.
      connection.onreconnected(() => {
        for (const carId of statusRefs.keys()) void subscribeStatus(connection, carId).catch(() => {});
      });
      await connection.start();
      return connection;
    })().catch((err) => {
      statusConnection = null;
      throw err;
    });
  }
  return statusConnection;
}

/**
 * Live audio status of a car (levels, talking, speaker volume). undefined until the first answer,
 * null when the car hasn't reported anything yet.
 */
export function useCarAudioStatus(carId?: number): CarAudioStatus | null | undefined {
  const status = useAudioStatusStore((state) => (carId == null ? undefined : state.statusByCar[carId]));

  useEffect(() => {
    if (carId == null) return;
    statusRefs.set(carId, (statusRefs.get(carId) ?? 0) + 1);
    void getStatusConnection()
      .then((connection) => subscribeStatus(connection, carId))
      .catch(() => {});
    return () => {
      const remaining = (statusRefs.get(carId) ?? 1) - 1;
      if (remaining > 0) {
        statusRefs.set(carId, remaining);
        return;
      }
      statusRefs.delete(carId);
      void getStatusConnection()
        .then((connection) => connection.invoke('UnsubscribeFromAudioStatus', carId))
        .catch(() => {});
    };
  }, [carId]);

  return status;
}
