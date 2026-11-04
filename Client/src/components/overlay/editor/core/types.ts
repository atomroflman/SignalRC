// AP09 – editor core types (Shared/Overlay/modules/README.md §1 "EditorStore").
import type { Clip, ClipSettings, Diagnostic, EffectiveConfig, Keyframe, OverlayDocument, OverlayElement, PropertyValue, RootTransform, SignalDefinition, Workspace, Interaction } from "../../document/types";
import type { Scrub } from "../../runtime/types";

/** Edit scope: null = standard, otherwise the StreamId of a variant. */
export type Scope = string | null;

/** Element attributes outside `props` (Shared/Overlay/README.md §3). */
export type AttributeName = "name" | "disabled" | "locked" | "editorHidden" | "lockAspect" | "onInvalid" | "source" | "assetId";
/** Attributes a variant may override (ElementOverride). Others always edit the element itself. */
export const OVERRIDABLE_ATTRIBUTES: readonly AttributeName[] = ["disabled", "locked", "editorHidden", "lockAspect", "onInvalid"];

export interface TrackRef {
  element: string;
  part?: string;
  property: string;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Editor commands: the only way to change the draft. Every command is one
 * undo step unless it runs inside a transaction. A missing `variant` means the
 * active scope of the store; the store records the concrete scope.
 */
export type EditorCommand =
  /** `value: undefined` removes the property (catalog default, or inherited value in a variant). */
  | { type: "setProperty"; element: string; part?: string; property: string; value: PropertyValue | undefined; variant?: Scope }
  /** Several properties of one element (transform tools). */
  | { type: "setProperties"; element: string; part?: string; props: Record<string, PropertyValue | undefined>; variant?: Scope }
  /** Removes variant overrides: one property, one attribute, or (neither) the whole element override. */
  | { type: "resetOverride"; element: string; part?: string; property?: string; attribute?: AttributeName; variant: string }
  | { type: "setAttribute"; element: string; name: AttributeName; value: unknown; variant?: Scope }
  /** D75: clickable element or part; `undefined` removes it. Not overridable: always edits the element itself. */
  | { type: "setInteraction"; element: string; part?: string; interaction: Interaction | undefined; variant?: Scope }
  /** `elements` may contain whole subtrees; `roots` are inserted into `container` (default root) at `index` (default top). */
  | { type: "addElements"; elements: Record<string, OverlayElement>; roots: string[]; container?: string; index?: number; variant?: Scope }
  /** Standard scope: elements with all dependent variant adjustments (AP01). Variant scope: only elements added by the variant. */
  | { type: "deleteElements"; ids: string[]; variant?: Scope }
  /** Members must share one container. `pivot` is the fixed group pivot (center of the members' box). */
  | { type: "groupElements"; ids: string[]; groupId: string; name?: string; pivot?: Point; variant?: Scope }
  /** Moves the children into the group's container keeping their appearance, then removes the group. */
  | { type: "ungroup"; group: string; variant?: Scope }
  | { type: "reparent"; ids: string[]; container: string; index?: number; keepPosition?: boolean; variant?: Scope }
  /** Complete new order of a container (bottom → top). */
  | { type: "reorder"; container: string; order: string[]; variant?: Scope }
  /** Removes a variant's regrouping entry of an element and/or its order entry of a container. */
  | { type: "resetStructure"; variant: string; element?: string; container?: string }
  | { type: "addClip"; id: string; clip: Clip; variant?: Scope }
  /** `undefined` values remove a field; in a variant this resets the override of a standard clip. */
  | { type: "updateClip"; id: string; changes: Partial<Record<keyof ClipSettings, unknown>>; variant?: Scope }
  | { type: "removeClip"; id: string; variant?: Scope }
  /** `null` removes the track; a missing track is appended. */
  | { type: "setKeyframes"; clip: string; track: TrackRef; keyframes: Keyframe[] | null; variant?: Scope }
  | { type: "setSignals"; signals: Record<string, SignalDefinition> }
  | { type: "setSourceSettings"; channel: string; settings: { staleAfterMs?: number } | undefined }
  /** D04/D39: `areaOnly` keeps content, `fitContent` fits it proportionally and centered via the root transform. */
  | { type: "setWorkspace"; width: number; height: number; mode: "areaOnly" | "fitContent"; variant?: Scope }
  | { type: "setRootTransform"; rootTransform: RootTransform | undefined; variant?: Scope }
  | { type: "setOverlayDisabled"; disabled: boolean }
  /** Creates the variant if needed; `null` removes a field. */
  | { type: "setVariant"; streamId: string; settings?: { disabled?: boolean | null; workspace?: Workspace | null; rootTransform?: RootTransform | null } }
  | { type: "removeVariant"; streamId: string }
  /** D53: moves an (orphaned) variant to a stream without a variant. */
  | { type: "reassignVariant"; from: string; to: string }
  /** Import (D19), restore of a local backup or a server state as one undo step. */
  | { type: "replaceDocument"; document: OverlayDocument; reason: "import" | "backup" | "restore" };

export type CommandType = EditorCommand["type"];

export class CommandError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export type DispatchResult = { ok: true } | { ok: false; error: CommandError };

export interface HistoryInfo {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel?: string;
  redoLabel?: string;
  size: number;
}

export interface GridSettings {
  enabled: boolean;
  size: number;
  snap: boolean;
}

/** View state of the design surface; not part of the draft and not undoable. */
export interface ViewState {
  zoom: number;
  panX: number;
  panY: number;
  grid: GridSettings;
  /** Group whose children are selected by clicks (null = top level). */
  enteredGroup: string | null;
}

export interface EditorState {
  carId: number;
  document: OverlayDocument;
  /** Active scope: null = standard, otherwise the StreamId of a variant. */
  activeVariant: Scope;
  /** Selected element ids of the active scope's view, bottom → top. */
  selection: string[];
  /** Design mode scrubbing (AP10 timeline). */
  scrub?: Scrub;
  view: ViewState;
  history: HistoryInfo;
  /** Increments on every document change (also undo/redo/load). */
  version: number;
  /** Last refused command. */
  lastError?: CommandError;
}

/** Derived data, computed lazily per document. */
export interface EditorDerived {
  effective: EffectiveConfig;
  diagnostics: Diagnostic[];
}

export type { ClipSettings };
