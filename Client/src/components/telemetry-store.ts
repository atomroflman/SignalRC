import { create } from "zustand";
import type { HubConnection } from "@microsoft/signalr";

export interface TelemetryChannel {
  id: number;
  channelName: string;
  subscribed: boolean;
}

export interface TelemetryEntry {
  name: string;
  value: string;
  updatedAt: number;
}

export interface TelemetryState {
  availableChannels: TelemetryChannel[];
  subscribedChannels: Set<string>;
  entries: TelemetryEntry[];
  isConnected: boolean;
  carId: number | undefined;
  connect: (carId: number) => Promise<void>;
  disconnect: () => Promise<void>;
  subscribeChannel: (channelName: string) => Promise<void>;
  unsubscribeChannel: (channelName: string) => Promise<void>;
}

let _connection: HubConnection | null = null;
let _carIdStr: string | null = null;

function upsertEntry(entries: TelemetryEntry[], entry: TelemetryEntry): TelemetryEntry[] {
  const idx = entries.findIndex((e) => e.name === entry.name);
  if (idx !== -1) {
    const updated = [...entries];
    updated[idx] = entry;
    return updated;
  }
  return [...entries, entry];
}

export const useTelemetryStore = create<TelemetryState>((set, get) => ({
  availableChannels: [],
  subscribedChannels: new Set<string>(),
  entries: [],
  isConnected: false,
  carId: undefined,

  async connect(carId: number) {
    const state = get();
    if (state.carId === carId && _connection) return;

    if (_connection) {
      await get().disconnect();
    }

    const carIdStr = carId.toString();
    _carIdStr = carIdStr;

    const [channelsRes, signalR] = await Promise.all([
      fetch(`/api/car/${carId}/telemetry`),
      import("@microsoft/signalr"),
    ]);

    const channels: TelemetryChannel[] = channelsRes.ok ? await channelsRes.json() : [];
    const savedSubscriptions = channels.filter((c) => c.subscribed).map((c) => c.channelName);

    const connection = new signalR.HubConnectionBuilder()
      .withUrl("/hubs/connection")
      .withAutomaticReconnect()
      .build();

    connection.on("UpdateTelemetry", (valueName: string, value: string) => {
      const { subscribedChannels } = get();
      if (!subscribedChannels.has(valueName)) return;
      set({ entries: upsertEntry(get().entries, { name: valueName, value, updatedAt: Date.now() }) });
    });

    connection.onclose(() => set({ isConnected: false }));

    connection.onreconnected(async () => {
      set({ isConnected: true });
      if (_carIdStr) {
        await connection.invoke("SubscribeToCarTelemetry", _carIdStr);
        for (const ch of get().subscribedChannels) {
          await connection.invoke("SubscribeToChannel", _carIdStr, ch);
        }
      }
    });

    await connection.start();
    _connection = connection;

    await connection.invoke("SubscribeToCarTelemetry", carIdStr);

    const subscribedSet = new Set<string>(savedSubscriptions);
    set({
      availableChannels: channels,
      subscribedChannels: subscribedSet,
      entries: [],
      isConnected: true,
      carId,
    });

    for (const ch of savedSubscriptions) {
      await connection.invoke("SubscribeToChannel", carIdStr, ch);
    }
  },

  async disconnect() {
    const { subscribedChannels } = get();
    if (_connection && _carIdStr) {
      for (const ch of subscribedChannels) {
        await _connection.invoke("UnsubscribeFromChannel", _carIdStr, ch).catch(() => {});
      }
      await _connection.invoke("UnsubscribeFromCarTelemetry", _carIdStr).catch(() => {});
    }
    if (_connection) {
      await _connection.stop().catch(() => {});
      _connection = null;
    }
    _carIdStr = null;
    set({
      availableChannels: [],
      subscribedChannels: new Set<string>(),
      entries: [],
      isConnected: false,
      carId: undefined,
    });
  },

  async subscribeChannel(channelName: string) {
    if (!_connection || !_carIdStr) return;
    const { subscribedChannels, carId } = get();
    if (subscribedChannels.has(channelName)) return;

    await _connection.invoke("SubscribeToChannel", _carIdStr, channelName);
    const next = new Set(subscribedChannels);
    next.add(channelName);
    set({ subscribedChannels: next });
  },

  async unsubscribeChannel(channelName: string) {
    if (!_connection || !_carIdStr) return;
    const { subscribedChannels, carId } = get();
    if (!subscribedChannels.has(channelName)) return;

    await _connection.invoke("UnsubscribeFromChannel", _carIdStr, channelName);
    const next = new Set(subscribedChannels);
    next.delete(channelName);
    set({
      subscribedChannels: next,
      entries: get().entries.filter((e) => e.name !== channelName),
    });
  },
}));
