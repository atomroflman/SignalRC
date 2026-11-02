// Types of the overlay document contract v1 (Shared/Overlay/README.md).
// The JSON schema is the authority; these types mirror it for the client.

export type Literal = number | string | boolean | null;

export interface Binding {
  expr: string;
  smoothing?: { timeConstantS: number };
}

export interface Rate {
  expr: string;
  wrap?: { min: number; max: number };
}

export interface DynamicProperty {
  base: Literal;
  binding?: Binding;
  rate?: Rate;
}

export type PropertyValue = Literal | DynamicProperty;
export type PropMap = Record<string, PropertyValue>;

export interface PartOverride {
  props?: PropMap;
  lockAspect?: boolean;
}

export type ElementType =
  | "group" | "rect" | "ellipse" | "line" | "arc" | "text" | "valueText"
  | "linearGauge" | "radialGauge" | "svgAsset" | "lidarWidget";

export interface OverlayElement {
  type: ElementType;
  name?: string;
  disabled?: boolean;
  locked?: boolean;
  editorHidden?: boolean;
  lockAspect?: boolean;
  onInvalid?: "hold" | "hide";
  props?: PropMap;
  children?: string[];
  assetId?: string;
  parts?: Record<string, PartOverride>;
  source?: string;
}

export interface Keyframe {
  t: number;
  value: Literal;
  easing?: "linear" | "easeIn" | "easeOut" | "easeInOut" | "step";
}

export interface Track {
  element: string;
  part?: string;
  property: string;
  keyframes: Keyframe[];
}

export type Trigger =
  | { mode: "auto" }
  | { mode: "whileTrue"; condition: string; onDeactivate?: "stop" | "finish" }
  | { mode: "pulse"; condition: string; retrigger?: "restart" | "ignore" };

export interface ClipSettings {
  name?: string;
  disabled?: boolean;
  durationS?: number;
  repeat?: number | "infinite";
  trigger?: Trigger;
  endState?: "base" | "hold";
  tracks?: Track[];
}

export interface Clip extends ClipSettings {
  durationS: number;
  trigger: Trigger;
  tracks: Track[];
}

export interface Workspace { width: number; height: number }
export interface RootTransform { scale: number; offsetX: number; offsetY: number }

export interface ElementOverride {
  disabled?: boolean;
  locked?: boolean;
  editorHidden?: boolean;
  lockAspect?: boolean;
  onInvalid?: "hold" | "hide";
  props?: PropMap;
  parts?: Record<string, PartOverride>;
}

export interface Variant {
  disabled?: boolean;
  workspace?: Workspace;
  rootTransform?: RootTransform;
  elements?: Record<string, ElementOverride>;
  addedElements?: Record<string, OverlayElement>;
  structure?: {
    parents?: Record<string, string>;
    order?: Record<string, string[]>;
  };
  clips?: Record<string, ClipSettings>;
  addedClips?: Record<string, Clip>;
}

export interface SignalDefinition { label: string; unit?: string; decimals?: number }

export interface OverlayDocument {
  schemaVersion: 1;
  workspace: Workspace;
  rootTransform?: RootTransform;
  disabled?: boolean;
  signals?: Record<string, SignalDefinition>;
  sources?: { telemetry?: Record<string, { staleAfterMs?: number }> };
  elements: Record<string, OverlayElement>;
  children: string[];
  clips?: Record<string, Clip>;
  variants?: Record<string, Variant>;
}

export const ROOT = "root";

// --- Diagnostics (Shared/Overlay/README.md §8) ---

export type DiagnosticCategory = "structure" | "publish" | "warning";

export interface DiagnosticLocation {
  variant?: string;
  element?: string;
  part?: string;
  property?: string;
  clip?: string;
  track?: number;
  keyframe?: number;
  container?: string;
  ref?: string;
  field?: string;
  limit?: string;
  path?: string;
  offset?: number;
}

export interface Diagnostic {
  code: string;
  category: DiagnosticCategory;
  severity: "error" | "warning";
  location: DiagnosticLocation;
  message: string;
}

// --- Validation context ---

export type TelemetryDataType = "String" | "Integer" | "Number" | "Boolean" | "LidarGrid";

export interface SourceCatalog {
  telemetry: Record<string, TelemetryDataType>;
  outputs: string[];
}

export interface AssetMetadata {
  width: number;
  height: number;
  parts: Record<string, { tag: string; bbox: [number, number, number, number] }>;
  sizeBytes?: number;
}

/** Kind a formula result must have, as named in expression/README.md §3. */
export type ExpectedKind = string;

export interface ExpressionDiagnostic {
  code: string;
  category: DiagnosticCategory;
  offset: number;
  message?: string;
}

/** Port to the expression system (AP06). Optional for AP01. */
export interface ExpressionAnalyzer {
  analyze(
    expr: string,
    env: SourceCatalog & { signals: string[] },
    expected: ExpectedKind,
  ): { diagnostics: ExpressionDiagnostic[] };
}

export interface ResolveContext {
  /** Known stream ids of the vehicle; enables the orphan check (D53). */
  streams?: string[];
  /** Known sources; enables source reference checks. */
  sources?: SourceCatalog;
  /** Known assets; enables asset and part checks. */
  assets?: Record<string, AssetMetadata>;
  expressions?: ExpressionAnalyzer;
}

// --- Effective configuration ---

export type ValueOrigin = "standard" | "variant";

export interface EffectiveElement {
  id: string;
  type: ElementType;
  origin: ValueOrigin;
  name?: string;
  parent: string;
  children?: string[];
  /** Own flag after variant override. */
  disabled: boolean;
  /** Own flag or any ancestor disabled. */
  effectiveDisabled: boolean;
  locked: boolean;
  editorHidden: boolean;
  lockAspect: boolean;
  onInvalid: "hold" | "hide";
  props: PropMap;
  /** Which explicit props come from the variant. */
  propOrigins: Record<string, ValueOrigin>;
  parts: Record<string, PartOverride>;
  assetId?: string;
  source?: string;
}

export interface EffectiveClip extends Clip {
  id: string;
  origin: ValueOrigin;
  /** Clip settings overridden by the variant. */
  overridden: string[];
}

export interface EffectiveConfig {
  streamId: string | null;
  workspace: Workspace;
  rootTransform?: RootTransform;
  signals: Record<string, SignalDefinition>;
  sources: { telemetry: Record<string, { staleAfterMs?: number }> };
  root: string[];
  elements: Record<string, EffectiveElement>;
  clips: Record<string, EffectiveClip>;
}

export type ResolveResult =
  | { kind: "none"; reason: "vehicleDisabled" | "variantDisabled" }
  | { kind: "hud"; config: EffectiveConfig };
