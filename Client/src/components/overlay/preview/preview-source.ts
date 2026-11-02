// Preview value source (Overlay-Feature.md "Lokale Simulation"): simulated
// values per channel over the live source; everything not overridden stays
// live. Reads only: nothing is written to the live provider, the hub or the
// control flow, and overridden channels are not even requested live.
import { DEFAULT_ZONE_LIMITS_MM, decodeLidarGrid } from "../sources/lidar-grid";
import { CONTROL_STALE_AFTER_MS, evaluateSample, staleAfterMs } from "../sources/quality";
import type {
  ChannelMetadata,
  Dependency,
  LidarGridValue,
  OverlaySourceProvider,
  OverlayValueSource,
  QualifiedValue,
  RequireOptions,
  Requirement,
  SampleStateCode,
} from "../sources/types";
import { SampleState } from "../sources/types";
import { defaultGenerator, impliedDataType, isDynamic, numberAt, telemetryText } from "./generators";
import type { PreviewClock } from "./preview-clock";
import { EMPTY_SETTINGS, simKey, type ChannelOverride, type SimulationSettings, type SourceKind } from "./types";

interface Consumer {
  deps: Dependency[];
  options: RequireOptions;
  /** Live requirement for the channels that are not simulated. */
  live?: Requirement;
  token: object;
}

const QUALITY_STATE: Record<"valid" | "unchecked" | "missing" | "error", SampleStateCode> = {
  valid: SampleState.Valid,
  unchecked: SampleState.Unchecked,
  missing: SampleState.NoData,
  error: SampleState.Error,
};

const NO_LIVE: QualifiedValue = { state: "invalid", reason: "transport" };

export class PreviewSourceProvider implements OverlaySourceProvider {
  private settings: SimulationSettings = EMPTY_SETTINGS;
  private readonly consumers = new Map<string, Consumer>();
  private readonly listeners = new Set<() => void>();
  private liveUnsubscribe: (() => void) | undefined;
  private clockUnsubscribe: (() => void) | undefined;
  private lidarCache: { text: string; grid: ReturnType<typeof decodeLidarGrid> } | undefined;
  private readonly defaultView: OverlayValueSource;
  private _version = 0;

  constructor(private live: OverlaySourceProvider | undefined, private readonly clock: PreviewClock) {
    this.defaultView = this.view(() => undefined, {});
  }

  get version() {
    return this._version;
  }

  getSettings(): SimulationSettings {
    return this.settings;
  }

  /** Replaces the simulation; live requirements follow (overridden channels are released). */
  setSettings(settings: SimulationSettings) {
    if (settings === this.settings) return;
    this.settings = settings;
    for (const id of this.consumers.keys()) this.updateLive(id);
    this.updateClockSubscription();
    this.notify();
  }

  /** Switches the live source (e.g. vehicle connected later); undefined = simulation only. */
  setLive(live: OverlaySourceProvider | undefined) {
    if (live === this.live) return;
    for (const c of this.consumers.values()) c.live?.release();
    for (const c of this.consumers.values()) c.live = undefined;
    this.liveUnsubscribe?.();
    this.liveUnsubscribe = undefined;
    this.live = live;
    for (const id of this.consumers.keys()) this.updateLive(id);
    this.updateLiveSubscription();
    this.notify();
  }

  /** Union of the values the preview consumers currently need. */
  requested(): Dependency[] {
    const seen = new Map<string, Dependency>();
    for (const c of this.consumers.values()) for (const d of c.deps) seen.set(`${d.kind}:${d.name}`, d);
    return [...seen.values()];
  }

  /** True when the value is simulated (explicitly or by the test mode). */
  isSimulated(kind: Dependency["kind"], name: string): boolean {
    if (kind === "driver") return this.simulatedDriver() !== undefined;
    return this.override(kind, name) !== undefined;
  }

  /** Simulated driverActive(); the test mode assumes an active driver. */
  private simulatedDriver(): boolean | undefined {
    return this.settings.driverActive ?? (this.settings.simulateAll ? true : undefined);
  }

  // --- OverlaySourceProvider ---

  require(consumerId: string, deps: Dependency[], options: RequireOptions = {}): Requirement {
    const id = `preview:${consumerId}`;
    const token = {};
    const consumer: Consumer = { deps: [...deps], options: { staleAfterMs: { ...(options.staleAfterMs ?? {}) } }, token, live: this.consumers.get(id)?.live };
    this.consumers.set(id, consumer);
    this.updateLive(id);
    this.updateClockSubscription();
    return {
      source: this.view(() => this.consumers.get(id)?.live?.source, consumer.options.staleAfterMs ?? {}),
      release: () => {
        const c = this.consumers.get(id);
        if (c?.token !== token) return;
        c.live?.release();
        this.consumers.delete(id);
        this.updateClockSubscription();
      },
    };
  }

  metadata(name: string): ChannelMetadata | undefined {
    const live = this.live?.metadata(name);
    if (live) return live;
    const o = this.override("tel", name);
    return o ? { id: -1, name, dataType: impliedDataType(o.generator) } : undefined;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    this.updateLiveSubscription();
    this.updateClockSubscription();
    return () => {
      this.listeners.delete(listener);
      this.updateLiveSubscription();
      this.updateClockSubscription();
    };
  }

  get(kind: "tel" | "out" | "sig", name: string): QualifiedValue {
    return this.defaultView.get(kind, name);
  }

  lidarGrid(name: string): LidarGridValue {
    return this.defaultView.lidarGrid(name);
  }

  driverActive(): boolean {
    return this.defaultView.driverActive();
  }

