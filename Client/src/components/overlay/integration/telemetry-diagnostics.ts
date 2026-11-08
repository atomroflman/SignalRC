// Telemetry diagnostics panel: logic without React. The panel is a reading
// consumer – it never adds its own requirement, except the explicit
// "request all channels" toggle, which ends when the panel closes.
import type {
  CarSourceProvider, ChannelDiagnostics, LidarGridSummary, ProviderDiagnostics, QualifiedValue, Requirement, TrafficMeter, TrafficRate, WsCompression,
} from "../sources";

export const ALL_CHANNELS_CONSUMER = "telemetry-diagnostics:all";

/** Answer of GET /api/cars/{id}/overlay/telemetry-debug (api/README.md §3). */
export interface ServerChannelDebug {
  id: number;
  name?: string | null;
  dataType?: string | null;
  value?: string | null;
  valueLength?: number | null;
  state?: string | null;
  ageMs?: number | null;
  receivedAgoMs?: number | null;
  inDemand: boolean;
  interested: number;
  changes: number;
  touches: number;
  lidar?: LidarGridSummary | null;
}

export interface ServerTelemetryDebug {
  carId: number;
  onboardConnected: boolean;
  epoch?: string | null;
  seq?: number | null;
  lastMessageAgoMs?: number | null;
  acceptedDeltas: number;
  droppedOldSeq: number;
  demand: number[];
  demandSentAgoMs?: number | null;
  interestedConnections: number;
  legacyClients: number;
  channels: ServerChannelDebug[];
  traffic?: ServerTraffic;
}

export interface ServerTrafficRate {
  perSecond: number;
  /** null: nothing in the window was measured (endpoint not watched long enough). */
  bytesPerSecond?: number | null;
  realBytesPerSecond?: number | null;
  total: { messages: number; measuredMessages: number; bytes: number; realBytes: number };
}

/** telemetry-debug `traffic` (api/README.md §3). */
export interface ServerTraffic {
  windowMs: number;
  measuring: boolean;
  measuringSinceAgoMs?: number | null;
  incoming: ServerTrafficRate;
  outgoing: ServerTrafficRate;
  clients: { perSecond: number; bytesPerSecond?: number | null; messages: number; bytes: number }[];
  incomingMeasure: string;
  outgoingMeasure: string;
  compression: string;
}

export type ServerDebugResult =
  | { ok: true; state: ServerTelemetryDebug; loadedAt: number }
  | { ok: false; status: number };

export async function fetchServerDebug(carId: number, fetchImpl: typeof fetch = fetch, now: () => number = Date.now): Promise<ServerDebugResult> {
  try {
    const res = await fetchImpl(`/api/cars/${carId}/overlay/telemetry-debug`, { cache: "no-store" });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, state: (await res.json()) as ServerTelemetryDebug, loadedAt: now() };
  } catch {
    return { ok: false, status: 0 };
  }
}

/**
 * The panel's use of a provider. Reading is free of side effects; only
 * setRequestAll(true) adds a requirement, and close() always releases it.
 */
export class TelemetryDiagnosticsSession {
  private all: Requirement | undefined;
  private allNames = "";

  private releaseMeter: (() => void) | undefined;
  private clientBase: Record<"tlm" | "ctl", TrafficRate["total"]> | undefined;
  private serverBase: ServerTraffic | undefined;

  constructor(private readonly provider: CarSourceProvider, private readonly meter?: TrafficMeter) {}

  /** Starts measuring the received traffic; totals count from here. */
  open() {
    if (this.releaseMeter || !this.meter) return;
    this.releaseMeter = this.meter.activate();
    this.clientBase = { tlm: this.meter.rate("tlm", this.provider.carId).total, ctl: this.meter.rate("ctl", this.provider.carId).total };
    this.serverBase = undefined;
  }

  /** Client and server traffic side by side, totals since open(). */
  traffic(server?: ServerTraffic): TrafficRow[] {
    if (server && !this.serverBase) this.serverBase = server;
    const rows: TrafficRow[] = [];
    if (this.meter) {
      const compression = this.meter.compression;
      for (const kind of ["tlm", "ctl"] as const) {
        const r = this.meter.rate(kind, this.provider.carId);
        const base = this.clientBase?.[kind] ?? { messages: 0, bytes: 0, realBytes: 0 };
        rows.push({
          key: kind === "tlm" ? "browserTlm" : "browserCtl",
          perSecond: r.perSecond,
          bytesPerSecond: r.bytesPerSecond,
          realBytesPerSecond: r.realBytesPerSecond,
          compression,
          total: { messages: r.total.messages - base.messages, bytes: r.total.bytes - base.bytes, realBytes: r.total.realBytes - base.realBytes },
        });
      }
    }
    if (server) rows.push(...serverTrafficRows(server, this.serverBase));
    return rows;
  }

