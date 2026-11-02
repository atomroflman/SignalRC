// Document validation (Shared/Overlay/README.md §5–§9).
//
// Categories: structure blocks saving, publish blocks publishing and turns
// into a warning inside explicitly disabled parts (formulas and source
// references only), warning never blocks. Problems in a variant's own data are
// structure; tree problems that only appear in a variant's effective view
// (D38) are publish, so a later standard change never blocks saving.
import { allowedModes, checkLiteral, defaultLockAspect, propDef } from "./catalog";
import { buildView, effectiveConfig, type TreeIssue, type View } from "./resolve";
import { detach, dict } from "./dict";
import { checkSchema } from "./schema";
import {
  ROOT,
  type Clip,
  type ClipSettings,
  type Diagnostic,
  type DiagnosticCategory,
  type DiagnosticLocation,
  type DynamicProperty,
  type ElementOverride,
  type OverlayDocument,
  type OverlayElement,
  type PropMap,
  type ResolveContext,
  type Track,
  type Variant,
} from "./types";

const LIMITS = { elements: 500, clips: 200, formulas: 300, assetBytes: 10 * 1024 * 1024 };

const ordinal = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sortedEntries = <T>(o: Record<string, T> | undefined): [string, T][] =>
  Object.entries(o ?? {}).filter(([, v]) => v !== undefined).sort(([a], [b]) => ordinal(a, b));
const isDynamic = (v: unknown): v is DynamicProperty => typeof v === "object" && v !== null;

class Collector {
  readonly list: Diagnostic[] = [];

  add(code: string, category: DiagnosticCategory, location: DiagnosticLocation, message: string): void {
    this.list.push({ code, category, severity: category === "warning" ? "warning" : "error", location, message });
  }
}

/** Static checks of a prop map against the catalog. */
function checkProps(
  out: Collector,
  type: OverlayElement["type"],
  props: PropMap | undefined,
  location: DiagnosticLocation,
  part: boolean,
): void {
  for (const [name, value] of sortedEntries(props)) {
    const at = { ...location, property: name };
    const def = propDef(type, name, part);
    if (!def) {
      out.add("OVL_PROP_UNKNOWN", "structure", at, `Eigenschaft ${name} gibt es für ${type} nicht`);
      continue;
    }
    const modes = allowedModes(def);
    if (isDynamic(value)) {
      const mode = value.binding ? "binding" : "rate";
      if (!modes.includes(mode)) {
        out.add("OVL_PROP_MODE_NOT_ALLOWED", "structure", at, `${name} erlaubt keinen Modus ${mode}`);
      }
      if (value.rate?.wrap && !(value.rate.wrap.min < value.rate.wrap.max)) {
        out.add("OVL_PROP_INVALID_WRAP", "structure", at, "wrap.min muss kleiner als wrap.max sein");
      }
    }
    const literal = isDynamic(value) ? value.base : value;
    const problem = checkLiteral(def, literal);
    if (problem === "type") out.add("OVL_PROP_TYPE", "structure", at, `Wert passt nicht zum Typ von ${name}`);
    if (problem === "range") out.add("OVL_PROP_OUT_OF_RANGE", "structure", at, `Wert von ${name} liegt außerhalb des Bereichs`);
  }
}

function checkLockAspect(out: Collector, lockAspect: boolean, props: PropMap | undefined, location: DiagnosticLocation): void {
  if (lockAspect && props?.scaleY !== undefined) {
    out.add("OVL_PROP_LOCKED_ASPECT", "structure", { ...location, property: "scaleY" },
      "Bei gesperrtem Seitenverhältnis gibt es kein scaleY");
  }
}

function checkElement(out: Collector, element: OverlayElement, location: DiagnosticLocation, ctx: ResolveContext): void {
  checkProps(out, element.type, element.props, location, false);
  checkLockAspect(out, element.lockAspect ?? defaultLockAspect(element.type), element.props, location);
  checkParts(out, element, element.parts, location, ctx);
}

