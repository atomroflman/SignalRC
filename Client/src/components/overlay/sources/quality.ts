// Quality and age evaluation (Shared/Overlay/telemetry/README.md §3, D24).
import type { ChannelMetadata, InvalidReason, QualifiedValue, SampleStateCode, TelemetryDataType } from "./types";
import { SampleState } from "./types";

/** Onboard base tick (Onboard/Program.cs). */
export const BASE_TICK_MS = 100;
/** Shortest allowed HUD deadline (D60, schema minimum). */
export const MIN_STALE_AFTER_MS = 500;
/** Deadline of control display values (D31). */
export const CONTROL_STALE_AFTER_MS = 1000;

/**
 * Default deadline max(3 × expected interval, 1000 ms) (D24). The onboard
 * reads every max(1, ticks) ticks, so a missing tick count counts as 1.
 */
export function defaultStaleAfterMs(meta: Pick<ChannelMetadata, "readIntervalTicks">): number {
  const ticks = Math.max(1, Math.floor(meta.readIntervalTicks ?? 1));
  return Math.max(3 * BASE_TICK_MS * ticks, 1000);
}

/** The HUD override wins over the default; it is never shorter than 500 ms. */
export function staleAfterMs(meta: Pick<ChannelMetadata, "readIntervalTicks">, override?: number): number {
  if (override !== undefined && Number.isFinite(override)) return Math.max(MIN_STALE_AFTER_MS, override);
  return defaultStaleAfterMs(meta);
}

const NUMBER_TEXT = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** Same parse rules as the expression evaluator (expression §4). */
export function parsesAs(raw: string, type: TelemetryDataType): boolean {
  if (raw === "") return false;
  switch (type) {
    case "Integer":
    case "Number":
      return NUMBER_TEXT.test(raw) && Number.isFinite(Number(raw));
    case "Boolean": {
      const t = raw.toLowerCase();
      return t === "1" || t === "0" || t === "true" || t === "false";
    }
    default:
      return true;
  }
}

/** A cached sample as received: value, state and age at reception. */
export interface Sample {
  value: string;
  state: SampleStateCode;
  ageMs: number;
  /** Client clock (ms) at reception of the last message for this channel. */
  receivedAt: number;
}

export interface Context {
  connected: boolean;
  /** False only when the vehicle is known to be offline. */
  vehicleOnline: boolean;
  now: number;
}

const invalid = (reason: InvalidReason, ageMs?: number): QualifiedValue =>
  ageMs === undefined ? { state: "invalid", reason } : { state: "invalid", reason, ageMs };

/**
 * Evaluates one telemetry sample (telemetry §3, "Bewertung im Client").
 * A source error, a stale or missing source stays invalid whatever the
 * deadline; age = ageMs + (now − receivedAt).
 */
export function evaluateSample(
  sample: Sample | undefined,
  deadlineMs: number,
  ctx: Context,
  dataType: TelemetryDataType,
): QualifiedValue {
  if (!ctx.connected) return invalid("transport");
  if (!ctx.vehicleOnline) return invalid("vehicle-offline");
  if (!sample) return invalid("waiting");
  const ageMs = sample.ageMs + Math.max(0, ctx.now - sample.receivedAt);
  switch (sample.state) {
    case SampleState.Error: return invalid("source-error", ageMs);
    case SampleState.Stale: return invalid("stale", ageMs);
    case SampleState.NoData: return invalid("no-data", ageMs);
  }
  if (ageMs > deadlineMs) return invalid("stale", ageMs);
  if (!parsesAs(sample.value, dataType)) return invalid("parse", ageMs);
  return { state: sample.state === SampleState.Valid ? "valid" : "unchecked", value: sample.value, ageMs };
}

/** Client time at which the sample exceeds the deadline, or undefined if it cannot become stale by aging. */
export function expiresAt(sample: Sample, deadlineMs: number): number | undefined {
  if (sample.state !== SampleState.Valid && sample.state !== SampleState.Unchecked) return undefined;
  return sample.receivedAt - sample.ageMs + deadlineMs;
}
