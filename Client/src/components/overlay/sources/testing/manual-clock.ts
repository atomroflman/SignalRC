// Test double: a controllable TimerClock.
import type { TimerClock } from "../types";

export class ManualClock implements TimerClock {
  private t = 0;
  private nextId = 1;
  private readonly timers = new Map<number, { at: number; cb: () => void }>();

  now() {
    return this.t;
  }

  setTimer(cb: () => void, ms: number) {
    const id = this.nextId++;
    this.timers.set(id, { at: this.t + Math.max(0, ms), cb });
    return id;
  }

  clearTimer(handle: unknown) {
    this.timers.delete(handle as number);
  }

  get pendingTimers() {
    return this.timers.size;
  }

  /** Advances time, firing due timers in order. */
  advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      let next: [number, { at: number; cb: () => void }] | undefined;
      for (const e of this.timers) if (e[1].at <= end && (!next || e[1].at < next[1].at)) next = e;
      if (!next) break;
      this.timers.delete(next[0]);
      this.t = Math.max(this.t, next[1].at);
      next[1].cb();
    }
    this.t = end;
  }

  set(t: number) {
    this.advance(t - this.t);
  }
}
