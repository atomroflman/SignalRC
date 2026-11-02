// Editor-side preview state of one tab: design ↔ running preview, simulation
// settings and the preview clock. Not document content (no editor command,
// no autosave, no package export) and never sent to the server.
import { animationFrameClock } from "../runtime/clock";
import type { Clock } from "../runtime/types";
import type { OverlaySourceProvider } from "../sources/types";
import { PreviewClock } from "./preview-clock";
import { PreviewSourceProvider } from "./preview-source";
import { EMPTY_SETTINGS, simKey, type ChannelOverride, type SimulationSettings, type SourceKind } from "./types";

export type EditorMode = "design" | "preview";

export interface PreviewState {
  mode: EditorMode;
  settings: SimulationSettings;
  paused: boolean;
  speed: number;
  /** Increments with every new display session (enter preview, restart). */
  epoch: number;
}

export interface PreviewSessionOptions {
  /** Live sources of the vehicle; without, everything not simulated is invalid. */
  live?: OverlaySourceProvider;
  /** Base clock of the preview time (tests: TestClock). */
  clock?: Clock;
}

export class PreviewSession {
  readonly clock: PreviewClock;
  readonly source: PreviewSourceProvider;
  private state: PreviewState;
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribeClock: () => void;

  constructor(options: PreviewSessionOptions = {}) {
    this.clock = new PreviewClock(options.clock ?? animationFrameClock());
    this.source = new PreviewSourceProvider(options.live, this.clock);
    this.state = { mode: "design", settings: EMPTY_SETTINGS, paused: false, speed: 1, epoch: 0 };
    this.unsubscribeClock = this.clock.subscribe(() => this.set({ paused: this.clock.paused, speed: this.clock.speed }));
  }

  getState(): PreviewState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  setLive(live: OverlaySourceProvider | undefined) {
    this.source.setLive(live);
  }

  // --- Mode ---

  /** Starts a new preview session at t = 0 (runtime §2). */
  enterPreview() {
    if (this.state.mode === "preview") return;
    this.clock.reset();
    this.set({ mode: "preview", epoch: this.state.epoch + 1 });
  }

  leavePreview() {
    if (this.state.mode === "design") return;
    this.set({ mode: "design" });
  }

  toggle() {
    if (this.state.mode === "preview") this.leavePreview();
    else this.enterPreview();
  }

  /** New session from t = 0, keeping pause and speed. */
  restart() {
    this.clock.reset();
    this.set({ epoch: this.state.epoch + 1 });
  }

  // --- Time ---

  play() { this.clock.play(); }
  pause() { this.clock.pause(); }
  step(seconds?: number) { this.clock.step(seconds); }
  setSpeed(speed: number) { this.clock.setSpeed(speed); }

  // --- Simulation ---

  setOverride(kind: SourceKind, name: string, override: ChannelOverride | undefined) {
    const overrides = { ...this.state.settings.overrides };
    if (override) overrides[simKey(kind, name)] = override;
    else delete overrides[simKey(kind, name)];
    this.setSettings({ ...this.state.settings, overrides });
  }

  setSimulateAll(simulateAll: boolean) {
    this.setSettings({ ...this.state.settings, simulateAll });
  }

  setDriverActive(driverActive: boolean | undefined) {
    this.setSettings({ ...this.state.settings, driverActive });
  }

  /** Removes all simulations: every value is live again. */
  clearSimulation() {
    this.setSettings(EMPTY_SETTINGS);
  }

  setSettings(settings: SimulationSettings) {
    this.source.setSettings(settings);
    this.set({ settings });
  }

  dispose() {
    this.unsubscribeClock();
    this.source.dispose();
    this.clock.dispose();
    this.listeners.clear();
  }

  private set(patch: Partial<PreviewState>) {
    const next = { ...this.state, ...patch };
    if ((Object.keys(patch) as (keyof PreviewState)[]).every((k) => next[k] === this.state[k])) return;
    this.state = next;
    for (const l of [...this.listeners]) l();
  }
}
