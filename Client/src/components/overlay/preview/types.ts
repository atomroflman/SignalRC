// AP11 – local preview simulation settings (Overlay-Feature.md "Lokale
// Simulation"). Editor-local state of one tab: not document content, never
// saved with the draft, never sent anywhere.
import type { TelemetryDataType } from "../sources/types";

export type SourceKind = "tel" | "out" | "sig";

/** One LiDAR obstacle in the corrected angle (0° = front, clockwise; LiDAR §2). */
export interface LidarObstacle {
  angleDeg: number;
  widthDeg: number;
  distanceMm: number;
  /** Optional distance oscillation: distance + swing · sin(2πt / period). */
  swingMm?: number;
  periodS?: number;
}

/** How a simulated value changes over the preview time t (seconds). */
export type Generator =
  | { kind: "fixed"; value: string | number | boolean }
  | { kind: "slider"; value: number; min: number; max: number; step?: number }
  /** from → to within periodS, then again ("saw") or back ("triangle"). */
  | { kind: "ramp"; from: number; to: number; periodS: number; shape?: "saw" | "triangle" }
  | { kind: "sine"; offset: number; amplitude: number; periodS: number; phaseDeg?: number }
  /** Synthetic base grid in the contract format (LiDAR §4, §5). */
  | { kind: "lidar"; obstacles: LidarObstacle[]; complete?: boolean; rotateDegPerS?: number };

export type GeneratorKind = Generator["kind"];

/**
 * Simulated quality (telemetry §3): valid/unchecked carry the value; missing
 * = no value yet (NoData), error = source error, stale = older than the
 * deadline. Invalid text (parse) is simulated with a fixed text value.
 */
export type SimQuality = "valid" | "unchecked" | "missing" | "error" | "stale";

export interface ChannelOverride {
  generator: Generator;
  quality?: SimQuality;
  /** Simulated measurement age in ms (tel); "stale" uses at least deadline + 1. */
  ageMs?: number;
  /** out/sig: the paused/not-sent flag (D09). */
  paused?: boolean;
}

export interface SimulationSettings {
  /** Overrides by `kind:name`. */
  overrides: Record<string, ChannelOverride>;
  /** Test mode: every required value not overridden is simulated with a default. */
  simulateAll: boolean;
  /** Simulated driverActive(); undefined = live. */
  driverActive?: boolean;
}

export const EMPTY_SETTINGS: SimulationSettings = { overrides: {}, simulateAll: false };

export const simKey = (kind: SourceKind, name: string) => `${kind}:${name}`;

export function parseSimKey(key: string): { kind: SourceKind; name: string } | undefined {
  const i = key.indexOf(":");
  const kind = key.slice(0, i);
  if (kind !== "tel" && kind !== "out" && kind !== "sig") return undefined;
  return { kind, name: key.slice(i + 1) };
}

export type { TelemetryDataType };
