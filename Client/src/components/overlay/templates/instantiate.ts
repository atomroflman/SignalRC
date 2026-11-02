// AP12 – turning a template into elements and clips with fresh ids, checking
// the channel mapping and inserting through editor commands (one undo step).
import { detach, dict } from "../document/dict";
import type { Clip, OverlayElement, PropertyValue, TelemetryDataType } from "../document/types";
import { allClipIds, allElementIds } from "../editor/core/commands";
import type { EditorStore } from "../editor/core/store";
import { newId } from "../editor/core/tools";
import { CommandError, type DispatchResult, type Point } from "../editor/core/types";
import { convertedRef } from "./conversions";
import type { BuildContext, ParamValue, TemplateContent, TemplateDefinition, TemplateMapping } from "./types";

/** A channel offered for slots (from GET …/overlay/sources). */
export interface ChannelOption {
  name: string;
  dataType: TelemetryDataType | string;
  unit?: string | null;
}

export type MappingIssue =
  | { code: "TPL_SLOT_UNASSIGNED"; slot: string }
  | { code: "TPL_CHANNEL_UNKNOWN"; slot: string; channel: string }
  | { code: "TPL_CHANNEL_TYPE"; slot: string; channel: string; dataType: string }
  | { code: "TPL_CONVERSION_INVALID"; slot: string }
  | { code: "TPL_PARAM_INVALID"; param: string };

const NUMERIC = new Set(["Integer", "Number"]);

/** Parameter values with defaults filled in. */
export function paramValues(def: TemplateDefinition, given: Record<string, ParamValue> = {}): Record<string, ParamValue> {
  const out = dict<ParamValue>();
  for (const p of def.params) out[p.id] = given[p.id] ?? p.default;
  return out;
}

/**
 * Every slot needs an existing channel of a fitting type; templates never
 * insert placeholders or invented values.
 */
export function checkMapping(def: TemplateDefinition, mapping: TemplateMapping, channels: ChannelOption[]): MappingIssue[] {
  const issues: MappingIssue[] = [];
  const byName = new Map(channels.map((c) => [c.name, c]));
  for (const slot of def.slots) {
    const a = mapping.slots[slot.id];
    if (!a || !a.channel) {
      issues.push({ code: "TPL_SLOT_UNASSIGNED", slot: slot.id });
      continue;
    }
    const ch = byName.get(a.channel);
    if (!ch) {
      issues.push({ code: "TPL_CHANNEL_UNKNOWN", slot: slot.id, channel: a.channel });
      continue;
    }
    const fits = slot.kind === "lidarGrid" ? ch.dataType === "LidarGrid" : NUMERIC.has(ch.dataType);
    if (!fits) issues.push({ code: "TPL_CHANNEL_TYPE", slot: slot.id, channel: a.channel, dataType: ch.dataType });
    const c = a.conversion;
    if (c && (!Number.isFinite(c.factor) || !Number.isFinite(c.offset) || c.factor === 0 || Math.abs(c.factor) > 1e6 || Math.abs(c.offset) > 1e6)) {
      issues.push({ code: "TPL_CONVERSION_INVALID", slot: slot.id });
    }
  }
  const values = paramValues(def, mapping.params);
  for (const p of def.params) {
    const v = values[p.id];
    const ok = p.type === "bool" ? typeof v === "boolean"
      : p.type === "choice" ? p.values.includes(v as number)
      : typeof v === "number" && Number.isFinite(v) && (p.min === undefined || v >= p.min) && (p.max === undefined || v <= p.max);
    if (!ok) issues.push({ code: "TPL_PARAM_INVALID", param: p.id });
  }
  return issues;
}

