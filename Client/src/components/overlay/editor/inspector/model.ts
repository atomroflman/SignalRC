// AP10 – pure logic of the property inspector: rows per catalog property
// (inherited / overridden / resettable), the one control mode of a property
// and the editor commands that switch or edit it. Nothing here keeps document
// state; everything is derived from the EditorStore and changed via commands.
import { allowedModes, catalog, checkLiteral, kindDef, propDef, type ControlMode, type KindDef, type PropDef } from "../../document/catalog";
import type {
  Binding, Clip, Diagnostic, DynamicProperty, EffectiveConfig, EffectiveElement, Literal, PropertyValue, Rate, SignalDefinition,
} from "../../document/types";
import type { EditorStore } from "../core/store";
import { withBase } from "../core/commands";
import { newClipId } from "../core/tools";
import type { EditorCommand, Scope } from "../core/types";
import { channelInfo, type ChannelDirectory } from "./channels";

export interface PropertyTarget {
  element: string;
  part?: string;
  property: string;
}

export type ValueSourceOrigin = "default" | "standard" | "variant";

export interface PropertyRow extends PropertyTarget {
  def: PropDef;
  kind: KindDef;
  modes: ControlMode[];
  /** The controlling mode; with `conflict` the first of several. */
  mode: ControlMode;
  /** Explicit effective value (literal or dynamic); undefined = catalog default. */
  value?: PropertyValue;
  /** Static value, or base of a driver; the catalog default when nothing is set. */
  base: unknown;
  binding?: Binding;
  rate?: Rate;
  /** Clips with a track on this property (ordinal order). */
  clips: string[];
  /** More than one driver (D12): binding/rate plus track, or several tracks. */
  conflict: boolean;
  origin: ValueSourceOrigin;
  /** Active scope is a variant and the value comes from the standard. */
  inherited: boolean;
  /** The variant overrides this property of an inherited element. */
  overridden: boolean;
  /** A reset is possible: variant override → inherited value, otherwise → catalog default. */
  resettable: boolean;
  diagnostics: Diagnostic[];
}

const isDynamic = (v: unknown): v is DynamicProperty => typeof v === "object" && v !== null;

const TRANSFORM = ["x", "y", "rotation", "scaleX", "scaleY", "pivotX", "pivotY"];

/** Catalog properties of an element or an svgAsset part, in catalog order. */
export function propertyNames(el: EffectiveElement, part?: string): string[] {
  const type = catalog.types[el.type];
  if (!type) return [];
  const lock = part !== undefined ? (el.parts[part]?.lockAspect ?? false) : el.lockAspect;
  const names = part !== undefined ? [...(type.partProps ?? [])] : [...Object.keys(catalog.common), ...Object.keys(type.props)];
  return names.filter((n) => !(n === "scaleY" && lock));
}

export type SectionKey = "transform" | "appearance" | "widget";

/** Inspector sections: transform, appearance and (LiDAR) widget parameters. */
export function sections(el: EffectiveElement, part?: string): { key: SectionKey; names: string[] }[] {
  const names = propertyNames(el, part);
  const transform = names.filter((n) => TRANSFORM.includes(n));
  const rest = names.filter((n) => !TRANSFORM.includes(n));
  if (el.type === "lidarWidget" && part === undefined) {
    const appearance = rest.filter((n) => n === "radius" || n in catalog.common);
    // Display mode first; only the parameters of the chosen mode (lidar §6, D74).
    const contour = el.props.display === "contour";
    const widget = rest
      .filter((n) => !appearance.includes(n) && (contour ? n !== "sectors" : !n.startsWith("contour")))
      .sort((a, b) => Number(b === "display") - Number(a === "display"));
    return [{ key: "transform", names: transform }, { key: "appearance", names: appearance }, { key: "widget", names: widget }];
  }
  return ([{ key: "transform", names: transform }, { key: "appearance", names: rest }] as { key: SectionKey; names: string[] }[]).filter((s) => s.names.length > 0);
}

const sameTarget = (t: { element: string; part?: string; property: string }, r: PropertyTarget) =>
  t.element === r.element && t.property === r.property && (t.part ?? undefined) === (r.part ?? undefined);

