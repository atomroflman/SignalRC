// Control display: computed outputs and named flow signals of the active
// driver (Shared/Overlay/telemetry/README.md §7, D07–D09, D30, D31, D57).
// Display only: nothing here ever sends a vehicle command.
import type { HubLike } from "./hub";
import { CONTROL_STALE_AFTER_MS } from "./quality";
import type { QualifiedValue, TimerClock } from "./types";
import { systemClock } from "./types";

export interface CtlMessage {
  driverEpoch: string;
  seq: number;
  paused: boolean;
  ageMs: number;
  outputs: [number, number][];
  signals: [string, number][];
  removedOutputs: number[];
  removedSignals: string[];
}

// --- Viewer side ---

/** What a viewer knows about the driver's display values (one vehicle). */
export class ControlDisplayBuffer {
  private epoch: string | undefined;
  private lastSeq = -Infinity;
  private paused = false;
  /** Client time the last message was produced (reception − ageMs). */
  private messageAt: number | undefined;
  private readonly outputs = new Map<number, number>();
  private readonly signals = new Map<string, number>();

  /** A message of another epoch belongs to a new driver and replaces everything. */
  apply(msg: CtlMessage, now: number): boolean {
    if (msg.driverEpoch !== this.epoch) {
      this.reset();
      this.epoch = msg.driverEpoch;
    } else if (msg.seq <= this.lastSeq) {
      return false;
    }
    this.lastSeq = msg.seq;
    this.paused = msg.paused === true;
    this.messageAt = now - Math.max(0, msg.ageMs ?? 0);
    for (const [id, v] of msg.outputs ?? []) if (typeof v === "number") this.outputs.set(id, v);
    for (const [name, v] of msg.signals ?? []) if (typeof v === "number") this.signals.set(name, v);
    for (const id of msg.removedOutputs ?? []) this.outputs.delete(id);
    for (const name of msg.removedSignals ?? []) this.signals.delete(name);
    return true;
  }

  /** CtlCleared: only the epoch it names is void; a stale clear is ignored. */
  clear(driverEpoch: string): boolean {
    if (driverEpoch !== this.epoch) return false;
    this.reset();
    return true;
  }

  reset() {
    this.epoch = undefined;
    this.lastSeq = -Infinity;
    this.paused = false;
    this.messageAt = undefined;
    this.outputs.clear();
    this.signals.clear();
  }

  output(id: number | undefined, now: number): QualifiedValue {
    return this.evaluate(id === undefined ? undefined : this.outputs.get(id), now);
  }

  signal(name: string, now: number): QualifiedValue {
    return this.evaluate(this.signals.get(name), now);
  }

  private evaluate(value: number | undefined, now: number): QualifiedValue {
    if (value === undefined || this.messageAt === undefined) return { state: "invalid", reason: "no-data" };
    const ageMs = now - this.messageAt;
    if (ageMs > CONTROL_STALE_AFTER_MS) return { state: "invalid", reason: "stale", ageMs };
    return { state: "valid", paused: this.paused, value, ageMs };
  }

  /** Time at which all values become stale, if there are any. */
  expiresAt(): number | undefined {
    if (this.messageAt === undefined || (this.outputs.size === 0 && this.signals.size === 0)) return undefined;
    return this.messageAt + CONTROL_STALE_AFTER_MS;
  }
}

// --- Driver side ---

/**
 * Port through which the driver's flow publishes display values. AP13 calls
 * it from the control flow; calling it never triggers a flow evaluation,
 * a sendOutput or a reactivation (D09).
 */
export interface ControlDisplayPort {
  /** Computed value of a vehicle channel output (CarChannel.Id). */
  setOutput(channelId: number, value: number): void;
  removeOutput(channelId: number): void;
  /** Value of a named HUD signal (D36, D37). */
  setSignal(name: string, value: number): void;
  removeSignal(name: string): void;
  /** `!updatesEnabled || isInConfigMode`. */
  setPaused(paused: boolean): void;
}

/** The driver's own values, used directly by the driver's HUD (§7). */
export interface LocalControlSource {
  output(channelId: number | undefined): QualifiedValue;
  signal(name: string): QualifiedValue;
  subscribe(listener: () => void): () => void;
}

const MIN_INTERVAL_MS = 100;
const KEEPALIVE_MS = 1000;

/** Rounds to 6 significant digits (§7). */
export const round6 = (v: number) => (v === 0 ? 0 : Number(v.toPrecision(6)));

/**
 * Sends the driver's display values on the connection that acquired control,
 * but only while the server reports demand (CtlDemand true, D59): complete
 * after the demand starts, then changes at most every 100 ms, a keepalive
 * after 1 s without change and a pause change at once.
 */
export class ControlDisplayPublisher implements ControlDisplayPort, LocalControlSource {
  private readonly outputs = new Map<number, number>();
  private readonly signals = new Map<string, number>();
  private paused = false;
  /** Values the server holds from us, as far as we know. */
  private readonly sentOutputs = new Map<number, number>();
  private readonly sentSignals = new Map<string, number>();
  private sentPaused: boolean | undefined;
  private demand = false;
  private full = true;
  private seq = 0;
  private lastSentAt = -Infinity;
  private timer: unknown;
  private timerAt = 0;
  private sending = false;
  private disposed = false;
  private readonly listeners = new Set<() => void>();
  private readonly onDemand = (carId: number, needed: boolean) => {
    if (carId !== this.carId) return;
    this.setDemand(needed === true);
  };

