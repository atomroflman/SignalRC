// Test double of the runtime clock (modules/README.md §1 TestClock): time and
// frames advance only when the test says so.
import type { Clock } from "../types";

export class TestClock implements Clock {
  private t = 0;
  private readonly listeners = new Set<(t: number) => void>();

  now() {
    return this.t;
  }

  onFrame(cb: (t: number) => void) {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  /** Number of active frame listeners (0 = no frames would run). */
  get listenerCount() {
    return this.listeners.size;
  }

  /** Sets the time without a frame. */
  set(t: number) {
    this.t = t;
  }

  /** Runs one frame at `t` (default: the current time). */
  frame(t = this.t) {
    this.t = t;
    for (const l of [...this.listeners]) l(t);
  }

  /** Advances by `seconds` in frames of `step` seconds. */
  advance(seconds: number, step = 1 / 30) {
    const end = this.t + seconds;
    while (this.t + step < end - 1e-9) this.frame(this.t + step);
    this.frame(end);
  }
}
