// Live value source of one vehicle (Shared/Overlay/telemetry/README.md §6,
// §7; modules/README.md §1). Consumers (manual telemetry bar, active HUD,
// editor preview) register what they need with separate lifecycles; the
// union goes to the server as one SetTelemetryInterest. No simulation here.
import { ControlDisplayBuffer, type CtlMessage, type LocalControlSource } from "./control-display";
import { summarizeLidarGrid, type ChannelDiagnostics, type ProviderDiagnostics } from "./diagnostics";
import { DEFAULT_ZONE_LIMITS_MM, decodeLidarGrid } from "./lidar-grid";
import { evaluateSample, expiresAt, staleAfterMs, type Context } from "./quality";
import { TelemetryBuffer, type TlmMessage } from "./telemetry-buffer";
import type {
  ChannelMetadata,
  Dependency,
  LidarGrid,
  LidarGridValue,
  OverlaySourceProvider,
  OverlayValueSource,
  QualifiedValue,
  RequireOptions,
  Requirement,
  TelemetryDataType,
  TimerClock,
} from "./types";

export interface ProviderOptions {
  carId: number;
  clock: TimerClock;
  fetchJson: (url: string) => Promise<unknown>;
  /** Hub invocation; rejects while disconnected. */
  invoke: (name: string, ...args: unknown[]) => Promise<unknown>;
}

/** Interest changes are coalesced to at most one send per 200 ms (§6). */
export const INTEREST_INTERVAL_MS = 200;

const DATA_TYPES: Record<string, TelemetryDataType> = {
  string: "String", "0": "String",
  integer: "Integer", "1": "Integer",
  number: "Number", "2": "Number",
  boolean: "Boolean", "3": "Boolean",
  lidargrid: "LidarGrid", "4": "LidarGrid",
};

/** Maps one telemetry entry of GET /api/cars/{id}/overlay/sources. */
export function parseChannelMetadata(raw: unknown): ChannelMetadata | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "number" || typeof r.channelName !== "string") return undefined;
  const dataType = DATA_TYPES[String(r.dataType ?? "string").toLowerCase()] ?? "String";
  const meta: ChannelMetadata = {
    id: r.id,
    name: r.channelName,
    dataType,
    unit: typeof r.unit === "string" ? r.unit : null,
    decimals: typeof r.decimals === "number" ? r.decimals : null,
  };
  if (typeof r.readIntervalTicks === "number") meta.readIntervalTicks = r.readIntervalTicks;
  if (Array.isArray(r.zoneLimitsMm) && r.zoneLimitsMm.length === 5 && r.zoneLimitsMm.every((v) => typeof v === "number")) {
    meta.zoneLimitsMm = r.zoneLimitsMm as number[];
  } else if (dataType === "LidarGrid") {
    meta.zoneLimitsMm = DEFAULT_ZONE_LIMITS_MM;
  }
  return meta;
}

interface Consumer {
  token: object;
  tel: Set<string>;
  control: boolean;
  staleAfterMs: Record<string, number | undefined>;
}

type MetadataState = "idle" | "loading" | "loaded" | "failed";

export class CarSourceProvider implements OverlaySourceProvider {
  readonly carId: number;
  private readonly clock: TimerClock;
  private readonly fetchJson: ProviderOptions["fetchJson"];
  private readonly invoke: ProviderOptions["invoke"];

  private readonly telemetry = new TelemetryBuffer();
  private readonly control = new ControlDisplayBuffer();
  private readonly consumers = new Map<string, Consumer>();
  private readonly listeners = new Set<() => void>();

  private byName = new Map<string, ChannelMetadata>();
  private byId = new Map<number, ChannelMetadata>();
  private metadataState: MetadataState = "idle";
  private metadataReloads = new Set<number>();
  private outputIds = new Map<string, number>();

  private connected = false;
  private vehicleOnline = true;
  private driverId: string | null = null;
  private local: LocalControlSource | undefined;
  private localUnsubscribe: (() => void) | undefined;