/** Template content with template-local ids (for previews and tests). */
export function buildContent(def: TemplateDefinition, mapping: TemplateMapping, locale: "de" | "en" = "de"): TemplateContent {
  const params = paramValues(def, mapping.params);
  const ctx: BuildContext = {
    locale,
    ref(slot) {
      const a = mapping.slots[slot];
      if (!a?.channel) throw new CommandError("TPL_SLOT_UNASSIGNED", `Kanal für ${slot} fehlt`);
      return convertedRef(a.channel, a.conversion);
    },
    channel(slot) {
      const a = mapping.slots[slot];
      if (!a?.channel) throw new CommandError("TPL_SLOT_UNASSIGNED", `Kanal für ${slot} fehlt`);
      return a.channel;
    },
    param: <T extends ParamValue>(id: string) => params[id] as T,
  };
  return def.build(ctx);
}

export interface Instance {
  elements: Record<string, OverlayElement>;
  root: string;
  clips: Record<string, Clip>;
}

export interface InstantiateOptions {
  /** Top-left position of the root group in its container. */
  at?: Point;
  takenElements?: Set<string>;
  takenClips?: Set<string>;
  random?: () => number;
  locale?: "de" | "en";
}

/** Assigns fresh e_/c_ ids (Shared/Overlay/README.md §2) and places the root group. */
export function instantiate(def: TemplateDefinition, mapping: TemplateMapping, options: InstantiateOptions = {}): Instance {
  const content = buildContent(def, mapping, options.locale);
  const takenE = new Set(options.takenElements ?? []);
  const takenC = new Set(options.takenClips ?? []);
  const ids = dict<string>();
  for (const local of Object.keys(content.elements)) {
    const id = newId("e", takenE, options.random);
    takenE.add(id);
    ids[local] = id;
  }
  const elements = dict<OverlayElement>();
  for (const [local, el] of Object.entries(content.elements)) {
    const copy = detach(el);
    if (copy.children) copy.children = copy.children.map((c) => ids[c]);
    elements[ids[local]] = copy;
  }
  const root = ids[content.root];
  const at = options.at ?? { x: 0, y: 0 };
  const props = (elements[root].props ??= dict<PropertyValue>());
  props.x = at.x;
  props.y = at.y;
  const clips = dict<Clip>();
  for (const clip of Object.values(content.clips ?? {})) {
    const id = newId("c", takenC, options.random);
    takenC.add(id);
    const copy = detach(clip);
    copy.tracks = copy.tracks.map((t) => ({ ...t, element: ids[t.element] }));
    clips[id] = copy;
  }
  return { elements, root, clips };
}

/** Centered in the active scope's workspace. */
export function centeredPosition(store: EditorStore, def: TemplateDefinition): Point {
  const ws = store.effective().workspace;
  return { x: Math.round((ws.width - def.size.width) / 2), y: Math.round((ws.height - def.size.height) / 2) };
}

/**
 * Inserts the template into the active scope (standard or variant) as one
 * undo step: addElements, then addClip for each clip. The new root is selected.
 */
export function insertTemplate(
  store: EditorStore,
  def: TemplateDefinition,
  mapping: TemplateMapping,
  channels: ChannelOption[],
  options: { at?: Point; locale?: "de" | "en"; random?: () => number } = {},
): DispatchResult & { root?: string } {
  const issues = checkMapping(def, mapping, channels);
  if (issues.length > 0) return { ok: false, error: new CommandError(issues[0].code, "Vorlage ist nicht vollständig zugeordnet") };
  const doc = store.document;
  const inst = instantiate(def, mapping, {
    at: options.at ?? centeredPosition(store, def),
    takenElements: allElementIds(doc),
    takenClips: allClipIds(doc),
    random: options.random,
    locale: options.locale,
  });
  store.beginTransaction(`Vorlage ${def.name[options.locale ?? "de"]}`);
  let result = store.dispatch({ type: "addElements", elements: inst.elements, roots: [inst.root] });
  for (const [id, clip] of Object.entries(inst.clips)) {
    if (!result.ok) break;
    result = store.dispatch({ type: "addClip", id, clip });
  }
  if (!result.ok) {
    store.cancelTransaction();
    return result;
  }
  store.commitTransaction();
  store.select([inst.root]);
  return { ok: true, root: inst.root };
}