function checkParts(
  out: Collector,
  element: OverlayElement,
  parts: OverlayElement["parts"],
  location: DiagnosticLocation,
  ctx: ResolveContext,
): void {
  const asset = element.assetId ? ctx.assets?.[element.assetId] : undefined;
  for (const [partId, part] of sortedEntries(parts)) {
    const at = { ...location, part: partId };
    if (asset && !asset.parts[partId]) {
      out.add("OVL_REF_UNKNOWN_PART", "structure", at, `Teil ${partId} gibt es im Asset nicht`);
    }
    checkProps(out, element.type, part.props, at, true);
    checkLockAspect(out, part.lockAspect ?? false, part.props, at);
  }
}

function checkOverride(
  out: Collector,
  element: OverlayElement,
  override: ElementOverride,
  location: DiagnosticLocation,
  ctx: ResolveContext,
): void {
  checkProps(out, element.type, override.props, location, false);
  const lockAspect = override.lockAspect ?? element.lockAspect ?? defaultLockAspect(element.type);
  checkLockAspect(out, lockAspect, { ...element.props, ...override.props }, location);
  checkParts(out, element, override.parts, location, ctx);
}

function treeDiagnostics(out: Collector, issues: TreeIssue[], variant: string | undefined): void {
  const base = variant === undefined ? {} : { variant };
  for (const issue of issues) {
    switch (issue.kind) {
      case "unknownChild":
        out.add("OVL_REF_UNKNOWN_ELEMENT", "structure", { ...base, container: issue.container, ref: issue.ref },
          `${issue.container} enthält das unbekannte Element ${issue.ref}`);
        break;
      case "unknownParent":
        out.add("OVL_REF_UNKNOWN_ELEMENT", "structure", { ...base, element: issue.element, ref: issue.ref },
          `Ziel ${issue.ref} für ${issue.element} ist unbekannt`);
        break;
      case "notAGroup":
        out.add("OVL_STRUCT_NOT_A_GROUP", "structure", { ...base, element: issue.element, ref: issue.ref },
          `${issue.ref} ist keine Gruppe`);
        break;
      case "multipleParents":
        out.add("OVL_STRUCT_MULTIPLE_PARENTS", "structure", { ...base, element: issue.element },
          `${issue.element} liegt in mehreren Containern`);
        break;
      case "orphan":
        out.add("OVL_STRUCT_ORPHAN", "structure", { ...base, element: issue.element },
          `${issue.element} liegt in keinem Container`);
        break;
      case "cycle":
        out.add("OVL_STRUCT_CYCLE", variant === undefined ? "structure" : "publish", { ...base, element: issue.element },
          `${issue.element} liegt in einem Zyklus`);
        break;
    }
  }
}

/** Static checks of a clip's tracks (independent of other clips). */
function checkTracks(out: Collector, clipId: string, clip: Clip, view: View, base: DiagnosticLocation): void {
  clip.tracks.forEach((track: Track, index) => {
    const at: DiagnosticLocation = { ...base, clip: clipId, track: index };
    const entry = view.elements.get(track.element);
    if (!entry) {
      out.add("OVL_REF_UNKNOWN_ELEMENT", "structure", { ...at, ref: track.element }, `Spur verweist auf unbekanntes Element ${track.element}`);
      return;
    }
    const def = propDef(entry.element.type, track.property, track.part !== undefined);
    const propAt = { ...at, element: track.element, property: track.property, ...(track.part ? { part: track.part } : {}) };
    if (!def) {
      out.add("OVL_PROP_UNKNOWN", "structure", propAt, `Eigenschaft ${track.property} gibt es hier nicht`);
      return;
    }
    if (!allowedModes(def).includes("clip")) {
      out.add("OVL_PROP_MODE_NOT_ALLOWED", "structure", propAt, `${track.property} kann nicht animiert werden`);
    }
    track.keyframes.forEach((keyframe, k) => {
      const kfAt = { ...at, keyframe: k };
      if (k > 0 && !(keyframe.t > track.keyframes[k - 1].t)) {
        out.add("OVL_CLIP_KEYFRAME_ORDER", "structure", kfAt, "Keyframes müssen zeitlich streng aufsteigen");
      }
      if (keyframe.t > clip.durationS) {
        out.add("OVL_CLIP_KEYFRAME_RANGE", "structure", kfAt, "Keyframe liegt hinter dem Clip-Ende");
      }
      if (checkLiteral(def, keyframe.value) !== null) {
        out.add("OVL_PROP_TYPE", "structure", { ...kfAt, element: track.element, property: track.property },
          "Keyframe-Wert passt nicht zur Eigenschaft");
      }
    });
  });
}

