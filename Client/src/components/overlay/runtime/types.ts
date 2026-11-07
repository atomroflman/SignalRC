// AP08 – public types of the overlay runtime and renderer
// (Shared/Overlay/modules/README.md §1, runtime/README.md).
import type { AssetMetadata, DiagnosticLocation } from "../document/types";
import type { TelemetryDataType } from "../expression/analyze";
import type { ClipPhase } from "./clip";

export type { ClipPhase } from "./clip";

/** Monotonic clock in seconds with a frame signal (runtime §1). */
export interface Clock {
  now(): number;
  /** Calls `cb(t)` once per frame until the returned function is called. */
  onFrame(cb: (t: number) => void): () => void;
}

export type RenderMode = "live" | "preview" | "design";
export type Locale = "de" | "en";

/** Scrubbing in design mode: track values of one clip at local time τ (runtime §7). */
export interface Scrub {
  clipId: string;
  tau: number;
}

/** Data quality markers (runtime §3), priority invalid > unchecked > paused. */
export type Marker = "invalid" | "unchecked" | "paused";

/** A normalized asset as delivered by the asset processing (svg/README.md §1, §4). */
export interface RuntimeAsset {
  /** Normalized output `<svg viewBox="0 0 W H">…</svg>`. */
  svg: string;
  metadata?: AssetMetadata;
}

/** Channel information the runtime needs: formula types and valueText defaults. */
export interface ChannelInfo {
  dataType: TelemetryDataType;
  unit?: string | null;
  decimals?: number | null;
}

export interface RuntimeDiagnostic {
  code: string;
  severity: "error" | "warning";
  location: DiagnosticLocation;
  message: string;
}

export interface LidarFieldFrame {
  /** Displayed distance in m; undefined = idle field. */
  distanceM?: number;
  color: string;
  opacity: number;
}

/** One displayed cell of the contour (lidar §6.2); stable while the display does not change. */
export interface LidarContourCell {
  cell: number;
  distanceM: number;
  zone: number;
  color: string;
  /** Joined to the cell before / after (mod 96). */
  joinPrev: boolean;
  joinNext: boolean;
}

export interface LidarContourFrame {
  /** Displayed cells in ascending cell order; the same array while nothing but the pulse changes. */
  cells: readonly LidarContourCell[];
  /** Pulse opacity per entry of `cells`. */
  opacity: number[];
}

export interface LidarFrame {
  sectors: number;
  /** `sectors × 5` fields at index `sector * 5 + zone`; empty in contour mode. */
  fields: LidarFieldFrame[];
  /** Present in contour mode only. */
  contour?: LidarContourFrame;
  zoneLimitsMm: number[];
  /** Sweep angle in degrees, absent when no sweep is shown. */
  sweepDeg?: number;
}

export interface ElementFrame {
  /** Displayed property values (catalog defaults filled in). */
  props: Record<string, unknown>;
  /** Property markers by property name. */
  markers: Record<string, Marker>;
  /** svgAsset parts: displayed values of explicitly configured parts. */
  parts: Record<string, { props: Record<string, unknown>; markers: Record<string, Marker> }>;
  /** Element marker: worst of its properties, parts and widget state. */
  marker?: Marker;
  /** onInvalid: "hide" with an invalid marker. */
  hidden: boolean;
  /** valueText: the value is not usable and shows "—". */
  noValue?: boolean;
  lidar?: LidarFrame;
}

export interface ClipFrame {
  phase: ClipPhase;
  tau?: number;
  marker?: Marker;
}

/**
 * A shown picture-in-picture element (videoStream): where the host lays its
 * video. `matrix` maps the element's local box (0,0)–(width,height) into
 * workspace units, root transform included; `opacity` includes the groups'.
 */
export interface VideoSlot {
  element: string;
  /** StreamId of the shown stream. */
  source: string;
  matrix: readonly [number, number, number, number, number, number];
  width: number;
  height: number;
  cornerRadius: number;
  fit: "cover" | "contain";
  background: string;
  opacity: number;
}

export interface FrameResult {
  t: number;
  elements: Record<string, ElementFrame>;
  clips: Record<string, ClipFrame>;
  diagnostics: RuntimeDiagnostic[];
}
