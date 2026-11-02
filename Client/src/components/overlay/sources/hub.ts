// One hub connection for all overlay/telemetry sources of this page, kept
// alive while any vehicle is in use, independent of which component mounted
// first (Overlay-Arbeitspakete.md AP05). Routes Tlm/Ctl/CtlCleared and the
// vehicle state to the per-vehicle providers.
import type { CtlMessage } from "./control-display";
import { CarSourceProvider, type ProviderOptions } from "./provider";
import type { TlmChange } from "./telemetry-buffer";
import type { TimerClock } from "./types";
import { systemClock } from "./types";

/** The part of @microsoft/signalr's HubConnection used here; replaceable in tests. */
export interface HubLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(name: string, handler: (...args: any[]) => void): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  off(name: string, handler: (...args: any[]) => void): void;
  invoke(name: string, ...args: unknown[]): Promise<unknown>;
  onreconnecting?(cb: (error?: Error) => void): void;
  onreconnected?(cb: (connectionId?: string) => void): void;
  onclose?(cb: (error?: Error) => void): void;
  start?(): Promise<void>;
  stop?(): Promise<void>;
}

interface CarStateModel {
  id: string;
  isConnected: boolean;
  driverId?: string | null;
}

export interface SourceHubOptions {
  /** Creates a new, not yet started connection. */
  createConnection?: () => Promise<HubLike>;
  fetchJson?: (url: string) => Promise<unknown>;
  clock?: TimerClock;
}

const RETRY_MS = [0, 1000, 2000, 5000, 10000];

async function defaultCreateConnection(): Promise<HubLike> {
  const signalR = await import("@microsoft/signalr");
  return new signalR.HubConnectionBuilder()
    .withUrl("/hubs/connection")
    // Never give up while sources are in use.
    .withAutomaticReconnect({ nextRetryDelayInMilliseconds: (c) => RETRY_MS[Math.min(c.previousRetryCount, RETRY_MS.length - 1)] })
    .build();
}

async function defaultFetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

export type HubState = "disconnected" | "connecting" | "connected";

export class SourceHub {
  private readonly cars = new Map<number, { provider: CarSourceProvider; refs: number }>();
  private hub: HubLike | undefined;
  private generation = 0;
  private retryTimer: unknown;
  private retries = 0;
  private _state: HubState = "disconnected";
  private readonly createConnection: () => Promise<HubLike>;
  private readonly fetchJson: (url: string) => Promise<unknown>;
  private readonly clock: TimerClock;

  constructor(options: SourceHubOptions = {}) {
    this.createConnection = options.createConnection ?? defaultCreateConnection;
    this.fetchJson = options.fetchJson ?? defaultFetchJson;
    this.clock = options.clock ?? systemClock;
  }

  get state(): HubState {
    return this._state;
  }

  /** The current connection, e.g. for the bar's personal selection (SubscribeToChannel). */
  get connection(): HubLike | undefined {
    return this._state === "connected" ? this.hub : undefined;
  }

  /** Uses a vehicle's sources; the connection lives while any vehicle is acquired. */
  acquire(carId: number): { provider: CarSourceProvider; release(): void } {
    let car = this.cars.get(carId);
    if (!car) {
      const options: ProviderOptions = {
        carId,
        clock: this.clock,
        fetchJson: this.fetchJson,
        invoke: (name, ...args) => {
          const hub = this.connection;
          return hub ? hub.invoke(name, ...args) : Promise.reject(new Error("not connected"));
        },
      };
      car = { provider: new CarSourceProvider(options), refs: 0 };
      this.cars.set(carId, car);
      car.provider.setConnected(this._state === "connected");
      if (this._state === "connected") void this.refreshCarStates();
    }
    car.refs++;
    if (this._state === "disconnected") void this.start();
    const entry = car;
    let released = false;
    return {
      provider: entry.provider,
      release: () => {
        if (released) return;
        released = true;
        entry.refs--;
        if (entry.refs > 0) return;
        this.cars.delete(carId);
        entry.provider.dispose();
        if (this.cars.size === 0) void this.stop();
      },
    };
  }

  private setState(state: HubState) {
    this._state = state;
    for (const { provider } of this.cars.values()) provider.setConnected(state === "connected");
  }

  private async start() {
    const generation = ++this.generation;
    this.setState("connecting");
    let hub: HubLike;
    try {
      hub = await this.createConnection();
      if (generation !== this.generation) return;
      this.attach(hub, generation);
      this.hub = hub;
      await hub.start?.();
    } catch {
      if (generation === this.generation) this.retry();
      return;
    }
    if (generation !== this.generation) {
      void hub.stop?.();
      return;
    }
    this.retries = 0;
    this.connected();
  }

  private retry() {
    this.hub = undefined;
    this.setState("connecting");
    if (this.cars.size === 0) {
      this.setState("disconnected");
      return;
    }
    const delay = RETRY_MS[Math.min(this.retries++, RETRY_MS.length - 1)] || RETRY_MS[1];
    this.retryTimer = this.clock.setTimer(() => {
      this.retryTimer = undefined;
      if (this.cars.size > 0) void this.start();
    }, delay);
  }

  private async stop() {
    this.generation++;
    if (this.retryTimer !== undefined) this.clock.clearTimer(this.retryTimer);
    this.retryTimer = undefined;
    const hub = this.hub;
    this.hub = undefined;
    this._state = "disconnected";
    await hub?.stop?.().catch(() => {});
  }

  private connected() {
    this.setState("connected");
    void this.refreshCarStates();
  }

  private async refreshCarStates() {
    const hub = this.connection;
    if (!hub) return;
    try {
      const states = (await hub.invoke("UiClientConnected")) as CarStateModel[] | undefined;
      for (const s of states ?? []) this.onCarState(s);
    } catch {
      // Vehicle state stays unknown; values are not marked offline then.
    }
  }

  private onCarState(state: CarStateModel) {
    const car = this.cars.get(Number(state?.id));
    car?.provider.setVehicleState(state.isConnected === true, state.driverId ?? null);
  }

  private attach(hub: HubLike, generation: number) {
    const live = () => generation === this.generation;
    hub.on("Tlm", (carId: number, seq: number, ageMs: number, changed: TlmChange[], touched: number[], touchedAged: number[]) => {
      if (live()) this.cars.get(carId)?.provider.onTelemetry({ seq, ageMs, changed, touched, touchedAged });
    });
    hub.on("Ctl", (carId: number, driverEpoch: string, seq: number, paused: boolean, ageMs: number,
      outputs: [number, number][], signals: [string, number][], removedOutputs: number[], removedSignals: string[]) => {
      if (live()) this.cars.get(carId)?.provider.onControl({ driverEpoch, seq, paused, ageMs, outputs, signals, removedOutputs, removedSignals } satisfies CtlMessage);
    });
    hub.on("CtlCleared", (carId: number, driverEpoch: string) => {
      if (live()) this.cars.get(carId)?.provider.onControlCleared(driverEpoch);
    });
    hub.on("CarStateUpdated", (state: CarStateModel) => {
      if (live()) this.onCarState(state);
    });
    hub.onreconnecting?.(() => {
      if (live()) this.setState("connecting");
    });
    hub.onreconnected?.(() => {
      if (live()) this.connected();
    });
    hub.onclose?.(() => {
      if (live()) this.retry();
    });
  }
}

let shared: SourceHub | undefined;

/** The page-wide hub of the live sources. */
export function sharedSourceHub(): SourceHub {
  return (shared ??= new SourceHub());
}

/** Replaces the page-wide hub (tests only). */
export function setSharedSourceHub(hub: SourceHub | undefined) {
  shared = hub;
}
