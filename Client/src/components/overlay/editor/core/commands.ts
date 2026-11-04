// Pure command application: (document, command) → document. Variants store
// only deviations (Shared/Overlay/README.md §7): edits in a variant scope go to
// element overrides, added elements, structure entries and clip overrides.
import { deleteElements as deleteStandardElements } from "../../document/deletion";
import { detach } from "../../document/dict";
import { buildView, effectiveConfig, type View } from "../../document/resolve";
import {
  ROOT, type Clip, type ClipSettings, type DynamicProperty, type OverlayDocument, type OverlayElement, type PropertyValue,
  type RootTransform, type Track, type Variant,
} from "../../document/types";
import { decompose, layout, multiply, invert, round, staticProps, type GeometryContext, type Mat } from "./geometry";
import { CommandError, OVERRIDABLE_ATTRIBUTES, type EditorCommand, type Scope, type TrackRef } from "./types";
import { jsonEqual, share, Writer } from "./writer";

const ID = /^[A-Za-z0-9_-]{1,64}$/;

const fail = (code: string, message: string): never => {
  throw new CommandError(code, message);
};

function variantOf(doc: OverlayDocument, scope: string): Variant {
  return doc.variants?.[scope] ?? fail("OVL_EDITOR_NO_VARIANT", `Variante ${scope} gibt es nicht`);
}

function viewOf(doc: OverlayDocument, scope: Scope): View {
  return buildView(doc, scope === null ? undefined : variantOf(doc, scope));
}

type TargetKind = "standard" | "override" | "added";

/** Where the data of an element lives in the given scope. */
function elementTarget(doc: OverlayDocument, scope: Scope, id: string): { path: string[]; kind: TargetKind } {
  if (scope === null) {
    if (!doc.elements[id]) fail("OVL_EDITOR_UNKNOWN_ELEMENT", `Element ${id} gibt es im Standard nicht`);
    return { path: ["elements", id], kind: "standard" };
  }
  const v = variantOf(doc, scope);
  if (doc.elements[id]) return { path: ["variants", scope, "elements", id], kind: "override" };
  if (v.addedElements?.[id]) return { path: ["variants", scope, "addedElements", id], kind: "added" };
  return fail("OVL_EDITOR_UNKNOWN_ELEMENT", `Element ${id} gibt es in der Variante ${scope} nicht`);
}

/** Element type in the scope (standard or added by the variant). */
function elementOf(doc: OverlayDocument, scope: Scope, id: string): OverlayElement | undefined {
  return doc.elements[id] ?? (scope === null ? undefined : doc.variants?.[scope]?.addedElements?.[id]);
}

/** All element ids of the shared namespace (standard and every variant). */
export function allElementIds(doc: OverlayDocument): Set<string> {
  const ids = new Set(Object.keys(doc.elements));
  for (const v of Object.values(doc.variants ?? {})) for (const id of Object.keys(v.addedElements ?? {})) ids.add(id);
  return ids;
}

export function allClipIds(doc: OverlayDocument): Set<string> {
  const ids = new Set(Object.keys(doc.clips ?? {}));
  for (const v of Object.values(doc.variants ?? {})) for (const id of Object.keys(v.addedClips ?? {})) ids.add(id);
  return ids;
}

const isDynamic = (v: unknown): v is DynamicProperty => typeof v === "object" && v !== null;

/** Replaces the static part of a value and keeps its driver. */
export function withBase(current: PropertyValue | undefined, literal: number | string | boolean | null): PropertyValue {
  return isDynamic(current) ? { ...current, base: literal } : literal;
}

/** Writes props of an element in a scope; `undefined` removes. */
function writeProps(w: Writer<OverlayDocument>, scope: Scope, id: string, part: string | undefined, props: Record<string, PropertyValue | undefined>) {
  const target = elementTarget(w.current, scope, id);
  const base = [...target.path, ...(part !== undefined ? ["parts", part] : []), "props"];
  for (const [name, value] of Object.entries(props)) {
    if (value === undefined) w.remove([...base, name], 3);
    else w.set([...base, name], value);
  }
}