  get requestingAll() {
    return this.all !== undefined;
  }

  setRequestAll(on: boolean) {
    if (!on) {
      this.all?.release();
      this.all = undefined;
      this.allNames = "";
      return;
    }
    this.refresh(true);
  }

  /** Keeps "all channels" in step with the channel list once metadata arrives. */
  refresh(force = false) {
    if (!this.all && !force) return;
    const names = this.provider.channels().map((c) => c.name).sort();
    const key = names.join("\n");
    if (this.all && key === this.allNames) return;
    this.allNames = key;
    this.all = this.provider.require(ALL_CHANNELS_CONSUMER, names.map((name) => ({ kind: "tel" as const, name })));
  }

  snapshot(): ProviderDiagnostics {
    return this.provider.diagnostics();
  }

  close() {
    this.setRequestAll(false);
    this.releaseMeter?.();
    this.releaseMeter = undefined;
  }
}

export type TrafficRowKey = "browserTlm" | "browserCtl" | "serverIn" | "serverOut" | "client";

export interface TrafficRow {
  key: TrafficRowKey;
  /** Anonymous client number (1 = busiest), only for "client". */
  index?: number;
  perSecond: number;
  /** null: not measured. */
  bytesPerSecond: number | null;
  realBytesPerSecond: number | null;
  /** WebSocket compression of this hop; "none" = compressed equals transferred. */
  compression: WsCompression;
  /** Since the panel opened (server: since the first server state of this opening); null if unknown. */
  total: { messages: number; bytes: number; realBytes: number } | null;
}

const serverCompression = (c: string): WsCompression => (c === "none" ? "none" : c === "deflate" ? "deflate" : "unknown");

export function serverTrafficRows(server: ServerTraffic, base?: ServerTraffic): TrafficRow[] {
  const since = (now: ServerTrafficRate, then?: ServerTrafficRate) => ({
    messages: now.total.messages - (then?.total.messages ?? now.total.messages),
    bytes: now.total.bytes - (then?.total.bytes ?? now.total.bytes),
    realBytes: now.total.realBytes - (then?.total.realBytes ?? now.total.realBytes),
  });
  const compression = serverCompression(server.compression);
  const row = (key: TrafficRowKey, r: ServerTrafficRate, then?: ServerTrafficRate): TrafficRow => ({
    key,
    perSecond: r.perSecond,
    bytesPerSecond: r.bytesPerSecond ?? null,
    realBytesPerSecond: r.realBytesPerSecond ?? null,
    compression,
    total: since(r, then),
  });
  return [
    row("serverIn", server.incoming, base?.incoming),
    row("serverOut", server.outgoing, base?.outgoing),
    ...server.clients.map((c, i): TrafficRow => ({
      key: "client", index: i + 1, perSecond: c.perSecond, bytesPerSecond: c.bytesPerSecond ?? null,
      realBytesPerSecond: null, compression, total: null,
    })),
  ];
}

/** Messages flow but the server has no byte figures yet (it measures only while asked). */
export function serverUnmeasured(t: ServerTraffic | undefined): boolean {
  if (!t) return false;
  return (t.incoming.perSecond > 0 && t.incoming.bytesPerSecond == null) || (t.outgoing.perSecond > 0 && t.outgoing.bytesPerSecond == null);
}

