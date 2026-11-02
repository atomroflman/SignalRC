import { create } from "zustand";
import { sharedSourceHub, type CarSourceProvider, type InvalidReason, type Requirement, type ValueState } from "./overlay/sources";

// The manual telemetry bar is one consumer of the shared live sources
// (Shared/Overlay/telemetry/README.md §6): it asks only for the personally
// selected channels and shows only those. The hub connection belongs to the
// shared sources, not to this bar. The saved selection changes only by an
// explicit toggle (SubscribeToChannel/UnsubscribeFromChannel).

export interface TelemetryChannel {
  id: number;
  channelName: string;
  subscribed: boolean;
  unit?: string | null;
  decimals?: number | null;
}

export interface TelemetryEntry {
  name: string;
  state: ValueState;
  value?: string;
  reason?: InvalidReason;
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

const CONSUMER = "manual-telemetry-bar";

let _car: { provider: CarSourceProvider; release(): void } | null = null;
let _requirement: Requirement | null = null;
let _unsubscribe: (() => void) | null = null;
let _selectionLoaded = false;

function sameEntries(a: TelemetryEntry[], b: TelemetryEntry[]) {
  return a.length === b.length && a.every((e, i) => e.name === b[i].name && e.state === b[i].state && e.value === b[i].value && e.reason === b[i].reason);
}

export const useTelemetryStore = create<TelemetryState>((set, get) => {
  const requireSelection = () => {
    if (!_car) return;
    const deps = [...get().subscribedChannels].map((name) => ({ kind: "tel" as const, name }));
    _requirement = _car.provider.require(CONSUMER, deps);
  };

  const refresh = () => {
    const provider = _car?.provider;
    if (!provider) return;
    const patch: Partial<TelemetryState> = {};
    const channels = provider.channels();
    const available = get().availableChannels;
    if (channels.length !== available.length || channels.some((c, i) => c.id !== available[i].id || c.name !== available[i].channelName)) {
      patch.availableChannels = channels.map((c) => ({ id: c.id, channelName: c.name, subscribed: c.subscribed, unit: c.unit, decimals: c.decimals }));
    }
    if (provider.metadataLoaded && !_selectionLoaded) {
      // The saved personal selection, read once per vehicle.
      _selectionLoaded = true;
      set({ ...patch, subscribedChannels: new Set(channels.filter((c) => c.subscribed).map((c) => c.name)) });
      requireSelection();
      return;
    }
    const entries = [...get().subscribedChannels].map((name): TelemetryEntry => {
      const v = provider.get("tel", name);
      return { name, state: v.state, value: v.state === "invalid" ? undefined : String(v.value), reason: v.reason };
    });
    if (!sameEntries(entries, get().entries)) patch.entries = entries;
    if (provider.isConnected !== get().isConnected) patch.isConnected = provider.isConnected;
    if (Object.keys(patch).length > 0) set(patch);
  };

  return {
    availableChannels: [],
    subscribedChannels: new Set<string>(),
    entries: [],
    isConnected: false,
    carId: undefined,

    async connect(carId: number) {
      if (get().carId === carId && _car) return;
      await get().disconnect();
      _car = sharedSourceHub().acquire(carId);
      _selectionLoaded = false;
      set({ carId, availableChannels: [], subscribedChannels: new Set(), entries: [], isConnected: _car.provider.isConnected });
      _unsubscribe = _car.provider.subscribe(refresh);
      refresh();
    },

    async disconnect() {
      // Leaving the bar ends only this consumer; the saved selection stays.
      _unsubscribe?.();
      _unsubscribe = null;
      _requirement?.release();
      _requirement = null;
      _car?.release();
      _car = null;
      set({ availableChannels: [], subscribedChannels: new Set<string>(), entries: [], isConnected: false, carId: undefined });
    },

    async subscribeChannel(channelName: string) {
      const { subscribedChannels, carId } = get();
      if (!_car || carId === undefined || subscribedChannels.has(channelName)) return;
      const next = new Set(subscribedChannels);
      next.add(channelName);
      set({ subscribedChannels: next });
      requireSelection();
      refresh();
      await _car.provider.invokeHub("SubscribeToChannel", carId.toString(), channelName).catch((e) => console.warn("SubscribeToChannel failed", e));
    },

    async unsubscribeChannel(channelName: string) {
      const { subscribedChannels, carId } = get();
      if (!_car || carId === undefined || !subscribedChannels.has(channelName)) return;
      const next = new Set(subscribedChannels);
      next.delete(channelName);
      set({ subscribedChannels: next });
      requireSelection();
      refresh();
      await _car.provider.invokeHub("UnsubscribeFromChannel", carId.toString(), channelName).catch((e) => console.warn("UnsubscribeFromChannel failed", e));
    },
  };
});