/** Effective container of an element in a view. */
function containerOf(view: View, id: string): string {
  const parent = view.parent.get(id);
  if (parent === undefined) fail("OVL_EDITOR_UNKNOWN_ELEMENT", `Element ${id} liegt in keinem Container`);
  return parent!;
}

function checkContainer(doc: OverlayDocument, scope: Scope, container: string) {
  if (container === ROOT) return;
  const el = elementOf(doc, scope, container);
  if (!el || el.type !== "group") fail("OVL_EDITOR_NOT_A_GROUP", `${container} ist keine Gruppe`);
}

function checkNewId(ids: Set<string>, id: string, kind = "Element") {
  if (!ID.test(id) || id === ROOT) fail("OVL_EDITOR_INVALID_ID", `${kind}-ID ${id} ist ungültig`);
  if (ids.has(id)) fail("OVL_EDITOR_DUPLICATE_ID", `${kind}-ID ${id} ist bereits vergeben`);
  ids.add(id);
}

/** Path of the declared children list of a container in a scope, or undefined when the variant uses structure entries. */
function declaredList(doc: OverlayDocument, scope: Scope, container: string): string[] | undefined {
  if (scope === null) return container === ROOT ? ["children"] : ["elements", container, "children"];
  if (container !== ROOT && doc.variants?.[scope]?.addedElements?.[container]) {
    return ["variants", scope, "addedElements", container, "children"];
  }
  return undefined;
}

/** Variant: removes an element from wherever the variant placed it (added group lists, structure entry). */
function detachInVariant(w: Writer<OverlayDocument>, scope: string, id: string) {
  const v = w.current.variants![scope];
  for (const [gid, el] of Object.entries(v.addedElements ?? {})) {
    if (el.children?.includes(id)) {
      const list = w.arr(["variants", scope, "addedElements", gid, "children"]) as string[];
      list.splice(list.indexOf(id), 1);
    }
  }
  w.remove(["variants", scope, "structure", "parents", id], 3);
}

/** Puts elements into a container of a scope; the caller has removed them from their old place. */
function placeInContainer(w: Writer<OverlayDocument>, scope: Scope, ids: string[], container: string, index: number | undefined, before: View) {
  if (scope === null) {
    const list = w.arr(declaredList(w.current, null, container)!) as string[];
    const at = index === undefined ? list.length : Math.max(0, Math.min(index, list.length));
    list.splice(at, 0, ...ids);
    return;
  }
  const doc = w.current;
  const declared = declaredList(doc, scope, container);
  const standard = buildView(doc);
  for (const id of ids) {
    // Standard elements are moved by structure entries only (one declared container).
    if (declared && !doc.elements[id]) {
      (w.arr(declared) as string[]).push(id);
    } else if (doc.elements[id] && standard.parent.get(id) === container) {
      w.remove(["variants", scope, "structure", "parents", id], 3);
    } else {
      w.set(["variants", scope, "structure", "parents", id], container);
    }
  }
  // Order: wanted = previous effective order without the moved ids, ids inserted at index.
  const prevOrder = (before.children.get(container) ?? []).filter((id) => !ids.includes(id));
  const at = index === undefined ? prevOrder.length : Math.max(0, Math.min(index, prevOrder.length));
  const wanted = [...prevOrder.slice(0, at), ...ids, ...prevOrder.slice(at)];
  setVariantOrder(w, scope, container, wanted);
}

/** Writes a variant order entry only when the natural order differs. */
function setVariantOrder(w: Writer<OverlayDocument>, scope: string, container: string, wanted: string[]) {
  w.remove(["variants", scope, "structure", "order", container], 3);
  const natural = buildView(w.current, w.current.variants![scope]).children.get(container) ?? [];
  if (!jsonEqual(natural, wanted)) w.set(["variants", scope, "structure", "order", container], [...wanted]);
}

/** Removes ids from their standard container lists. */
function detachInStandard(w: Writer<OverlayDocument>, ids: string[]) {
  const doc = w.current;
  const drop = new Set(ids);
  if (doc.children.some((id) => drop.has(id))) w.set(["children"], doc.children.filter((id) => !drop.has(id)));
  for (const [gid, el] of Object.entries(doc.elements)) {
    if (el.children?.some((id) => drop.has(id))) w.set(["elements", gid, "children"], el.children.filter((id) => !drop.has(id)));
  }
}

