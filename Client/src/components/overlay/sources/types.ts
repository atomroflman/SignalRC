// AP05 – shared types of the client telemetry and control display sources
// (Shared/Overlay/telemetry/README.md §3, §6, §7; modules/README.md §1).
import type { Dependency, SourceValue, ValueSource } from "../expression";
import type { TelemetryDataType } from "../expression/analyze";

export type { Dependency, SourceValue, ValueSource, ValueState } from "../expression";
export type { TelemetryDataType } from "../expression/analyze";

/** Sample state codes on the wire (telemetry §3). */
export const SampleState = { Valid: 0, Unchecked: 1, Stale: 2, Error: 3, NoData: 4 } as const;
export type SampleStateCode = (typeof SampleState)[keyof typeof SampleState];

/** Why a source value is invalid (telemetry §3). */
export type InvalidReason =
  | "source-error"
  | "stale"
  | "no-data"
  | "transport"
  | "vehicle-offline"
  | "parse"
  | "waiting";

/** A source value with the reason for invalidity and the current age, where known. */
export interface QualifiedValue extends SourceValue {
  reason?: InvalidReason;
  /** Age of the measurement (tel) or of the last message (out/sig) in ms. */
  ageMs?: number;
}

/** Channel metadata from GET /api/car/{id}/telemetry (telemetry §6). */
export interface ChannelMetadata {
  id: number;
  name: string;
  dataType: TelemetryDataType;
  unit?: string | null;
  decimals?: number | null;
  /** Read interval in onboard ticks of 100 ms; the expected interval is 100 ms × ticks. */
  readIntervalTicks?: number;
  /** LiDAR zone upper limits in mm (LiDAR §1), only for LidarGrid channels. */
  zoneLimitsMm?: number[];
  /** The viewer's saved personal selection for the manual telemetry bar. */
  subscribed: boolean;
}

/** Monotonic milliseconds and timers; injectable so that aging is testable. */
export interface TimerClock {
  now(): number;
  setTimer(cb: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

export const systemClock: TimerClock = {
  now: () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
  setTimer: (cb, ms) => setTimeout(cb, ms),
  clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** Per-consumer options of a requirement. */
export interface RequireOptions {
  /** HUD overrides `sources.telemetry[name].staleAfterMs` (D24). */
  staleAfterMs?: Record<string, number | undefined>;
}

export interface Requirement {
  release(): void;
  /** Values as this consumer sees them, i.e. with its deadline overrides. */
  source: OverlayValueSource;
}

/** The decoded LiDAR base grid (LiDAR §4, §5). */
export interface LidarGrid {
  version: 1;
  complete: boolean;
  /** 96 cells × 5 zones at index `cell * 5 + zone`, centimetres, 0xFFFF = empty. */
  cm: Uint16Array;
}

export interface LidarGridValue extends QualifiedValue {
  grid?: LidarGrid;
  zoneLimitsMm?: number[];
}

/** ValueSource of AP06 plus reasons, LiDAR grids and the driver value. */
export interface OverlayValueSource extends ValueSource {
  get(kind: "tel" | "out" | "sig", name: string): QualifiedValue;
  lidarGrid(name: string): LidarGridValue;
  /** driverActive() as a source value; invalid without hub connection. */
  driverActiveValue(): QualifiedValue;
}

/** The provider role of modules/README.md §1. */
export interface OverlaySourceProvider extends OverlayValueSource {
  require(consumerId: string, deps: Dependency[], options?: RequireOptions): Requirement;
  metadata(name: string): ChannelMetadata | undefined;
  subscribe(listener: () => void): () => void;
}