/** B/s below 1000, then kB/s and MB/s (decimal units). */
export function formatBytes(bytes: number | null | undefined, perSecond = false): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "–";
  const unit = perSecond ? "/s" : "";
  if (bytes < 1000) return `${Math.round(bytes)} B${unit}`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} kB${unit}`;
  return `${(bytes / 1_000_000).toFixed(2)} MB${unit}`;
}

export function formatPerSecond(n: number): string {
  return n >= 10 ? `${Math.round(n)}/s` : `${n.toFixed(1)}/s`;
}

/** real ÷ transferred, e.g. "×3.2"; how much delta and compact coding save. */
export function savingFactor(real: number | null, transferred: number | null): string {
  if (!real || !transferred) return "–";
  return `×${(real / transferred).toFixed(1)}`;
}

export interface DiagnosticsRow {
  id: number;
  name?: string;
  dataType?: string;
  client?: ChannelDiagnostics;
  server?: ServerChannelDebug;
}

/** Client and server state side by side, one row per channel id. */
export function diagnosticsRows(client: ProviderDiagnostics, server?: ServerTelemetryDebug): DiagnosticsRow[] {
  const rows = new Map<number, DiagnosticsRow>();
  for (const c of client.channels) rows.set(c.id, { id: c.id, name: c.name, dataType: c.dataType, client: c });
  for (const s of server?.channels ?? []) {
    const row = rows.get(s.id) ?? { id: s.id };
    row.server = s;
    row.name ??= s.name ?? undefined;
    row.dataType ??= s.dataType ?? undefined;
    rows.set(s.id, row);
  }
  return [...rows.values()].sort((a, b) => a.id - b.id);
}

export function truncate(raw: string | undefined, max = 40): string {
  if (raw === undefined) return "";
  return raw.length <= max ? raw : `${raw.slice(0, max)}… (${raw.length})`;
}

export function formatMs(ms: number | null | undefined): string {
  if (ms === undefined || ms === null || !Number.isFinite(ms)) return "–";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 1000)} s`;
}

/** Wall clock time of a client-clock instant, as HH:MM:SS.mmm. */
export function wallTime(at: number | undefined, clientNow: number, wallNow: number = Date.now()): string {
  if (at === undefined) return "–";
  const d = new Date(wallNow - (clientNow - at));
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

export type StateTone = "valid" | "unchecked" | "invalid";

/** valid / unchecked / invalid with reason (stale, no-data, …). */
export function stateText(value: QualifiedValue | undefined, reasons: Record<string, string>): { text: string; tone: StateTone } {
  if (!value) return { text: "–", tone: "invalid" };
  if (value.state !== "invalid") return { text: value.state, tone: value.state };
  return { text: `invalid: ${value.reason ? (reasons[value.reason] ?? value.reason) : "?"}`, tone: "invalid" };
}

export type DiagSortKey = "id" | "name" | "type" | "state" | "age" | "arrival" | "counts";
export type DiagStateFilter = "all" | StateTone;

/** What the channel table shows: text and state filter, and the sort column. */
export interface DiagTableView {
  query: string;
  state: DiagStateFilter;
  /** Only channels this client wants or has sent as interest. */
  onlyRequested: boolean;
  sort: DiagSortKey;
  desc: boolean;
}

export const DEFAULT_DIAG_VIEW: DiagTableView = { query: "", state: "all", onlyRequested: false, sort: "id", desc: false };

const STATE_ORDER: Record<StateTone, number> = { invalid: 0, unchecked: 1, valid: 2 };

function sortValue(row: DiagnosticsRow, key: DiagSortKey, tone: StateTone): number | string | undefined {
  const c = row.client;
  switch (key) {
    case "id": return row.id;
    case "name": return row.name?.toLowerCase();
    case "type": return row.dataType?.toLowerCase();
    case "state": return STATE_ORDER[tone];
    case "age": return c?.value?.ageMs ?? undefined;
    case "arrival": return c?.lastArrival;
    case "counts": return c ? c.changes + c.confirmations : undefined;
  }
}

/**
 * Filters and sorts the channel rows. The query matches id, name and type (case-insensitive, every
 * whitespace-separated term must match). Rows without a value for the sort column go last in both
 * directions; ties fall back to the id.
 */
export function filterAndSortRows(rows: DiagnosticsRow[], view: DiagTableView, reasons: Record<string, string>): DiagnosticsRow[] {
  const terms = view.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const entries = rows
    .map((row) => ({ row, tone: stateText(row.client?.value, reasons).tone }))
    .filter(({ row, tone }) => {
      if (view.state !== "all" && tone !== view.state) return false;
      if (view.onlyRequested && !(row.client?.wanted || row.client?.sent)) return false;
      if (terms.length === 0) return true;
      const haystack = `${row.id} ${row.name ?? ""} ${row.dataType ?? ""}`.toLowerCase();
      return terms.every((t) => haystack.includes(t));
    })
    .map((e) => ({ ...e, key: sortValue(e.row, view.sort, e.tone) }));
  const dir = view.desc ? -1 : 1;
  entries.sort((a, b) => {
    if (a.key === undefined || b.key === undefined) {
      if (a.key !== b.key) return a.key === undefined ? 1 : -1;
    } else if (a.key !== b.key) {
      const cmp = typeof a.key === "number" && typeof b.key === "number" ? a.key - b.key : String(a.key).localeCompare(String(b.key));
      if (cmp !== 0) return cmp * dir;
    }
    return a.row.id - b.row.id;
  });
  return entries.map((e) => e.row);
}
