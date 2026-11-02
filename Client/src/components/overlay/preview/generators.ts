// Value generators of the preview simulation: pure functions of the preview
// time t in seconds, so a run with a controlled clock is reproducible.
import { DEFAULT_LIDAR_OBSTACLES, encodeLidarGrid, synthLidarCells } from "./lidar-synth";
import type { Generator, SourceKind, TelemetryDataType } from "./types";

/** True when the value changes with time alone. */
export function isDynamic(g: Generator): boolean {
  switch (g.kind) {
    case "ramp":
    case "sine":
      return g.periodS > 0;
    case "lidar":
      return !!g.rotateDegPerS || g.obstacles.some((o) => !!o.swingMm && !!o.periodS);
    default:
      return false;
  }
}

/** Numeric value of a generator at t; undefined for non-numeric ones. */
export function numberAt(g: Generator, t: number): number | undefined {
  switch (g.kind) {
    case "fixed":
      return typeof g.value === "number" ? g.value : typeof g.value === "boolean" ? (g.value ? 1 : 0) : Number.isFinite(Number(g.value)) && g.value !== "" ? Number(g.value) : undefined;
    case "slider":
      return Math.min(Math.max(g.value, g.min), g.max);
    case "ramp": {
      if (!(g.periodS > 0)) return g.from;
      const p = (((t / g.periodS) % 1) + 1) % 1;
      const f = g.shape === "triangle" ? (p < 0.5 ? p * 2 : 2 - p * 2) : p;
      return g.from + (g.to - g.from) * f;
    }
    case "sine":
      if (!(g.periodS > 0)) return g.offset;
      return g.offset + g.amplitude * Math.sin((2 * Math.PI * t) / g.periodS + ((g.phaseDeg ?? 0) * Math.PI) / 180);
    default:
      return undefined;
  }
}

/** Raw telemetry text as a reader would send it (telemetry values are text). */
export function telemetryText(g: Generator, t: number, dataType: TelemetryDataType | undefined, zoneLimitsMm?: number[]): string {
  if (g.kind === "lidar") return encodeLidarGrid(synthLidarCells(g.obstacles, t, { rotateDegPerS: g.rotateDegPerS, zoneLimitsMm }), g.complete !== false);
  if (g.kind === "fixed" && typeof g.value === "string") return g.value;
  if (g.kind === "fixed" && typeof g.value === "boolean") return dataType === "Boolean" ? String(g.value) : g.value ? "1" : "0";
  const n = numberAt(g, t) ?? 0;
  if (dataType === "Boolean") return n >= 0.5 ? "true" : "false";
  if (dataType === "Integer") return String(Math.round(n));
  return String(Number(n.toPrecision(12)));
}

/** Default simulation of a required value in test mode or for a new override. */
export function defaultGenerator(kind: SourceKind, dataType: TelemetryDataType | undefined): Generator {
  if (kind !== "tel") return { kind: "slider", value: 0, min: -1, max: 1, step: 0.01 };
  switch (dataType) {
    case "LidarGrid":
      return { kind: "lidar", obstacles: DEFAULT_LIDAR_OBSTACLES.map((o) => ({ ...o })), complete: true };
    case "Boolean":
      return { kind: "fixed", value: false };
    case "String":
      return { kind: "fixed", value: "Test" };
    default:
      return { kind: "slider", value: 0, min: 0, max: 100, step: 1 };
  }
}

/** The data type implied by a generator, for channels without live metadata. */
export function impliedDataType(g: Generator): TelemetryDataType {
  if (g.kind === "lidar") return "LidarGrid";
  if (g.kind === "fixed" && typeof g.value === "boolean") return "Boolean";
  if (g.kind === "fixed" && typeof g.value === "string" && !Number.isFinite(Number(g.value))) return "String";
  return "Number";
}