/** Clips of the effective view with a track on the property (ordinal by id). */
export function clipsOf(config: EffectiveConfig, target: PropertyTarget): string[] {
  return Object.keys(config.clips)
    .filter((id) => config.clips[id].tracks.some((t) => sameTarget(t, target)))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Whether a property value comes from the variant's own data in the active scope. */
function partOrigin(store: EditorStore, el: EffectiveElement, part: string, property: string): ValueSourceOrigin {
  const scope = store.getState().activeVariant;
  if (el.origin === "variant") return el.parts[part]?.props?.[property] !== undefined ? "variant" : "default";
  if (scope !== null && store.document.variants?.[scope]?.elements?.[el.id]?.parts?.[part]?.props?.[property] !== undefined) return "variant";
  return el.parts[part]?.props?.[property] !== undefined ? "standard" : "default";
}

/** One inspector row; undefined for properties the catalog does not know. */
export function inspectProperty(store: EditorStore, target: PropertyTarget): PropertyRow | undefined {
  const config = store.effective();
  const el = config.elements[target.element];
  if (!el) return undefined;
  const def = propDef(el.type, target.property, target.part !== undefined);
  if (!def) return undefined;
  const scope = store.getState().activeVariant;
  const value = target.part !== undefined ? el.parts[target.part]?.props?.[target.property] : el.props[target.property];
  const origin: ValueSourceOrigin = target.part !== undefined
    ? partOrigin(store, el, target.part, target.property)
    : value === undefined ? "default" : (el.propOrigins[target.property] ?? "standard");
  const inVariant = scope !== null && el.origin === "standard";
  const clips = clipsOf(config, target);
  const driven = isDynamic(value) ? (value.binding ? "binding" : "rate") : undefined;
  const mode: ControlMode = driven ?? (clips.length > 0 ? "clip" : "static");
  const overridden = inVariant && origin === "variant";
  const diagnostics = store.diagnostics().filter((d) =>
    d.location.element === target.element && d.location.property === target.property
    && (d.location.part ?? undefined) === (target.part ?? undefined) && (d.location.variant ?? null) === scope);
  return {
    ...target,
    def,
    kind: kindDef(def),
    modes: allowedModes(def),
    mode,
    value,
    base: isDynamic(value) ? value.base : value ?? def.default,
    binding: isDynamic(value) ? value.binding : undefined,
    rate: isDynamic(value) ? value.rate : undefined,
    clips,
    conflict: (driven ? 1 : 0) + clips.length > 1,
    origin,
    inherited: inVariant && origin !== "variant",
    overridden,
    resettable: overridden || (!inVariant && value !== undefined),
    diagnostics,
  };
}

export function inspectElement(store: EditorStore, element: string, part?: string): PropertyRow[] {
  const el = store.effective().elements[element];
  if (!el) return [];
  return propertyNames(el, part).map((property) => inspectProperty(store, { element, part, property })).filter((r): r is PropertyRow => !!r);
}

// --- Values ---

/**
 * A literal usable as static value or driver base. Defaults that are no
 * literal of the kind ("center", "fromSource", "fromAsset") fall back to a
 * neutral value of the kind.
 */
export function baseLiteral(def: PropDef, current?: unknown): Literal {
  if (current !== undefined && checkLiteral(def, current) === null) return current as Literal;
  if (checkLiteral(def, def.default) === null) return def.default as Literal;
  const kind = kindDef(def);
  switch (kind.valueType) {
    case "number": {
      let v = 0;
      const min = def.min ?? kind.min;
      const max = def.max ?? kind.max;
      if (def.values?.length) return def.values[0] as number;
      if (min !== undefined && v < min) v = min;
      if (max !== undefined && v > max) v = max;
      return v;
    }
    case "boolean": return false;
    case "string": return kind.format === "color" ? "#ffffff" : def.values?.length ? String(def.values[0]) : "";
    default: return null;
  }
}

export type ParseResult = { ok: true; value: Literal | undefined } | { ok: false; problem: "type" | "range" };

/** Parses an inspector input; an empty text means "remove" (default / inherited). */
export function parseLiteral(def: PropDef, input: string | boolean): ParseResult {
  if (typeof input === "boolean") return checkLiteral(def, input) === null ? { ok: true, value: input } : { ok: false, problem: "type" };
  const kind = kindDef(def);
  const text = input.trim();
  if (text === "" && kind.valueType !== "string") return { ok: true, value: undefined };
  let value: Literal;
  switch (kind.valueType) {
    case "number": {
      const n = Number(text.replace(",", "."));
      if (!Number.isFinite(n)) return { ok: false, problem: "type" };
      value = n;
      break;
    }
    case "boolean":
      if (text !== "true" && text !== "false") return { ok: false, problem: "type" };
      value = text === "true";
      break;
    case "string":
      value = input;
      break;
    default: {
      const n = Number(text.replace(",", "."));
      value = /^[+-]?(\d+([.,]\d*)?|[.,]\d+)$/.test(text) && Number.isFinite(n) ? n : input;
    }
  }
  const problem = checkLiteral(def, value);
  return problem === null ? { ok: true, value } : { ok: false, problem };
}

// --- Commands ---

const cmdTarget = (row: PropertyTarget) => (row.part !== undefined ? { element: row.element, part: row.part } : { element: row.element });

const setValue = (row: PropertyTarget, value: PropertyValue | undefined): EditorCommand =>
  ({ type: "setProperty", ...cmdTarget(row), property: row.property, value });

/** Merge key for typing into one property field. */
export const mergeKey = (row: PropertyTarget, field: string) => `${row.element}/${row.part ?? ""}/${row.property}/${field}`;

/** Static value or the base of a driver; `undefined` removes the value. */
export function staticCommand(row: PropertyRow, literal: Literal | undefined): EditorCommand {
  if (literal === undefined && isDynamic(row.value)) return setValue(row, withBase(row.value, baseLiteral(row.def)));
  return setValue(row, literal === undefined ? undefined : withBase(row.value, literal));
}

/** Back to the inherited value (variant override) or to the catalog default. */
export function resetCommand(row: PropertyRow, scope: Scope): EditorCommand | undefined {
  if (!row.resettable) return undefined;
  if (row.overridden && scope !== null) {
    return { type: "resetOverride", ...cmdTarget(row), property: row.property, variant: scope };
  }
  return setValue(row, undefined);
}

export function bindingCommand(row: PropertyRow, binding: Binding): EditorCommand {
  return setValue(row, { base: baseLiteral(row.def, row.base), binding });
}

export function rateCommand(row: PropertyRow, rate: Rate): EditorCommand {
  return setValue(row, { base: baseLiteral(row.def, row.base), rate });
}

/** Changes the expression of the binding or rate and keeps its options. */
export function exprCommand(row: PropertyRow, expr: string): EditorCommand | undefined {
  if (row.binding) return bindingCommand(row, { ...row.binding, expr });
  if (row.rate) return rateCommand(row, { ...row.rate, expr });
  return undefined;
}

/** D28: `undefined` switches smoothing off; τ must be in (0, 60]. */
export function smoothingCommand(row: PropertyRow, timeConstantS: number | undefined): EditorCommand | undefined {
  if (!row.binding) return undefined;
  const { smoothing: _old, ...rest } = row.binding;
  void _old;
  return bindingCommand(row, timeConstantS === undefined ? rest : { ...rest, smoothing: { timeConstantS } });
}

export function wrapCommand(row: PropertyRow, wrap: { min: number; max: number } | undefined): EditorCommand | undefined {
  if (!row.rate) return undefined;
  const { wrap: _old, ...rest } = row.rate;
  void _old;
  return rateCommand(row, wrap === undefined ? rest : { ...rest, wrap });
}

export interface ModeOptions {
  /** Expression for binding/rate; default: the current one or empty (allowed in a draft). */
  expr?: string;
  /** Clip that gets the track in clip mode; without one a new clip is created. */
  clip?: string;
  /** Duration of a newly created clip (s). */
  newClipDurationS?: number;
  /** Id of a newly created clip; generated when missing. */
  newClipId?: string;
}

export interface ModeChange {
  commands: EditorCommand[];
  /** Clip that holds the track after a switch to clip mode. */
  clip?: string;
}

/**
 * Commands that make `mode` the one controlling mode of the property (D12):
 * tracks in other clips and a binding/rate are removed first, so no hidden
 * animation conflict remains. Dispatch them in one transaction.
 */
export function modeCommands(store: EditorStore, row: PropertyRow, mode: ControlMode, options: ModeOptions = {}): ModeChange {
  if (!row.modes.includes(mode)) return { commands: [] };
  const commands: EditorCommand[] = [];
  const base = baseLiteral(row.def, row.base);
  const expr = options.expr ?? row.binding?.expr ?? row.rate?.expr ?? "";
  const keepClip = mode === "clip" ? (options.clip ?? (row.clips.length === 1 ? row.clips[0] : undefined)) : undefined;
  const track = row.part !== undefined ? { element: row.element, part: row.part, property: row.property } : { element: row.element, property: row.property };
  for (const clip of row.clips) {
    if (clip !== keepClip) commands.push({ type: "setKeyframes", clip, track, keyframes: null });
  }
  switch (mode) {
    case "static":
      if (isDynamic(row.value)) commands.push(setValue(row, base));
      break;
    case "binding":
      if (!row.binding) commands.push(setValue(row, { base, binding: { expr } }));
      break;
    case "rate":
      if (!row.rate) commands.push(setValue(row, { base, rate: { expr } }));
      break;
    case "clip": {
      if (isDynamic(row.value)) commands.push(setValue(row, base));
      let clip = keepClip;
      if (clip === undefined) {
        clip = options.newClipId ?? newClipId(store);
        const created: Clip = { durationS: options.newClipDurationS ?? 1, trigger: { mode: "auto" }, tracks: [] };
        commands.push({ type: "addClip", id: clip, clip: created });
      }
      if (!row.clips.includes(clip)) commands.push({ type: "setKeyframes", clip, track, keyframes: [{ t: 0, value: base }] });
      return { commands, clip };
    }
  }
  return { commands };
}

/** Dispatches the commands of a mode switch as one undo step. */
export function applyMode(store: EditorStore, row: PropertyRow, mode: ControlMode, options: ModeOptions = {}, label?: string): ModeChange & { ok: boolean } {
  const change = modeCommands(store, row, mode, options);
  if (change.commands.length === 0) return { ...change, ok: true };
  store.beginTransaction(label ?? `${row.property}: ${mode}`);
  for (const cmd of change.commands) {
    const r = store.dispatch(cmd);
    if (!r.ok) {
      store.cancelTransaction();
      return { ...change, ok: false };
    }
  }
  store.commitTransaction();
  return { ...change, ok: true };
}

// --- valueText and LiDAR ---

/** Unit and decimals the runtime takes for "fromSource" (runtime valueTextDefaults). */
export function valueTextSourceDefaults(
  el: EffectiveElement, dir: ChannelDirectory, signals: Record<string, SignalDefinition>, dependency?: { kind: string; name: string },
): { unit?: string; decimals?: number } {
  if (el.type !== "valueText" || !dependency) return {};
  if (dependency.kind === "tel") {
    const info = channelInfo(dir, dependency.name);
    return { unit: info?.unit ?? undefined, decimals: info?.decimals ?? (info?.dataType === "Integer" ? 0 : undefined) };
  }
  if (dependency.kind === "sig") return { unit: signals[dependency.name]?.unit, decimals: signals[dependency.name]?.decimals };
  return {};
}

/** LiDAR grid channels for the widget source (lidar/README.md §1). */
export function lidarChannels(dir: ChannelDirectory) {
  return (dir.telemetry ?? []).filter((c) => c.dataType === "LidarGrid");
}

/** Source attribute of a LiDAR widget (not variant-capable; always the element itself). */
export function lidarSourceCommand(element: string, channel: string | undefined): EditorCommand {
  return { type: "setAttribute", element, name: "source", value: channel || undefined };
}