// --- Placement preservation (ungroup, reparent with keepPosition) ---

const TRANSFORM = ["x", "y", "rotation", "scaleX", "scaleY"] as const;

interface Snapshot {
  scope: Scope;
  id: string;
  world: Mat;
}

function scopes(doc: OverlayDocument): Scope[] {
  return [null, ...Object.keys(doc.variants ?? {}).sort()];
}

/** World matrices of elements in every view where they are present. */
function snapshotWorld(doc: OverlayDocument, ids: Set<string>, ctx: GeometryContext): Snapshot[] {
  const out: Snapshot[] = [];
  for (const scope of scopes(doc)) {
    const config = effectiveConfig(doc, scope);
    const placements = layout(config, undefined, ctx);
    for (const id of ids) {
      const p = placements.get(id);
      if (p) out.push({ scope, id, world: p.world });
    }
  }
  return out;
}

/** After a structure change: writes transform props so that each element keeps its world matrix in each view. */
function restoreWorld(w: Writer<OverlayDocument>, snaps: Snapshot[], ctx: GeometryContext) {
  for (const scope of scopes(w.current)) {
    const mine = snaps.filter((s) => s.scope === scope);
    if (mine.length === 0) continue;
    const config = effectiveConfig(w.current, scope);
    const placements = layout(config, undefined, ctx);
    for (const snap of mine) {
      const p = placements.get(snap.id);
      const el = config.elements[snap.id];
      if (!p || !el) continue;
      const wanted = multiply(invert(p.parentWorld), snap.world);
      const current = staticProps(el.type, el.props, el.lockAspect);
      const d = decompose(wanted, p.pivot, Number(current.rotation) || 0);
      const next: Record<string, number> = { x: round(d.x), y: round(d.y), rotation: round(d.rotation, 4), scaleX: round(d.scaleX, 6), scaleY: round(d.scaleY, 6) };
      if (el.lockAspect) delete next.scaleY;
      const changes: Record<string, PropertyValue | undefined> = {};
      for (const name of TRANSFORM) {
        if (next[name] === undefined) continue;
        const was = Number(current[name] ?? (name.startsWith("scale") ? 1 : 0));
        if (Math.abs(was - next[name]) > 1e-6) changes[name] = withBase(el.props[name], next[name]);
      }
      if (Object.keys(changes).length > 0) writeProps(w, scope, snap.id, undefined, changes);
    }
  }
}

// --- Variant-local deletion ---

function deleteInVariant(w: Writer<OverlayDocument>, scope: string, ids: string[]) {
  const doc = w.current;
  const v = variantOf(doc, scope);
  for (const id of ids) {
    if (!v.addedElements?.[id]) {
      fail(doc.elements[id] ? "OVL_EDITOR_INHERITED" : "OVL_EDITOR_UNKNOWN_ELEMENT",
        doc.elements[id] ? `${id} gehört zum Standard; in der Variante kann es nur deaktiviert werden` : `Element ${id} gibt es nicht`);
    }
  }
  const view = buildView(doc, v);
  const removed = new Set<string>();
  const visit = (id: string) => {
    if (removed.has(id) || !v.addedElements?.[id]) return;
    removed.add(id);
    for (const c of view.children.get(id) ?? []) visit(c);
  };
  ids.forEach(visit);
  for (const id of removed) w.remove(["variants", scope, "addedElements", id], 3);
  for (const [gid, el] of Object.entries(w.current.variants![scope].addedElements ?? {})) {
    if (el.children?.some((c) => removed.has(c))) w.set(["variants", scope, "addedElements", gid, "children"], el.children.filter((c) => !removed.has(c)));
  }
  // Standard elements moved into a removed group return to their declared container.
  for (const [id, target] of Object.entries(v.structure?.parents ?? {})) {
    if (removed.has(id) || removed.has(target)) w.remove(["variants", scope, "structure", "parents", id], 3);
  }
  for (const [container, order] of Object.entries(v.structure?.order ?? {})) {
    if (removed.has(container)) w.remove(["variants", scope, "structure", "order", container], 3);
    else if (order.some((id) => removed.has(id))) w.set(["variants", scope, "structure", "order", container], order.filter((id) => !removed.has(id)));
  }
  const dropTracks = (path: string[], clip: ClipSettings) => {
    if (clip.tracks?.some((t) => removed.has(t.element))) w.set([...path, "tracks"], clip.tracks.filter((t) => !removed.has(t.element)));
  };
  for (const [cid, clip] of Object.entries(v.clips ?? {})) dropTracks(["variants", scope, "clips", cid], clip);
  for (const [cid, clip] of Object.entries(v.addedClips ?? {})) dropTracks(["variants", scope, "addedClips", cid], clip);
}

