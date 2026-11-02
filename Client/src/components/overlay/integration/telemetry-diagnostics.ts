// Telemetry diagnostics panel: logic without React. The panel is a reading
// consumer – it never adds its own requirement, except the explicit
// "request all channels" toggle, which ends when the panel closes.
import type { CarSourceProvider, ChannelDiagnostics, LidarGridSummary, ProviderDiagnostics, QualifiedValue, Requirement } from "../sources";

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

  constructor(private readonly provider: CarSourceProvider) {}

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
  }
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