  driverActiveValue(): QualifiedValue {
    return this.defaultView.driverActiveValue();
  }

  dispose() {
    for (const c of this.consumers.values()) c.live?.release();
    this.consumers.clear();
    this.listeners.clear();
    this.updateLiveSubscription();
    this.updateClockSubscription();
  }

  // --- Simulation ---

  private override(kind: SourceKind, name: string): ChannelOverride | undefined {
    const explicit = this.settings.overrides[simKey(kind, name)];
    if (explicit) return explicit;
    if (!this.settings.simulateAll) return undefined;
    const dataType = kind === "tel" ? this.live?.metadata(name)?.dataType : undefined;
    return { generator: defaultGenerator(kind, dataType) };
  }

  private simulatedTel(name: string, o: ChannelOverride, deadlineOverride: number | undefined): QualifiedValue {
    const meta = this.metadata(name);
    const dataType = meta?.dataType ?? impliedDataType(o.generator);
    const deadline = staleAfterMs(meta ?? {}, deadlineOverride);
    const quality = o.quality ?? "valid";
    const ageMs = quality === "stale" ? Math.max(o.ageMs ?? 0, deadline + 1) : Math.max(0, o.ageMs ?? 0);
    const now = this.clock.now();
    if (quality === "missing") return { state: "invalid", reason: "no-data" };
    const value = telemetryText(o.generator, now, dataType, meta?.zoneLimitsMm);
    const state = quality === "stale" ? SampleState.Valid : QUALITY_STATE[quality];
    // Same evaluation as live samples (telemetry §3).
    return evaluateSample({ value, state, ageMs, receivedAt: now }, deadline, { connected: true, vehicleOnline: true, now }, dataType);
  }

  private simulatedControl(o: ChannelOverride): QualifiedValue {
    const quality = o.quality ?? "valid";
    if (quality === "missing") return { state: "invalid", reason: "no-data" };
    if (quality === "error") return { state: "invalid", reason: "source-error" };
    if (quality === "stale") return { state: "invalid", reason: "stale", ageMs: Math.max(o.ageMs ?? 0, CONTROL_STALE_AFTER_MS + 1) };
    const value = numberAt(o.generator, this.clock.now());
    if (value === undefined) return { state: "invalid", reason: "parse" };
    return { state: quality, value, paused: o.paused === true, ageMs: Math.max(0, o.ageMs ?? 0) };
  }

  private view(live: () => OverlayValueSource | undefined, deadlines: Record<string, number | undefined>): OverlayValueSource {
    const liveSource = () => live() ?? this.live;
    return {
      get: (kind, name) => {
        const o = this.override(kind, name);
        if (o) return kind === "tel" ? this.simulatedTel(name, o, deadlines[name]) : this.simulatedControl(o);
        return liveSource()?.get(kind, name) ?? NO_LIVE;
      },
      lidarGrid: (name) => {
        const o = this.override("tel", name);
        if (!o) return liveSource()?.lidarGrid(name) ?? NO_LIVE;
        const v = this.simulatedTel(name, o, deadlines[name]);
        if (v.state === "invalid") return v;
        const text = String(v.value);
        if (this.lidarCache?.text !== text) this.lidarCache = { text, grid: decodeLidarGrid(text) };
        const grid = this.lidarCache.grid;
        if (!grid) return { state: "invalid", reason: "parse", ageMs: v.ageMs };
        return { ...v, grid, zoneLimitsMm: this.metadata(name)?.zoneLimitsMm ?? DEFAULT_ZONE_LIMITS_MM };
      },
      driverActive: () => this.simulatedDriver() ?? liveSource()?.driverActive() ?? false,
      driverActiveValue: () => {
        const simulated = this.simulatedDriver();
        return simulated !== undefined ? { state: "valid", value: simulated } : (liveSource()?.driverActiveValue() ?? NO_LIVE);
      },
    };
  }

  /** Live requirement of one consumer: only the values that are not simulated. */
  private updateLive(id: string) {
    const c = this.consumers.get(id);
    if (!c) return;
    const deps = c.deps.filter((d) => !this.isSimulated(d.kind, d.name));
    if (!this.live || deps.length === 0) {
      c.live?.release();
      c.live = undefined;
      return;
    }
    // Same id: the live provider replaces the consumer's needs.
    c.live = this.live.require(id, deps, c.options);
  }

  private updateLiveSubscription() {
    const wanted = this.listeners.size > 0 && !!this.live;
    if (wanted && !this.liveUnsubscribe) this.liveUnsubscribe = this.live!.subscribe(() => this.notify());
    else if (!wanted && this.liveUnsubscribe) {
      this.liveUnsubscribe();
      this.liveUnsubscribe = undefined;
    }
  }

  /** Time-dependent simulations signal a change whenever the preview time advances. */
  private updateClockSubscription() {
    const dynamic = this.listeners.size > 0 && this.consumers.size > 0 && this.hasDynamic();
    if (dynamic && !this.clockUnsubscribe) this.clockUnsubscribe = this.clock.onAdvance(() => this.notify());
    else if (!dynamic && this.clockUnsubscribe) {
      this.clockUnsubscribe();
      this.clockUnsubscribe = undefined;
    }
  }

  private hasDynamic() {
    if (Object.values(this.settings.overrides).some((o) => isDynamic(o.generator))) return true;
    if (!this.settings.simulateAll) return false;
    return this.requested().some((d) => {
      const o = d.kind === "driver" ? undefined : this.override(d.kind, d.name);
      return !!o && isDynamic(o.generator);
    });
  }

  private notify() {
    this._version++;
    for (const l of [...this.listeners]) l();
  }
}