// --- Clips ---

function clipTarget(doc: OverlayDocument, scope: Scope, id: string): { path: string[]; kind: TargetKind; clip: ClipSettings } {
  if (scope === null) {
    const clip = doc.clips?.[id] ?? fail("OVL_EDITOR_UNKNOWN_CLIP", `Clip ${id} gibt es im Standard nicht`);
    return { path: ["clips", id], kind: "standard", clip };
  }
  const v = variantOf(doc, scope);
  if (doc.clips?.[id]) return { path: ["variants", scope, "clips", id], kind: "override", clip: { ...doc.clips[id], ...(v.clips?.[id] ?? {}) } };
  const added = v.addedClips?.[id] ?? fail("OVL_EDITOR_UNKNOWN_CLIP", `Clip ${id} gibt es in der Variante ${scope} nicht`);
  return { path: ["variants", scope, "addedClips", id], kind: "added", clip: added };
}

const REQUIRED_CLIP_FIELDS = new Set(["durationS", "trigger", "tracks"]);

const sameTrack = (t: Track, r: TrackRef) => t.element === r.element && t.property === r.property && (t.part ?? undefined) === (r.part ?? undefined);

// --- Workspace ---

function fitTransform(from: { width: number; height: number }, to: { width: number; height: number }, current: RootTransform | undefined): RootTransform {
  const s = Math.min(to.width / from.width, to.height / from.height);
  const ox = (to.width - from.width * s) / 2;
  const oy = (to.height - from.height * s) / 2;
  const c = current ?? { scale: 1, offsetX: 0, offsetY: 0 };
  return { scale: round(c.scale * s, 6), offsetX: round(c.offsetX * s + ox), offsetY: round(c.offsetY * s + oy) };
}

// --- Main entry ---

export type ApplyContext = GeometryContext;

