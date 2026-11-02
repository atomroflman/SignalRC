// AP12 – template definitions: editable starting points that are inserted as
// ordinary elements and clips through editor commands. A template declares the
// channels it needs (slots); it never invents sensor values.
import type { Clip, OverlayElement } from "../document/types";
import type { Locale } from "../runtime/types";

export type Text = Record<Locale, string>;

/** Explicit unit conversion: value · factor + offset. */
export interface Conversion {
  factor: number;
  offset: number;
}

export interface ConversionPreset extends Conversion {
  id: string;
  label: Text;
  /** Channel units (lower case) this preset converts from. */
  from: string[];
}

export interface TemplateSlot {
  id: string;
  label: Text;
  /** `number`: Integer/Number telemetry; `lidarGrid`: a LidarGrid channel (no conversion). */
  kind: "number" | "lidarGrid";
  /** Unit the template expects after conversion. */
  unit?: string;
  presets?: ConversionPreset[];
}

export type TemplateParam =
  | { id: string; label: Text; type: "number"; default: number; min?: number; max?: number }
  | { id: string; label: Text; type: "bool"; default: boolean }
  | { id: string; label: Text; type: "choice"; default: number; values: number[] };

export type ParamValue = number | boolean;

export interface BuildContext {
  /** Formula of a number slot incl. conversion, e.g. `(tel("yaw") * 57.29578)`. */
  ref(slot: string): string;
  /** Channel name of a slot (LiDAR source). */
  channel(slot: string): string;
  param<T extends ParamValue = number>(id: string): T;
  locale: Locale;
}

/** Content with template-local ids; instantiate() assigns fresh e_/c_ ids. */
export interface TemplateContent {
  elements: Record<string, OverlayElement>;
  /** Exactly one root group keeps the template movable as a whole. */
  root: string;
  clips?: Record<string, Clip>;
}

export interface TemplateDefinition {
  id: string;
  name: Text;
  description: Text;
  slots: TemplateSlot[];
  params: TemplateParam[];
  /** Size of the root group's box (for placement). */
  size: { width: number; height: number };
  build(ctx: BuildContext): TemplateContent;
}

/** User choice per slot when inserting. */
export interface SlotAssignment {
  channel: string;
  conversion?: Conversion;
}

export interface TemplateMapping {
  slots: Record<string, SlotAssignment | undefined>;
  params?: Record<string, ParamValue>;
}
