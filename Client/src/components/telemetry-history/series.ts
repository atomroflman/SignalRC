// Evaluates dashboard formulas over recorded samples. The formulas are the
// overlay expression language (Shared/Overlay/expression/README.md) with
// tel("channel") as the only source; values are held until the next sample
// for at most `holdMs`, after that they count as missing.
import { analyze, evaluate, type Analysis, type ExprType, type SourceValue, type ValueSource } from "@/components/overlay/expression";
import type { TelemetryDataType } from "@/components/overlay/expression/analyze";
import type { ChannelData, DashboardLayout, HistoryChannel, PanelDef } from "./types";

/** A sample is held this long at least; recorded channels repeat unchanged values every second. */
export const MIN_HOLD_MS = 3000;

export interface CompiledSeries {
  analysis: Analysis;
  /** Telemetry channel names the formula reads. */
  channels: string[];
  /** First diagnostic, or why the formula cannot be plotted. */
  error?: string;
  type: ExprType;
}

export function compile(expr: string, telemetry: Record<string, TelemetryDataType>): CompiledSeries {
  // Outputs and signals are not recorded: listing none makes them unknown sources.
  const analysis = analyze(expr, { telemetry, outputs: [], signals: [] }, "any");
  const channels = [...new Set(analysis.dependencies.filter(d => d.kind === "tel").map(d => d.name))];
  let error = analysis.diagnostics[0]?.message;
  if (!error && analysis.dependencies.some(d => d.kind === "driver")) error = "driverActive() ist in der Historie nicht verfügbar";
  if (!error && analysis.type === "text") error = "Ergebnis muss eine Zahl oder ein Wahrheitswert sein";
  return { analysis, channels, error, type: analysis.type };
}

export function telemetryTypes(channels: HistoryChannel[]): Record<string, TelemetryDataType> {
  return Object.fromEntries(channels.map(c => [c.name, c.dataType]));
}

/**
 * The formula at every time any of its channels has a sample (step hold).
 * A formula without channels is drawn as a constant over [from, to].
 */
export function evaluateSeries(
  compiled: CompiledSeries,
  data: Record<string, ChannelData | undefined>,
  holdMs: number,
  range: { from: number; to: number },
): ChannelData {
  if (compiled.error || !compiled.analysis.ast) return { t: [], v: [] };
  const inputs = compiled.channels.map(name => ({ name, d: data[name] ?? { t: [], v: [] }, i: -1 }));
  const times = inputs.length === 0 ? [range.from, range.to] : mergeTimes(inputs.map(x => x.d.t));

  const current = new Map<string, SourceValue>();
  const source: ValueSource = {
    get: (kind, name) => (kind === "tel" ? current.get(name) : undefined) ?? { state: "invalid" },
    driverActive: () => false,
  };

  const t: number[] = [];
  const v: (number | null)[] = [];
  for (const time of times) {
    for (const input of inputs) {
      const { d } = input;
      while (input.i + 1 < d.t.length && d.t[input.i + 1] <= time) input.i++;
      const value = input.i >= 0 ? d.v[input.i] : null;
      const fresh = input.i >= 0 && time - d.t[input.i] <= holdMs;
      current.set(input.name, value === null || !fresh ? { state: "invalid" } : { state: "valid", value: String(value) });
    }
    const r = evaluate(compiled.analysis, source);
    t.push(time);
    if (r.state === "invalid") v.push(null);
    else if (typeof r.value === "number") v.push(r.value);
    else if (typeof r.value === "boolean") v.push(r.value ? 1 : 0);
    else v.push(null);
  }
  return { t, v };
}

/** Sorted union of sorted time arrays. */
export function mergeTimes(arrays: number[][]): number[] {
  if (arrays.length === 1) return arrays[0].slice();
  const all = arrays.flat().sort((a, b) => a - b);
  const out: number[] = [];
  for (const x of all) if (out.length === 0 || out[out.length - 1] !== x) out.push(x);
  return out;
}

/** Appends newer samples (live follow); samples not newer than the last one are dropped. */
export function appendSamples(target: Record<string, ChannelData>, fresh: Record<string, ChannelData>): Record<string, ChannelData> {
  const out = { ...target };
  for (const [key, add] of Object.entries(fresh)) {
    const old = out[key] ?? { t: [], v: [] };
    const last = old.t.length > 0 ? old.t[old.t.length - 1] : -Infinity;
    let start = 0;
    while (start < add.t.length && add.t[start] <= last) start++;
    if (start >= add.t.length) continue;
    out[key] = { t: old.t.concat(add.t.slice(start)), v: old.v.concat(add.v.slice(start)) };
  }
  return out;
}

export function newestTime(data: Record<string, ChannelData>): number | undefined {
  let newest: number | undefined;
  for (const d of Object.values(data)) {
    const last = d.t[d.t.length - 1];
    if (last !== undefined && (newest === undefined || last > newest)) newest = last;
  }
  return newest;
}

export interface SeriesStats { min: number; max: number; last: number | null }

export function stats(d: ChannelData, from = -Infinity, to = Infinity): SeriesStats | undefined {
  let min = Infinity;
  let max = -Infinity;
  let last: number | null = null;
  for (let i = 0; i < d.t.length; i++) {
    if (d.t[i] < from || d.t[i] > to) continue;
    const x = d.v[i];
    last = x;
    if (x === null) continue;
    if (x < min) min = x;
    if (x > max) max = x;
  }
  return min === Infinity ? undefined : { min, max, last };
}

export const PALETTE = ["#38bdf8", "#f97316", "#a3e635", "#e879f9", "#facc15", "#2dd4bf", "#f87171", "#818cf8"];

let counter = 0;
export const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`;

/** One chart per unit with all recorded channels of that unit. */
export function defaultLayout(channels: HistoryChannel[]): DashboardLayout {
  const byUnit = new Map<string, HistoryChannel[]>();
  for (const c of channels) {
    const key = c.unit?.trim() || (c.dataType === "Boolean" ? "bool" : "");
    byUnit.set(key, [...(byUnit.get(key) ?? []), c]);
  }
  const panels: PanelDef[] = [...byUnit.entries()].map(([unit, list]) => ({
    id: newId("p"),
    title: unit ? `${list.map(c => c.name).join(", ")} (${unit})` : list.map(c => c.name).join(", "),
    series: list.map((c, i) => ({
      id: newId("s"),
      label: c.name,
      expr: `tel("${c.name}")`,
      color: PALETTE[i % PALETTE.length],
      unit: c.unit ?? undefined,
      decimals: c.decimals ?? undefined,
    })),
  }));
  return { version: 1, panels };
}

export function isLayout(x: unknown): x is DashboardLayout {
  if (!x || typeof x !== "object") return false;
  const l = x as DashboardLayout;
  return l.version === 1 && Array.isArray(l.panels)
    && l.panels.every(p => p && typeof p.id === "string" && Array.isArray(p.series)
      && p.series.every(s => s && typeof s.id === "string" && typeof s.expr === "string"));
}

export function formatValue(x: number | null | undefined, decimals?: number): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "–";
  const d = decimals ?? (Math.abs(x) >= 100 ? 0 : Math.abs(x) >= 10 ? 1 : 2);
  return x.toFixed(d);
}