/** Applies a command whose `variant` has been resolved. Throws CommandError. */
export function applyCommand(doc: OverlayDocument, cmd: EditorCommand, ctx: ApplyContext = {}): OverlayDocument {
  const w = new Writer(doc);
  const scope: Scope = "variant" in cmd && cmd.variant !== undefined ? cmd.variant : null;

  switch (cmd.type) {
    case "setProperty":
      writeProps(w, scope, cmd.element, cmd.part, { [cmd.property]: cmd.value });
      break;

    case "setProperties":
      writeProps(w, scope, cmd.element, cmd.part, cmd.props);
      break;

    case "resetOverride": {
      const target = elementTarget(doc, cmd.variant, cmd.element);
      if (target.kind !== "override") fail("OVL_EDITOR_NOT_INHERITED", `${cmd.element} ist kein geerbtes Element`);
      if (cmd.property !== undefined) {
        w.remove([...target.path, ...(cmd.part !== undefined ? ["parts", cmd.part] : []), "props", cmd.property], 3);
      } else if (cmd.attribute !== undefined) {
        w.remove([...target.path, cmd.attribute], 3);
      } else if (cmd.part !== undefined) {
        w.remove([...target.path, "parts", cmd.part], 3);
      } else {
        w.remove(target.path, 3);
      }
      break;
    }

    case "setAttribute": {
      const overridable = OVERRIDABLE_ATTRIBUTES.includes(cmd.name);
      // Name, source and asset are shared by all views: they always edit the element itself.
      const target = overridable || scope === null || !doc.elements[cmd.element]
        ? elementTarget(doc, scope, cmd.element)
        : elementTarget(doc, null, cmd.element);
      if (cmd.value === undefined) w.remove([...target.path, cmd.name], 3);
      else w.set([...target.path, cmd.name], cmd.value);
      if (cmd.name === "lockAspect" && cmd.value === true) {
        // D02: a locked aspect has no scaleY.
        w.remove([...target.path, "props", "scaleY"], 3);
      }
      break;
    }

    case "setInteraction": {
      // Like the name: shared by all views, so a standard element is edited in the standard.
      const target = doc.elements[cmd.element] ? elementTarget(doc, null, cmd.element) : elementTarget(doc, scope, cmd.element);
      const path = cmd.part === undefined ? [...target.path, "interaction"] : [...target.path, "parts", cmd.part, "interaction"];
      if (cmd.interaction === undefined) w.remove(path, target.path.length + 1);
      else w.set(path, detach(cmd.interaction));
      break;
    }

    case "addElements": {
      const container = cmd.container ?? ROOT;
      checkContainer(doc, scope, container);
      const ids = allElementIds(doc);
      for (const id of Object.keys(cmd.elements)) checkNewId(ids, id);
      for (const r of cmd.roots) if (!cmd.elements[r]) fail("OVL_EDITOR_UNKNOWN_ELEMENT", `Wurzel ${r} fehlt in elements`);
      const before = viewOf(doc, scope);
      const base = scope === null ? ["elements"] : ["variants", scope, "addedElements"];
      for (const [id, el] of Object.entries(cmd.elements)) w.set([...base, id], detach(el));
      placeInContainer(w, scope, cmd.roots, container, cmd.index, before);
      break;
    }

    case "deleteElements": {
      if (cmd.ids.length === 0) break;
      if (scope === null) {
        for (const id of cmd.ids) if (!doc.elements[id]) fail("OVL_EDITOR_UNKNOWN_ELEMENT", `Element ${id} gibt es im Standard nicht`);
        return share(doc, deleteStandardElements(doc, cmd.ids));
      }
      deleteInVariant(w, scope, cmd.ids);
      break;
    }

    case "groupElements": {
      if (cmd.ids.length === 0) fail("OVL_EDITOR_EMPTY", "Keine Elemente zum Gruppieren");
      checkNewId(allElementIds(doc), cmd.groupId);
      const view = viewOf(doc, scope);
      const container = containerOf(view, cmd.ids[0]);
      for (const id of cmd.ids) {
        if (containerOf(view, id) !== container) fail("OVL_EDITOR_MIXED_CONTAINERS", "Gruppieren nur innerhalb eines Containers");
      }
      const list = view.children.get(container) ?? [];
      const members = list.filter((id) => cmd.ids.includes(id));
      const top = Math.max(...members.map((id) => list.indexOf(id)));
      const index = list.slice(0, top).filter((id) => !members.includes(id)).length;
      const group: OverlayElement = { type: "group", children: [] };
      if (cmd.name !== undefined) group.name = cmd.name;
      if (cmd.pivot) group.props = { pivotX: round(cmd.pivot.x), pivotY: round(cmd.pivot.y) };
      if (scope === null) {
        detachInStandard(w, members);
        group.children = members;
        w.set(["elements", cmd.groupId], group);
        placeInContainer(w, null, [cmd.groupId], container, index, view);
      } else {
        w.set(["variants", scope, "addedElements", cmd.groupId], group);
        for (const id of members) detachInVariant(w, scope, id);
        placeInContainer(w, scope, members, cmd.groupId, undefined, buildView(w.current, w.current.variants![scope]));
        setVariantOrder(w, scope, cmd.groupId, members);
        placeInContainer(w, scope, [cmd.groupId], container, index, buildView(w.current, w.current.variants![scope]));
      }
      break;
    }

    case "ungroup": {
      const view = viewOf(doc, scope);
      const group = elementOf(doc, scope, cmd.group);
      if (!group || group.type !== "group") fail("OVL_EDITOR_NOT_A_GROUP", `${cmd.group} ist keine Gruppe`);
      if (scope !== null && doc.elements[cmd.group]) fail("OVL_EDITOR_INHERITED", "Geerbte Gruppen werden im Standard aufgelöst");
      const container = containerOf(view, cmd.group);
      const list = view.children.get(container) ?? [];
      const index = list.indexOf(cmd.group);
      const children = view.children.get(cmd.group) ?? [];
      // Children of the group in every view keep their appearance.
      const inViews = new Set<string>(children);
      for (const s of scopes(doc)) for (const c of viewOf(doc, s).children.get(cmd.group) ?? []) inViews.add(c);
      const snaps = snapshotWorld(doc, inViews, ctx);
      if (scope === null) {
        const own = doc.elements[cmd.group].children ?? [];
        detachInStandard(w, own);
        w.set(["elements", cmd.group, "children"], []);
        placeInContainer(w, null, own, container, index, view);
        // Variants: whatever else sits in the group follows the group's container there.
        for (const s of Object.keys(doc.variants ?? {})) {
          const vView = buildView(w.current, w.current.variants![s]);
          const rest = vView.children.get(cmd.group) ?? [];
          if (rest.length === 0) continue;
          const target = vView.parent.get(cmd.group) ?? ROOT;
          const pos = (vView.children.get(target) ?? []).indexOf(cmd.group);
          for (const id of rest) detachInVariant(w, s, id);
          placeInContainer(w, s, rest, target, pos < 0 ? undefined : pos, buildView(w.current, w.current.variants![s]));
        }
        const removed = share(w.current, deleteStandardElements(w.current, [cmd.group]));
        const w2 = new Writer(removed);
        restoreWorld(w2, snaps.filter((s) => s.id !== cmd.group), ctx);
        return w2.result;
      }
      for (const id of children) detachInVariant(w, scope, id);
      placeInContainer(w, scope, children, container, index, buildView(w.current, w.current.variants![scope]));
      deleteInVariant(w, scope, [cmd.group]);
      restoreWorld(w, snaps.filter((s) => s.scope === scope), ctx);
      break;
    }

    case "reparent": {
      checkContainer(doc, scope, cmd.container);
      const view = viewOf(doc, scope);
      for (const id of cmd.ids) {
        if (!view.elements.has(id)) fail("OVL_EDITOR_UNKNOWN_ELEMENT", `Element ${id} gibt es nicht`);
        // No cycles: the target must not be inside a moved element.
        for (let p: string | undefined = cmd.container; p !== undefined && p !== ROOT; p = view.parent.get(p)) {
          if (p === id) fail("OVL_EDITOR_CYCLE", `${id} kann nicht in sich selbst verschoben werden`);
        }
      }
      const snaps = cmd.keepPosition ? snapshotWorld(doc, new Set(cmd.ids), ctx).filter((s) => s.scope === scope) : [];
      if (scope === null) {
        detachInStandard(w, cmd.ids);
        placeInContainer(w, null, cmd.ids, cmd.container, cmd.index, view);
      } else {
        for (const id of cmd.ids) detachInVariant(w, scope, id);
        placeInContainer(w, scope, cmd.ids, cmd.container, cmd.index, view);
      }
      if (cmd.keepPosition) restoreWorld(w, snaps, ctx);
      break;
    }

    case "reorder": {
      const view = viewOf(doc, scope);
      const current = view.children.get(cmd.container);
      if (!current) fail("OVL_EDITOR_NOT_A_GROUP", `${cmd.container} ist kein Container`);
      if (current!.length !== cmd.order.length || ![...current!].sort().every((id, i) => id === [...cmd.order].sort()[i])) {
        fail("OVL_EDITOR_INVALID_ORDER", "Die Reihenfolge muss genau die Elemente des Containers enthalten");
      }
      if (scope === null) {
        w.set(declaredList(doc, null, cmd.container)!, [...cmd.order]);
      } else {
        // Added groups keep their own order list; elsewhere the variant writes an order entry.
        const declared = declaredList(doc, scope, cmd.container);
        const own = declared ? (w.get(declared) as string[]) : undefined;
        if (declared && own && own.length === cmd.order.length) w.set(declared, [...cmd.order]);
        else setVariantOrder(w, scope, cmd.container, cmd.order);
      }
      break;
    }

    case "resetStructure": {
      variantOf(doc, cmd.variant);
      if (cmd.element !== undefined) w.remove(["variants", cmd.variant, "structure", "parents", cmd.element], 3);
      if (cmd.container !== undefined) w.remove(["variants", cmd.variant, "structure", "order", cmd.container], 3);
      break;
    }

    case "addClip": {
      checkNewId(allClipIds(doc), cmd.id, "Clip");
      w.set(scope === null ? ["clips", cmd.id] : ["variants", scope, "addedClips", cmd.id], detach(cmd.clip));
      if (scope !== null) variantOf(doc, scope);
      break;
    }

    case "updateClip": {
      const target = clipTarget(doc, scope, cmd.id);
      for (const [key, value] of Object.entries(cmd.changes)) {
        if (value === undefined) {
          if (target.kind !== "override" && REQUIRED_CLIP_FIELDS.has(key)) fail("OVL_EDITOR_REQUIRED", `${key} ist erforderlich`);
          w.remove([...target.path, key], 3);
        } else {
          w.set([...target.path, key], detach(value));
        }
      }
      break;
    }

    case "removeClip": {
      const target = clipTarget(doc, scope, cmd.id);
      if (target.kind === "override") fail("OVL_EDITOR_INHERITED", "Geerbte Clips werden im Standard gelöscht oder in der Variante deaktiviert");
      w.remove(target.path, target.kind === "added" ? 3 : 1);
      if (target.kind === "standard") {
        for (const s of Object.keys(doc.variants ?? {})) w.remove(["variants", s, "clips", cmd.id], 3);
      }
      break;
    }

    case "setKeyframes": {
      const target = clipTarget(doc, scope, cmd.clip);
      const tracks = [...(target.clip.tracks ?? [])];
      const i = tracks.findIndex((t) => sameTrack(t, cmd.track));
      if (cmd.keyframes === null) {
        if (i >= 0) tracks.splice(i, 1);
      } else {
        const track: Track = { element: cmd.track.element, property: cmd.track.property, keyframes: detach(cmd.keyframes) };
        if (cmd.track.part !== undefined) track.part = cmd.track.part;
        if (i >= 0) tracks[i] = track;
        else tracks.push(track);
      }
      w.set([...target.path, "tracks"], tracks);
      break;
    }

    case "setSignals":
      w.set(["signals"], detach(cmd.signals));
      if (Object.keys(cmd.signals).length === 0) w.remove(["signals"]);
      break;

    case "setSourceSettings":
      if (cmd.settings === undefined) w.remove(["sources", "telemetry", cmd.channel], 1);
      else w.set(["sources", "telemetry", cmd.channel], detach(cmd.settings));
      break;

    case "setWorkspace": {
      if (!(cmd.width > 0 && cmd.height > 0)) fail("OVL_EDITOR_INVALID_WORKSPACE", "Arbeitsfläche muss positiv sein");
      const size = { width: Math.round(cmd.width), height: Math.round(cmd.height) };
      if (scope === null) {
        if (cmd.mode === "fitContent") w.set(["rootTransform"], fitTransform(doc.workspace, size, doc.rootTransform));
        w.set(["workspace"], size);
      } else {
        const v = variantOf(doc, scope);
        const from = v.workspace ?? doc.workspace;
        // Effective root transform before the change (resolve.ts): own workspace → own transform only.
        const effective = v.workspace ? v.rootTransform : (v.rootTransform ?? doc.rootTransform);
        const next = cmd.mode === "fitContent" ? fitTransform(from, size, effective) : effective;
        w.set(["variants", scope, "workspace"], size);
        if (next) w.set(["variants", scope, "rootTransform"], next);
        else w.remove(["variants", scope, "rootTransform"], 3);
      }
      break;
    }

    case "setRootTransform": {
      const path = scope === null ? ["rootTransform"] : ["variants", scope, "rootTransform"];
      if (scope !== null) variantOf(doc, scope);
      if (cmd.rootTransform === undefined) w.remove(path, 3);
      else w.set(path, { ...cmd.rootTransform });
      break;
    }

    case "setOverlayDisabled":
      if (cmd.disabled) w.set(["disabled"], true);
      else w.remove(["disabled"]);
      break;

    case "setVariant": {
      if (cmd.streamId.length === 0) fail("OVL_EDITOR_INVALID_ID", "StreamId fehlt");
      const existing = doc.variants?.[cmd.streamId];
      w.obj(["variants", cmd.streamId]);
      const s = cmd.settings ?? {};
      for (const key of ["disabled", "workspace", "rootTransform"] as const) {
        const value = s[key];
        if (value === undefined) continue;
        if (value === null || value === false) w.remove(["variants", cmd.streamId, key], 3);
        else w.set(["variants", cmd.streamId, key], detach(value));
      }
      // A new own workspace keeps the inherited root transform (resolve.ts rule).
      if (s.workspace && !existing?.workspace && s.rootTransform === undefined && !existing?.rootTransform && doc.rootTransform) {
        w.set(["variants", cmd.streamId, "rootTransform"], { ...doc.rootTransform });
      }
      break;
    }

    case "removeVariant":
      variantOf(doc, cmd.streamId);
      w.remove(["variants", cmd.streamId], 1);
      break;

    case "reassignVariant": {
      const v = variantOf(doc, cmd.from);
      if (doc.variants?.[cmd.to]) fail("OVL_EDITOR_VARIANT_EXISTS", `Stream ${cmd.to} hat bereits eine Variante`);
      w.remove(["variants", cmd.from], 1);
      w.set(["variants", cmd.to], v);
      break;
    }

    case "replaceDocument":
      return share(doc, detach(cmd.document));
  }
  return w.result;
}