type Owned = { key: string; clip: string; track: number; element: string; property: string; part?: string };

/** D12: one track per property across all clips, and none on bound or rate-driven props. */
function ownershipConflicts(clips: [string, Clip][], props: (element: string, part?: string) => PropMap | undefined): Owned[] {
  const owners = new Set<string>();
  const conflicts: Owned[] = [];
  for (const [clipId, clip] of clips) {
    clip.tracks.forEach((track, index) => {
      const key = `${track.element}\u0000${track.part ?? ""}\u0000${track.property}`;
      const owned: Owned = { key, clip: clipId, track: index, element: track.element, property: track.property, part: track.part };
      const driven = isDynamic(props(track.element, track.part)?.[track.property]);
      if (owners.has(key) || driven) conflicts.push(owned);
      owners.add(key);
    });
  }
  return conflicts;
}

function conflictDiagnostic(out: Collector, c: Owned, category: DiagnosticCategory, variant?: string): void {
  out.add("OVL_CLIP_PROPERTY_CONFLICT", category, {
    ...(variant !== undefined ? { variant } : {}),
    element: c.element, property: c.property, clip: c.clip, track: c.track, ...(c.part ? { part: c.part } : {}),
  }, `${c.property} von ${c.element} wird bereits anders gesteuert`);
}

function effectiveVariantClips(doc: OverlayDocument, variant: Variant): [string, Clip][] {
  const clips = new Map<string, Clip>();
  for (const [id, clip] of Object.entries(doc.clips ?? {})) clips.set(id, clip);
  for (const [id, clip] of Object.entries(variant.addedClips ?? {})) if (!clips.has(id)) clips.set(id, clip);
  for (const [id, override] of Object.entries(variant.clips ?? {})) {
    const clip = doc.clips?.[id];
    if (clip) clips.set(id, { ...clip, ...stripUndefined(override) } as Clip);
  }
  return [...clips.entries()].sort(([a], [b]) => ordinal(a, b));
}