  /** Last interest sent to the server; undefined = nothing sent on this connection. */
  private sentIds: Set<number> | undefined;
  private wantedIds = new Set<number>();
  private interestSentAt = -Infinity;
  private interestTimer: unknown;
  private sentControl: boolean | undefined;

  private expiryTimer: unknown;
  private expiryAt = Infinity;
  private lidarCache = new Map<string, LidarGrid | undefined>();
  private disposed = false;
  private _version = 0;
  private readonly defaultView: OverlayValueSource;

  constructor(options: ProviderOptions) {
    this.carId = options.carId;
    this.clock = options.clock;
    this.fetchJson = options.fetchJson;
    this.invoke = options.invoke;
    this.defaultView = this.view({});
    void this.loadMetadata();
  }

  /** Increases with every observable change (for useSyncExternalStore). */
  get version() {
    return this._version;
  }

  get isConnected() {
    return this.connected;
  }

  get metadataLoaded() {
    return this.metadataState === "loaded" || this.metadataState === "failed";
  }

  /** All telemetry channels of the vehicle. */
  channels(): ChannelMetadata[] {
    return [...this.byId.values()];
  }

  metadata(name: string): ChannelMetadata | undefined {
    return this.byName.get(name);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  // --- Consumers ---

  /**
   * Registers or replaces what a consumer needs. Each consumer has its own
   * lifecycle: releasing one never affects another. Calling require again
   * with the same id replaces its needs; an older handle then releases nothing.
   */
  require(consumerId: string, deps: Dependency[], options: RequireOptions = {}): Requirement {
    const token = {};
    const consumer: Consumer = {
      token,
      tel: new Set(deps.filter((d) => d.kind === "tel").map((d) => d.name)),
      control: deps.some((d) => d.kind === "out" || d.kind === "sig"),
      staleAfterMs: { ...(options.staleAfterMs ?? {}) },
    };
    this.consumers.set(consumerId, consumer);
    this.consumersChanged();
    return {
      source: this.view(consumer.staleAfterMs),
      release: () => {
        if (this.consumers.get(consumerId)?.token !== token) return;
        this.consumers.delete(consumerId);
        this.consumersChanged();
      },
    };
  }

  /** The driver's own client reads its local values instead of the relay (§7). */
  setLocalControlSource(local: LocalControlSource | undefined) {
    this.localUnsubscribe?.();
    this.local = local;
    this.localUnsubscribe = local?.subscribe(() => this.notify());
    this.consumersChanged();
  }

  private consumersChanged() {
    if (this.disposed) return;
    this.updateWanted();
    this.scheduleInterest();
    this.sendControlInterest();
    this.notify();
  }

  private wantsControl() {
    return !this.local && [...this.consumers.values()].some((c) => c.control);
  }

  private updateWanted() {
    const ids = new Set<number>();
    for (const c of this.consumers.values()) {
      for (const name of c.tel) {
        const meta = this.byName.get(name);
        if (meta) ids.add(meta.id);
      }
    }
    this.wantedIds = ids;
  }

  // --- Interest (§6) ---

  private scheduleInterest() {
    if (!this.connected || this.disposed) return;
    // Nothing sent yet on this connection means no interest on the server.
    if (sameSet(this.sentIds ?? new Set(), this.wantedIds)) {
      this.cancelInterestTimer();
      return;
    }
    if (this.interestTimer !== undefined) return;
    const delay = Math.max(0, this.interestSentAt + INTEREST_INTERVAL_MS - this.clock.now());
    if (delay === 0) {
      void this.sendInterest();
      return;
    }
    this.interestTimer = this.clock.setTimer(() => {
      this.interestTimer = undefined;
      void this.sendInterest();
    }, delay);
  }

  private cancelInterestTimer() {
    if (this.interestTimer !== undefined) this.clock.clearTimer(this.interestTimer);
    this.interestTimer = undefined;
  }

  private async sendInterest() {
    if (!this.connected || this.disposed) return;
    const ids = new Set(this.wantedIds);
    if (sameSet(this.sentIds ?? new Set(), ids)) return;
    this.sentIds = ids;
    this.interestSentAt = this.clock.now();
    // Values of channels nobody asks for any more are not kept; the server
    // answers channels that are asked for again with a fresh snapshot.
    this.telemetry.retain(ids);
    try {
      await this.invoke("SetTelemetryInterest", this.carId, [...ids].sort((a, b) => a - b));
    } catch (e) {
      if (this.connected) console.warn("SetTelemetryInterest failed", e);
    }
    this.notify();
  }

  private sendControlInterest() {
    if (!this.connected || this.disposed) return;
    const wanted = this.wantsControl();
    // Nothing sent on this connection means no interest on the server.
    if (wanted === (this.sentControl ?? false)) return;
    this.sentControl = wanted;
    if (!wanted) this.control.reset();
    this.invoke("SetControlDisplayInterest", this.carId, wanted).catch((e) => {
      if (this.connected) console.warn("SetControlDisplayInterest failed", e);
    });
  }

  // --- Hub events (called by SourceHub) ---

  /** Connection state; a new connection starts from an empty cache (§6). */
  setConnected(connected: boolean) {
    if (connected === this.connected) return;
    this.connected = connected;
    this.telemetry.reset();
    this.control.reset();
    this.sentIds = undefined;
    this.sentControl = undefined;
    this.interestSentAt = -Infinity;
    this.cancelInterestTimer();
    if (connected) {
      if (this.metadataState === "failed") void this.loadMetadata();
      this.scheduleInterest();
      this.sendControlInterest();
    }
    this.notify();
  }

  setVehicleState(online: boolean, driverId: string | null) {
    if (online === this.vehicleOnline && driverId === this.driverId) return;
    this.vehicleOnline = online;
    this.driverId = driverId;
    this.notify();
  }

  onTelemetry(msg: TlmMessage) {
    if (this.disposed) return;
    const accept = (id: number) => this.wantedIds.has(id) || (this.sentIds?.has(id) ?? false);
    if (!this.telemetry.apply(msg, this.clock.now(), accept)) return;
    const unknown = (msg.changed ?? []).map((c) => c[0]).filter((id) => !this.byId.has(id) && !this.metadataReloads.has(id));
    if (unknown.length > 0 && this.metadataState === "loaded") {
      // An unknown channel id: reload the metadata once (§6).
      for (const id of unknown) this.metadataReloads.add(id);
      void this.loadMetadata();
    }
    this.notify();
  }

  onControl(msg: CtlMessage) {
    if (this.disposed || !this.sentControl) return;
    if (this.control.apply(msg, this.clock.now())) this.notify();
  }

  onControlCleared(driverEpoch: string) {
    if (this.control.clear(driverEpoch)) this.notify();
  }

  /** A hub call on the shared connection, e.g. the bar's SubscribeToChannel. */
  invokeHub(name: string, ...args: unknown[]): Promise<unknown> {
    return this.invoke(name, ...args);
  }

  dispose() {
    if (this.disposed) return;
    if (this.connected) {
      if (this.sentIds && this.sentIds.size > 0) this.invoke("SetTelemetryInterest", this.carId, []).catch(() => {});
      if (this.sentControl) this.invoke("SetControlDisplayInterest", this.carId, false).catch(() => {});
    }
    this.disposed = true;
    this.cancelInterestTimer();
    if (this.expiryTimer !== undefined) this.clock.clearTimer(this.expiryTimer);
    this.localUnsubscribe?.();
    this.consumers.clear();
    this.listeners.clear();
  }

  // --- Metadata ---

  /** Viewer catalog (D69, D70): telemetry channels and output names, no login needed. */
  private async loadMetadata() {
    if (this.metadataState === "loading") return;
    this.metadataState = "loading";
    try {
      const raw = (await this.fetchJson(`/api/cars/${this.carId}/overlay/sources`)) as { telemetry?: unknown; outputs?: unknown } | null;
      const list = (Array.isArray(raw?.telemetry) ? raw.telemetry : []).map(parseChannelMetadata).filter((m): m is ChannelMetadata => !!m);
      this.byId = new Map(list.map((m) => [m.id, m]));
      this.byName = new Map(list.map((m) => [m.name, m]));
      this.outputIds = new Map(
        (Array.isArray(raw?.outputs) ? raw.outputs : [])
          .filter((f) => f && typeof f.id === "number" && typeof f.channelName === "string")
          .map((f) => [f.channelName as string, f.id as number]),
      );
      this.metadataState = "loaded";
    } catch {
      this.metadataState = "failed";
    }
    if (this.disposed) return;
    this.consumersChanged();
  }

  /**
   * The viewer's saved selection for the manual bar (GET /api/car/{id}/telemetry,
   * signed-in users only); empty without login or setup.
   */
  async loadPersonalSelection(): Promise<string[]> {
    try {
      const raw = await this.fetchJson(`/api/car/${this.carId}/telemetry`);
      return (Array.isArray(raw) ? raw : []).filter((c) => c && c.subscribed === true && typeof c.channelName === "string").map((c) => c.channelName as string);
    } catch {
      return [];
    }
  }

  // --- Values ---

  private context(): Context {
    return { connected: this.connected, vehicleOnline: this.vehicleOnline, now: this.clock.now() };
  }

  private telemetryValue(name: string, overrides: Record<string, number | undefined>): QualifiedValue & { meta?: ChannelMetadata } {
    const meta = this.byName.get(name);
    if (!meta) {
      if (!this.connected) return { state: "invalid", reason: "transport" };
      return { state: "invalid", reason: this.metadataLoaded ? "no-data" : "waiting" };
    }
    const v = evaluateSample(this.telemetry.samples.get(meta.id), staleAfterMs(meta, overrides[name]), this.context(), meta.dataType);
    return { ...v, meta };
  }

  private controlValue(kind: "out" | "sig", name: string): QualifiedValue {
    if (this.local) return kind === "out" ? this.local.output(this.outputIds.get(name)) : this.local.signal(name);
    if (!this.connected) return { state: "invalid", reason: "transport" };
    if (kind === "sig") return this.control.signal(name, this.clock.now());
    if (!this.metadataLoaded) return { state: "invalid", reason: "waiting" };
    return this.control.output(this.outputIds.get(name), this.clock.now());
  }

  private lidarValue(name: string, overrides: Record<string, number | undefined>): LidarGridValue {
    const { meta, ...v } = this.telemetryValue(name, overrides);
    if (v.state === "invalid" || !meta) return v;
    const raw = String(v.value);
    let grid = this.lidarCache.get(raw);
    if (!this.lidarCache.has(raw)) {
      grid = decodeLidarGrid(raw);
      this.lidarCache.clear();
      this.lidarCache.set(raw, grid);
    }
    if (!grid) return { state: "invalid", reason: "parse", ageMs: v.ageMs };
    return { ...v, grid, zoneLimitsMm: meta.zoneLimitsMm ?? DEFAULT_ZONE_LIMITS_MM };
  }

  /** A read view with the deadline overrides of one consumer. */
  view(overrides: Record<string, number | undefined>): OverlayValueSource {
    return {
      get: (kind, name) => {
        if (kind === "tel") {
          const { meta: _meta, ...v } = this.telemetryValue(name, overrides);
          return v;
        }
        return this.controlValue(kind, name);
      },
      lidarGrid: (name) => this.lidarValue(name, overrides),
      driverActive: () => this.driverId != null,
      driverActiveValue: () =>
        this.connected ? { state: "valid", value: this.driverId != null } : { state: "invalid", reason: "transport" },
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

  // --- Diagnostics ---

  /**
   * A read-only snapshot for the diagnostics panel: what is requested, by whom,
   * and what arrived. Calling it changes nothing.
   */
  diagnostics(): ProviderDiagnostics {
    const byChannel = new Map<string, string[]>();
    const consumers = [...this.consumers].map(([id, c]) => {
      for (const name of c.tel) byChannel.set(name, [...(byChannel.get(name) ?? []), id]);
      return { id, channels: [...c.tel].sort(), control: c.control };
    });
    const ids = new Set<number>([
      ...this.byId.keys(), ...this.telemetry.samples.keys(), ...this.telemetry.counters.keys(), ...this.wantedIds, ...(this.sentIds ?? []),
    ]);
    const channels = [...ids].sort((a, b) => a - b).map((id): ChannelDiagnostics => {
      const meta = this.byId.get(id);
      const sample = this.telemetry.samples.get(id);
      const counter = this.telemetry.counters.get(id);
      let value: ChannelDiagnostics["value"];
      if (meta?.dataType === "LidarGrid") {
        // The grid's quality includes its decoding (parse).
        const { grid: _grid, zoneLimitsMm: _zones, ...v } = this.lidarValue(meta.name, {});
        value = v;
      } else if (meta) {
        const { meta: _meta, ...v } = this.telemetryValue(meta.name, {});
        value = v;
      }
      return {
        id,
        name: meta?.name,
        dataType: meta?.dataType,
        raw: sample?.value,
        sampleState: sample?.state,
        value,
        changes: counter?.changes ?? 0,
        confirmations: counter?.confirmations ?? 0,
        lastArrival: counter?.lastArrival,
        wanted: this.wantedIds.has(id),
        sent: this.sentIds?.has(id) ?? false,
        consumers: meta ? (byChannel.get(meta.name) ?? []) : [],
        lidar: meta?.dataType === "LidarGrid" && sample ? summarizeLidarGrid(sample.value) : undefined,
      };
    });
    return {
      carId: this.carId,
      connected: this.connected,
      vehicleOnline: this.vehicleOnline,
      metadata: this.metadataState,
      stream: { ...this.telemetry.stream },
      wanted: [...this.wantedIds].sort((a, b) => a - b),
      sent: this.sentIds ? [...this.sentIds].sort((a, b) => a - b) : undefined,
      controlInterest: this.sentControl ?? false,
      consumers,
      channels,
      now: this.clock.now(),
    };
  }

  // --- Change signal and aging ---

  private notify() {
    if (this.disposed) return;
    this._version++;
    this.scheduleExpiry();
    for (const l of [...this.listeners]) l();
  }

  /**
   * Values age without further messages: a timer fires at the next moment a
   * value of any consumer crosses its deadline and signals a change.
   */
  private scheduleExpiry() {
    const now = this.clock.now();
    let next = Infinity;
    if (this.connected) {
      for (const c of this.consumers.values()) {
        for (const name of c.tel) {
          const meta = this.byName.get(name);
          const sample = meta && this.telemetry.samples.get(meta.id);
          if (!sample) continue;
          const at = expiresAt(sample, staleAfterMs(meta, c.staleAfterMs[name]));
          if (at !== undefined && at >= now && at < next) next = at;
        }
      }
      const ctl = this.control.expiresAt();
      if (ctl !== undefined && ctl >= now && ctl < next) next = ctl;
    }
    if (next === this.expiryAt) return;
    if (this.expiryTimer !== undefined) this.clock.clearTimer(this.expiryTimer);
    this.expiryTimer = undefined;
    this.expiryAt = next;
    if (next === Infinity) return;
    // +1: "older than the deadline" means strictly greater.
    this.expiryTimer = this.clock.setTimer(() => {
      this.expiryTimer = undefined;
      this.expiryAt = Infinity;
      this.notify();
    }, next - now + 1);
  }
}

function sameSet<T>(a: ReadonlySet<T>, b: ReadonlySet<T>) {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}
