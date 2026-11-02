// Client-side cache of one vehicle's telemetry, fed by Tlm messages
// (Shared/Overlay/telemetry/README.md §5 "An Clients", §6).
import type { Sample } from "./quality";
import type { SampleStateCode } from "./types";
import { SampleState } from "./types";

/** `[id, value]` (Valid, default age), `[id, value, state]` or `[id, value, state, ageMs]`. */
export type TlmChange = [number, string] | [number, string, number] | [number, string, number, number];

export interface TlmMessage {
  seq: number;
  ageMs: number;
  changed: TlmChange[];
  touched: number[];
  /** Flat pairs id, ageMs. */
  touchedAged: number[];
}

export class TelemetryBuffer {
  readonly samples = new Map<number, Sample>();
  private lastSeq: number | undefined;

  /**
   * Applies a message received at `now`. Messages with a seq not above the
   * last one are dropped. A confirmation only sets age and reception time.
   * `accept` filters channels this client no longer wants. Returns false
   * when the message was dropped.
   */
  apply(msg: TlmMessage, now: number, accept: (id: number) => boolean): boolean {
    if (this.lastSeq !== undefined && msg.seq <= this.lastSeq) return false;
    this.lastSeq = msg.seq;
    for (const c of msg.changed ?? []) {
      if (!Array.isArray(c) || typeof c[0] !== "number" || !accept(c[0])) continue;
      const state = (c.length >= 3 ? c[2] : SampleState.Valid) as SampleStateCode;
      const ageMs = c.length >= 4 ? (c[3] as number) : msg.ageMs;
      this.samples.set(c[0], { value: typeof c[1] === "string" ? c[1] : String(c[1] ?? ""), state, ageMs, receivedAt: now });
    }
    for (const id of msg.touched ?? []) this.touch(id, msg.ageMs, now);
    const aged = msg.touchedAged ?? [];
    for (let i = 0; i + 1 < aged.length; i += 2) this.touch(aged[i], aged[i + 1], now);
    return true;
  }

  private touch(id: number, ageMs: number, now: number) {
    const s = this.samples.get(id);
    if (!s) return;
    s.ageMs = ageMs;
    s.receivedAt = now;
  }

  /** New connection: the snapshot after the next interest replaces everything. */
  reset() {
    this.samples.clear();
    this.lastSeq = undefined;
  }

  /** Drops samples of channels that are no longer of interest. */
  retain(ids: ReadonlySet<number>) {
    for (const id of [...this.samples.keys()]) if (!ids.has(id)) this.samples.delete(id);
  }
}