function stripUndefined(o: ClipSettings): ClipSettings {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

interface Formula {
  expr: string;
  expected: string;
  location: DiagnosticLocation;
  key: string;
}

/** All formulas of the document with their stored location. */
function collectFormulas(doc: OverlayDocument): Formula[] {
  const list: Formula[] = [];
  const fromProps = (type: OverlayElement["type"], props: PropMap | undefined, loc: DiagnosticLocation, part: boolean) => {
    for (const [name, value] of sortedEntries(props)) {
      if (!isDynamic(value)) continue;
      const def = propDef(type, name, part);
      const location = { ...loc, property: name };
      if (value.binding) list.push({ expr: value.binding.expr, expected: def?.kind ?? "any", location, key: formulaKey(location) });
      if (value.rate) list.push({ expr: value.rate.expr, expected: "number", location, key: formulaKey(location) });
    }
  };
  const fromElement = (element: OverlayElement, props: PropMap | undefined, parts: OverlayElement["parts"], loc: DiagnosticLocation) => {
    fromProps(element.type, props, loc, false);
    for (const [partId, part] of sortedEntries(parts)) fromProps(element.type, part.props, { ...loc, part: partId }, true);
  };
  const fromClip = (clip: ClipSettings, loc: DiagnosticLocation) => {
    if (clip.trigger && clip.trigger.mode !== "auto") {
      const location = { ...loc, field: "trigger.condition" };
      list.push({ expr: clip.trigger.condition, expected: "bool", location, key: formulaKey(location) });
    }
  };
  for (const [id, element] of sortedEntries(doc.elements)) fromElement(element, element.props, element.parts, { element: id });
  for (const [id, clip] of sortedEntries(doc.clips)) fromClip(clip, { clip: id });
  for (const [streamId, variant] of sortedEntries(doc.variants)) {
    for (const [id, override] of sortedEntries(variant.elements)) {
      const element = doc.elements[id];
      if (element) fromElement(element, override.props, override.parts, { variant: streamId, element: id });
    }
    for (const [id, element] of sortedEntries(variant.addedElements)) {
      fromElement(element, element.props, element.parts, { variant: streamId, element: id });
    }
    for (const [id, clip] of sortedEntries(variant.clips)) fromClip(clip, { variant: streamId, clip: id });
    for (const [id, clip] of sortedEntries(variant.addedClips)) fromClip(clip, { variant: streamId, clip: id });
  }
  return list;
}

function formulaKey(l: DiagnosticLocation): string {
  return [l.variant ?? "", l.element ?? "", l.part ?? "", l.property ?? "", l.clip ?? "", l.field ?? ""].join("\u0000");
}

/**
 * Keys of formulas and LiDAR sources that are active in at least one shown
 * view; everything else lies in explicitly disabled parts.
 */
function activeKeys(doc: OverlayDocument): Set<string> {
  const active = new Set<string>();
  if (doc.disabled) return active;
  const views: (string | null)[] = [null];
  for (const [streamId, variant] of sortedEntries(doc.variants)) if (!variant.disabled) views.push(streamId);
  for (const streamId of views) {
    const variant = streamId === null ? undefined : doc.variants?.[streamId];
    const config = effectiveConfig(doc, streamId);
    for (const element of Object.values(config.elements)) {
      if (element.effectiveDisabled) continue;
      const elementVariant = element.origin === "variant" ? streamId! : undefined;
      for (const name of Object.keys(element.props)) {
        const fromVariant = element.propOrigins[name] === "variant";
        active.add(formulaKey({ variant: fromVariant ? streamId! : elementVariant, element: element.id, property: name }));
      }
      for (const [partId, part] of Object.entries(element.parts)) {
        for (const name of Object.keys(part.props ?? {})) {
          const fromVariant = element.origin === "standard" && variant?.elements?.[element.id]?.parts?.[partId]?.props?.[name] !== undefined;
          active.add(formulaKey({ variant: fromVariant || element.origin === "variant" ? streamId! : undefined, element: element.id, part: partId, property: name }));
        }
      }
      active.add(formulaKey({ variant: elementVariant, element: element.id, field: "source" }));
    }
    for (const clip of Object.values(config.clips)) {
      if (clip.disabled) continue;
      const fromVariant = clip.origin === "variant" || clip.overridden.includes("trigger");
      active.add(formulaKey({ variant: fromVariant ? streamId! : undefined, clip: clip.id, field: "trigger.condition" }));
    }
  }
  return active;
}

export function validate(input: unknown, context: ResolveContext = {}): Diagnostic[] {
  const schema = checkSchema(input);
  if (schema.length > 0) return schema;
  const doc = detach(input as OverlayDocument);
  const ctx: ResolveContext = {
    ...context,
    ...(context.sources ? { sources: { telemetry: detach(context.sources.telemetry), outputs: [...context.sources.outputs] } } : {}),
    ...(context.assets ? { assets: detach(context.assets) } : {}),
  };
  const out = new Collector();

  // One id namespace across standard and all added elements/clips.
  const elementIds = new Set(Object.keys(doc.elements));
  const clipIds = new Set(Object.keys(doc.clips ?? {}));
  for (const [streamId, variant] of sortedEntries(doc.variants)) {
    for (const [id] of sortedEntries(variant.addedElements)) {
      if (elementIds.has(id)) out.add("OVL_ID_DUPLICATE", "structure", { variant: streamId, element: id }, `ID ${id} ist bereits vergeben`);
      elementIds.add(id);
    }
    for (const [id] of sortedEntries(variant.addedClips)) {
      if (clipIds.has(id)) out.add("OVL_ID_DUPLICATE", "structure", { variant: streamId, clip: id }, `ID ${id} ist bereits vergeben`);
      clipIds.add(id);
    }
  }

  // Standard.
  const standard = buildView(doc);
  treeDiagnostics(out, standard.issues, undefined);
  for (const [id, element] of sortedEntries(doc.elements)) checkElement(out, element, { element: id }, ctx);
  const standardClips = sortedEntries(doc.clips);
  for (const [id, clip] of standardClips) checkTracks(out, id, clip, standard, {});
  const standardConflicts = ownershipConflicts(standardClips, (element, part) =>
    part ? doc.elements[element]?.parts?.[part]?.props : doc.elements[element]?.props);
  for (const c of standardConflicts) conflictDiagnostic(out, c, "structure");

  // Variants.
  const standardHealthy = standard.issues.length === 0;
  for (const [streamId, variant] of sortedEntries(doc.variants)) {
    const base = { variant: streamId };
    if (ctx.streams && !ctx.streams.includes(streamId)) {
      out.add("OVL_VARIANT_ORPHANED", "warning", base, `Stream ${streamId} gibt es nicht mehr`);
    }
    for (const [id, override] of sortedEntries(variant.elements)) {
      const element = doc.elements[id];
      if (!element) {
        out.add("OVL_REF_UNKNOWN_ELEMENT", "structure", { ...base, element: id }, `Überschreibung für unbekanntes Element ${id}`);
        continue;
      }
      checkOverride(out, element, override, { ...base, element: id }, ctx);
    }
    for (const [id, element] of sortedEntries(variant.addedElements)) {
      if (!doc.elements[id]) checkElement(out, element, { ...base, element: id }, ctx);
    }
    const known = (id: string) => doc.elements[id] !== undefined || variant.addedElements?.[id] !== undefined;
    for (const [id] of sortedEntries(variant.structure?.parents)) {
      if (!known(id)) out.add("OVL_REF_UNKNOWN_ELEMENT", "structure", { ...base, element: id }, `Umgruppierung für unbekanntes Element ${id}`);
    }
    for (const [container, ids] of sortedEntries(variant.structure?.order)) {
      if (container !== ROOT && !known(container)) {
        out.add("OVL_REF_UNKNOWN_ELEMENT", "structure", { ...base, container }, `Reihenfolge für unbekannten Container ${container}`);
      }
      for (const id of ids) {
        if (!known(id)) out.add("OVL_REF_UNKNOWN_ELEMENT", "structure", { ...base, container, ref: id }, `Reihenfolge nennt unbekanntes Element ${id}`);
      }
    }
    for (const [id] of sortedEntries(variant.clips)) {
      if (!doc.clips?.[id]) out.add("OVL_REF_UNKNOWN_CLIP", "structure", { ...base, clip: id }, `Überschreibung für unbekannten Clip ${id}`);
    }
    if (!standardHealthy) continue;

    const view = buildView(doc, variant);
    treeDiagnostics(out, view.issues, streamId);
    const clips = effectiveVariantClips(doc, variant);
    for (const [id, clip] of clips) {
      const own = variant.addedClips?.[id] !== undefined || variant.clips?.[id]?.tracks !== undefined || variant.clips?.[id]?.durationS !== undefined;
      if (own) checkTracks(out, id, clip, view, base);
    }
    const props = (element: string, part?: string) => {
      const source = doc.elements[element] ?? variant.addedElements?.[element];
      const override = variant.elements?.[element];
      if (part) return Object.assign(dict(), source?.parts?.[part]?.props, override?.parts?.[part]?.props);
      return Object.assign(dict(), source?.props, override?.props);
    };
    const known0 = new Set(standardConflicts.map((c) => `${c.key}\u0000${c.clip}\u0000${c.track}`));
    for (const c of ownershipConflicts(clips, props)) {
      if (!known0.has(`${c.key}\u0000${c.clip}\u0000${c.track}`)) conflictDiagnostic(out, c, "publish", streamId);
    }
  }

  // References to sources, assets and formulas.
  const active = activeKeys(doc);
  const downgrade = (key: string, category: DiagnosticCategory): DiagnosticCategory =>
    category === "publish" && !active.has(key) ? "warning" : category;
  if (ctx.sources) {
    const lidar = (element: OverlayElement, loc: DiagnosticLocation) => {
      if (element.type !== "lidarWidget" || element.source === undefined) return;
      if (ctx.sources!.telemetry[element.source] === "LidarGrid") return;
      const location = { ...loc, field: "source" };
      out.add("OVL_REF_UNKNOWN_SOURCE", downgrade(formulaKey(location), "publish"), { ...location, ref: element.source },
        `LiDAR-Rasterkanal ${element.source} gibt es nicht`);
    };
    for (const [id, element] of sortedEntries(doc.elements)) lidar(element, { element: id });
    for (const [streamId, variant] of sortedEntries(doc.variants)) {
      for (const [id, element] of sortedEntries(variant.addedElements)) lidar(element, { variant: streamId, element: id });
    }
    for (const [name] of sortedEntries(doc.sources?.telemetry)) {
      if (ctx.sources.telemetry[name] === undefined) {
        out.add("OVL_REF_UNKNOWN_SOURCE", "warning", { field: "sources.telemetry", ref: name }, `Fristüberschreibung für unbekannten Kanal ${name}`);
      }
    }
  }
  if (ctx.assets) {
    const asset = (element: OverlayElement, loc: DiagnosticLocation) => {
      if (element.type === "svgAsset" && element.assetId && !ctx.assets![element.assetId]) {
        out.add("OVL_REF_UNKNOWN_ASSET", "publish", { ...loc, ref: element.assetId }, "Asset ist nicht vorhanden");
      }
    };
    for (const [id, element] of sortedEntries(doc.elements)) asset(element, { element: id });
    for (const [streamId, variant] of sortedEntries(doc.variants)) {
      for (const [id, element] of sortedEntries(variant.addedElements)) asset(element, { variant: streamId, element: id });
    }
  }
  const formulas = collectFormulas(doc);
  if (ctx.expressions) {
    const env = {
      telemetry: ctx.sources?.telemetry ?? {},
      outputs: ctx.sources?.outputs ?? [],
      signals: Object.keys(doc.signals ?? {}),
    };
    for (const formula of formulas) {
      for (const d of ctx.expressions.analyze(formula.expr, env, formula.expected).diagnostics) {
        out.add(d.code, downgrade(formula.key, d.category), { ...formula.location, offset: d.offset },
          d.message ?? d.code);
      }
    }
  }

  // Limits (D33).
  const limit = (name: string, location: DiagnosticLocation, message: string) =>
    out.add("OVL_LIMIT_EXCEEDED", "structure", { ...location, limit: name }, message);
  if (Object.keys(doc.elements).length > LIMITS.elements) limit("elements", {}, "Mehr als 500 Elemente");
  for (const [streamId, variant] of sortedEntries(doc.variants)) {
    const count = Object.keys(doc.elements).length +
      Object.keys(variant.addedElements ?? {}).filter((id) => !doc.elements[id]).length;
    if (count > LIMITS.elements) limit("elements", { variant: streamId }, "Mehr als 500 Elemente");
  }
  const clipCount = Object.keys(doc.clips ?? {}).length +
    Object.values(doc.variants ?? {}).reduce((n, v) => n + Object.keys(v.addedClips ?? {}).length, 0);
  if (clipCount > LIMITS.clips) limit("clips", {}, "Mehr als 200 Clips");
  if (formulas.filter((f) => f.expr.trim() !== "").length > LIMITS.formulas) limit("formulas", {}, "Mehr als 300 Formeln");
  if (ctx.assets) {
    const used = new Set<string>();
    const collect = (element: OverlayElement) => { if (element.assetId) used.add(element.assetId); };
    Object.values(doc.elements).forEach(collect);
    Object.values(doc.variants ?? {}).forEach((v) => Object.values(v.addedElements ?? {}).forEach(collect));
    const bytes = [...used].reduce((n, id) => n + (ctx.assets![id]?.sizeBytes ?? 0), 0);
    if (bytes > LIMITS.assetBytes) limit("assets", {}, "Assets zusammen größer als 10 MB");
  }
  return out.list;
}

/** True when nothing blocks saving the draft. */
export const canSave = (diagnostics: Diagnostic[]) => diagnostics.every((d) => d.category !== "structure");
/** True when nothing blocks publishing. */
export const canPublish = (diagnostics: Diagnostic[]) => diagnostics.every((d) => d.category === "warning");

