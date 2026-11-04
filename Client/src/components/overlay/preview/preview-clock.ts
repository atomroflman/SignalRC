// Controllable preview time (runtime §1: tests/simulation use a controlled
// clock): pause, single steps and speed over a base clock. Frames of the base
// clock are forwarded with the preview time; while paused the time stands
// still, so animations freeze but live values keep being shown.
import type { Clock } from "../runtime/types";

export interface PreviewClockState {
  paused: boolean;
  speed: number;
}

export const PREVIEW_SPEEDS = [0.1, 0.25, 0.5, 1, 2, 4] as const;
/** One step: a 30 fps frame. */
export const STEP_S = 1 / 30;

export class PreviewClock implements Clock {
  private offset = 0;
  private anchor: number;
  private _paused = false;
  private _speed = 1;
  private lastEmitted = NaN;
  private readonly frameListeners = new Set<(t: number) => void>();
  private readonly advanceListeners = new Set<(t: number) => void>();
  private readonly stateListeners = new Set<() => void>();
  private stopBase: (() => void) | undefined;

  constructor(private readonly base: Clock) {
    this.anchor = base.now();
  }

  /** Preview seconds since the last reset. */
  now(): number {
    return this._paused ? this.offset : this.offset + (this.base.now() - this.anchor) * this._speed;
  }

  get paused() {
    return this._paused;
  }

  get speed() {
    return this._speed;
  }

  getState(): PreviewClockState {
    return { paused: this._paused, speed: this._speed };
  }

  onFrame(cb: (t: number) => void): () => void {
    this.frameListeners.add(cb);
    this.ensureBase();
    return () => {
      this.frameListeners.delete(cb);
      this.ensureBase();
    };
  }

  /** Called at the start of every frame whose time differs from the last one (value sources). */
  onAdvance(cb: (t: number) => void): () => void {
    this.advanceListeners.add(cb);
    this.ensureBase();
    return () => {
      this.advanceListeners.delete(cb);
      this.ensureBase();
    };
  }

  /** Pause/speed changes (UI). */
  subscribe(listener: () => void): () => void {
    this.stateListeners.add(listener);
    return () => { this.stateListeners.delete(listener); };
  }

  pause() {
    if (this._paused) return;
    this.offset = this.now();
    this._paused = true;
    this.changed();
  }

  play() {
    if (!this._paused) return;
    this.anchor = this.base.now();
    this._paused = false;
    this.changed();
  }

  setSpeed(speed: number) {
    if (!(speed > 0) || speed === this._speed) return;
    this.offset = this.now();
    this.anchor = this.base.now();
    this._speed = speed;
    this.changed();
  }

  /** Pauses and advances by `seconds`, rendering one frame at the new time. */
  step(seconds = STEP_S) {
    this.pause();
    this.offset += Math.max(0, seconds);
    this.emit(this.offset);
  }

  /** Back to t = 0. Callers start a new display session (runtime §2), time never runs backwards within one. */
  reset() {
    this.offset = 0;
    this.anchor = this.base.now();
    this.lastEmitted = NaN;
    this.changed();
  }

  dispose() {
    this.frameListeners.clear();
    this.advanceListeners.clear();
    this.stateListeners.clear();
    this.ensureBase();
  }

  private emit(t: number) {
    if (t !== this.lastEmitted) {
      this.lastEmitted = t;
      for (const l of [...this.advanceListeners]) l(t);
    }
    for (const l of [...this.frameListeners]) l(t);
  }

  private ensureBase() {
    const wanted = this.frameListeners.size + this.advanceListeners.size > 0;
    if (wanted && !this.stopBase) this.stopBase = this.base.onFrame(() => this.emit(this.now()));
    else if (!wanted && this.stopBase) {
      this.stopBase();
      this.stopBase = undefined;
    }
  }

  private changed() {
    for (const l of [...this.stateListeners]) l();
  }
}