/** Fills in the scope of a command (undefined → active scope). */
export function withScope(cmd: EditorCommand, active: Scope): EditorCommand {
  if (!("variant" in cmd) || cmd.variant === undefined) {
    switch (cmd.type) {
      case "setSignals": case "setSourceSettings": case "setOverlayDisabled": case "setVariant": case "removeVariant":
      case "reassignVariant": case "replaceDocument": case "resetOverride": case "resetStructure":
        return cmd;
      default:
        return { ...cmd, variant: active } as EditorCommand;
    }
  }
  return cmd;
}

/** Short German label for the undo history. */
export function commandLabel(cmd: EditorCommand): string {
  switch (cmd.type) {
    case "setProperty": return `${cmd.property} ändern`;
    case "setProperties": return "Transformation";
    case "resetOverride": return "Überschreibung zurücksetzen";
    case "setAttribute": return `${cmd.name} ändern`;
    case "setInteraction": return "Interaktion";
    case "addElements": return "Element einfügen";
    case "deleteElements": return "Löschen";
    case "groupElements": return "Gruppieren";
    case "ungroup": return "Gruppe auflösen";
    case "reparent": return "Verschieben in Container";
    case "reorder": return "Ebenenreihenfolge";
    case "resetStructure": return "Struktur zurücksetzen";
    case "addClip": return "Clip anlegen";
    case "updateClip": return "Clip ändern";
    case "removeClip": return "Clip löschen";
    case "setKeyframes": return "Keyframes";
    case "setSignals": return "Signale";
    case "setSourceSettings": return "Quelleinstellungen";
    case "setWorkspace": return "Arbeitsfläche";
    case "setRootTransform": return "Wurzel-Transformation";
    case "setOverlayDisabled": return cmd.disabled ? "Overlay deaktivieren" : "Overlay aktivieren";
    case "setVariant": return "Variante";
    case "removeVariant": return "Variante löschen";
    case "reassignVariant": return "Variante zuordnen";
    case "replaceDocument": return cmd.reason === "import" ? "Import" : cmd.reason === "backup" ? "Sicherung übernehmen" : "Wiederherstellen";
  }
}

export type { Clip };