  constructor(private readonly hub: HubLike, private readonly carId: number, private readonly clock: TimerClock = systemClock) {
    hub.on("CtlDemand", this.onDemand);
    // A new connection is not the driver until it acquires control again.
    hub.onreconnecting?.(() => this.controlEnded());
    hub.onreconnected?.(() => this.controlEnded());
  }

  dispose() {
    this.disposed = true;
    this.hub.off("CtlDemand", this.onDemand);
    this.cancelTimer();
    this.listeners.clear();
  }

  /** Control released or lost: stop sending until the next CtlDemand(true). */
  controlEnded() {
    this.setDemand(false);
    this.sentOutputs.clear();
    this.sentSignals.clear();
    this.sentPaused = undefined;
  }

  get demanded() {
    return this.demand;
  }

  // --- ControlDisplayPort ---

  setOutput(channelId: number, value: number) {
    if (!Number.isFinite(value)) return this.removeOutput(channelId);
    const v = round6(value);
    if (this.outputs.get(channelId) === v) return;
    this.outputs.set(channelId, v);
    this.changed();
  }

  removeOutput(channelId: number) {
    if (this.outputs.delete(channelId)) this.changed();
  }

  setSignal(name: string, value: number) {
    if (!Number.isFinite(value)) return this.removeSignal(name);
    const v = round6(value);
    if (this.signals.get(name) === v) return;
    this.signals.set(name, v);
    this.changed();
  }

  removeSignal(name: string) {
    if (this.signals.delete(name)) this.changed();
  }

  setPaused(paused: boolean) {
    if (this.paused === paused) return;
    this.paused = paused;
    this.notify();
    if (this.demand) void this.flush();
  }

  // --- LocalControlSource ---

  output(channelId: number | undefined): QualifiedValue {
    const v = channelId === undefined ? undefined : this.outputs.get(channelId);
    return v === undefined ? { state: "invalid", reason: "no-data" } : { state: "valid", paused: this.paused, value: v, ageMs: 0 };
  }

  signal(name: string): QualifiedValue {
    const v = this.signals.get(name);
    return v === undefined ? { state: "invalid", reason: "no-data" } : { state: "valid", paused: this.paused, value: v, ageMs: 0 };
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  // --- Sending ---

  private setDemand(needed: boolean) {
    if (needed === this.demand) return;
    this.demand = needed;
    this.cancelTimer();
    if (needed) {
      this.full = true;
      void this.flush();
    }
  }

  private changed() {
    this.notify();
    if (this.demand) this.schedule(this.lastSentAt + MIN_INTERVAL_MS);
  }

  private notify() {
    for (const l of [...this.listeners]) l();
  }

  /** Runs flush at `at`, unless a flush is already due earlier. */
  private schedule(at: number) {
    if (this.disposed || !this.demand) return;
    if (this.timer !== undefined) {
      if (this.timerAt <= at) return;
      this.cancelTimer();
    }
    this.timerAt = at;
    this.timer = this.clock.setTimer(() => {
      this.timer = undefined;
      void this.flush();
    }, Math.max(0, at - this.clock.now()));
  }

  private cancelTimer() {
    if (this.timer !== undefined) this.clock.clearTimer(this.timer);
    this.timer = undefined;
  }

  private async flush() {
    if (this.disposed || !this.demand) return;
    const now = this.clock.now();
    const pauseChanged = this.sentPaused !== this.paused;
    if (!pauseChanged && !this.full && now - this.lastSentAt < MIN_INTERVAL_MS) {
      this.schedule(this.lastSentAt + MIN_INTERVAL_MS);
      return;
    }
    if (this.sending) {
      this.schedule(now + MIN_INTERVAL_MS);
      return;
    }
    const outputs = [...this.outputs].filter(([id, v]) => this.full || this.sentOutputs.get(id) !== v);
    const signals = [...this.signals].filter(([n, v]) => this.full || this.sentSignals.get(n) !== v);
    const removedOutputs = [...this.sentOutputs.keys()].filter((id) => !this.outputs.has(id));
    const removedSignals = [...this.sentSignals.keys()].filter((n) => !this.signals.has(n));
    const empty = outputs.length + signals.length + removedOutputs.length + removedSignals.length === 0;
    this.cancelTimer();
    if (empty && !pauseChanged && !this.full && now - this.lastSentAt < KEEPALIVE_MS) {
      this.schedule(this.lastSentAt + KEEPALIVE_MS);
      return;
    }
    const seq = ++this.seq;
    const paused = this.paused;
    this.full = false;
    this.lastSentAt = now;
    this.sentPaused = paused;
    for (const [id, v] of outputs) this.sentOutputs.set(id, v);
    for (const [n, v] of signals) this.sentSignals.set(n, v);
    for (const id of removedOutputs) this.sentOutputs.delete(id);
    for (const n of removedSignals) this.sentSignals.delete(n);
    this.sending = true;
    try {
      await this.hub.invoke("Ctl", this.carId, seq, paused, outputs, signals, removedOutputs, removedSignals);
    } catch {
      // The server's state is unknown now; start over with a complete message.
      this.full = true;
    } finally {
      this.sending = false;
    }
    if (!this.demand) return;
    this.schedule(this.full ? this.clock.now() + MIN_INTERVAL_MS : this.lastSentAt + KEEPALIVE_MS);
  }
}
