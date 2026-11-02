// AP10 – channel directory for the binding editor: telemetry channels with
// type/unit/decimals (AP05 metadata, GET api/cars/{carId}/overlay/sources),
// output names and the document's signals.
import type { SignalDefinition, SourceCatalog } from "../../document/types";
import type { AnalysisEnv } from "../../expression";
import { parseChannelMetadata } from "../../sources/provider";
import type { ChannelMetadata } from "../../sources/types";

export interface ChannelDirectory {
  /** Telemetry channels by name; undefined = not known here (formulas are then not checked against it). */
  telemetry?: ChannelMetadata[];
  /** Output names for out(); undefined = not known here. */
  outputs?: string[];
}

export interface ChannelDirectoryInput {
  /** Channel metadata, e.g. from CarSourceProvider.channels(). */
  channels?: ChannelMetadata[];
  /** Fallback: the validation catalog of the editor (types only). */
  sources?: SourceCatalog;
}

const byName = (a: { name: string }, b: { name: string }) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

export function channelDirectory(input: ChannelDirectoryInput): ChannelDirectory {
  let telemetry: ChannelMetadata[] | undefined;
  if (input.channels && input.channels.length > 0) telemetry = [...input.channels].sort(byName);
  else if (input.sources) {
    telemetry = Object.entries(input.sources.telemetry).map(([name, dataType], i) => ({ id: -1 - i, name, dataType })).sort(byName);
  }
  const outputs = input.sources ? [...input.sources.outputs].sort() : undefined;
  return { telemetry, outputs };
}

/** Parses the viewer source catalog (api/README.md, `GET sources`). */
export function parseSourcesResponse(raw: unknown): ChannelDirectory {
  const r = (raw ?? {}) as { telemetry?: unknown; outputs?: unknown };
  const telemetry = (Array.isArray(r.telemetry) ? r.telemetry : [])
    .map(parseChannelMetadata)
    .filter((m): m is ChannelMetadata => !!m)
    .sort(byName);
  const outputs = (Array.isArray(r.outputs) ? r.outputs : [])
    .filter((o): o is { channelName: string } => !!o && typeof (o as { channelName?: unknown }).channelName === "string")
    .map((o) => o.channelName)
    .sort();
  return { telemetry, outputs };
}

/** Loads the directory of a car; for hosts without a source provider. */
export async function loadChannelDirectory(carId: number, fetchJson: (url: string) => Promise<unknown>): Promise<ChannelDirectory> {
  return parseSourcesResponse(await fetchJson(`/api/cars/${carId}/overlay/sources`));
}

/** The validation catalog for EditorStore.setResolveContext. */
export function sourceCatalog(dir: ChannelDirectory): SourceCatalog | undefined {
  if (!dir.telemetry) return undefined;
  return { telemetry: Object.fromEntries(dir.telemetry.map((c) => [c.name, c.dataType])), outputs: dir.outputs ?? [] };
}

/** Analysis environment of AP06 for the current document. */
export function analysisEnv(dir: ChannelDirectory, signals: Record<string, SignalDefinition> | undefined): AnalysisEnv {
  const env: AnalysisEnv = { signals: Object.keys(signals ?? {}) };
  if (dir.telemetry) env.telemetry = Object.fromEntries(dir.telemetry.map((c) => [c.name, c.dataType]));
  if (dir.outputs) env.outputs = dir.outputs;
  return env;
}

export function channelInfo(dir: ChannelDirectory, name: string): ChannelMetadata | undefined {
  return dir.telemetry?.find((c) => c.name === name);
}

export interface BindableSource {
  kind: "tel" | "out" | "sig";
  name: string;
  unit?: string | null;
  decimals?: number | null;
  dataType?: string;
}

/**
 * Sources offered by the channel picker for a result kind (expression §3):
 * numbers for numeric kinds, Boolean for bool, String for text/color; out()
 * and sig() are numbers. LiDAR grids are no formula values.
 */
export function bindableSources(dir: ChannelDirectory, signals: Record<string, SignalDefinition> | undefined, expected: string): BindableSource[] {
  const required = expected === "bool" ? "bool" : expected === "text" || expected === "color" ? "text" : expected === "any" ? "any" : "number";
  const fits = (t: string) => required === "any" ? t !== "LidarGrid"
    : required === "number" ? t === "Number" || t === "Integer" : required === "bool" ? t === "Boolean" : t === "String";
  const out: BindableSource[] = (dir.telemetry ?? []).filter((c) => fits(c.dataType))
    .map((c) => ({ kind: "tel" as const, name: c.name, unit: c.unit, decimals: c.decimals, dataType: c.dataType }));
  if (required === "number" || required === "any") {
    for (const name of dir.outputs ?? []) out.push({ kind: "out", name });
    for (const [name, s] of Object.entries(signals ?? {}).sort(([a], [b]) => (a < b ? -1 : 1))) {
      out.push({ kind: "sig", name, unit: s.unit, decimals: s.decimals });
    }
  }
  return out;
}
