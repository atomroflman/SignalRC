// Design tools on top of the commands: move, resize, rotate, align, distribute,
// duplicate, layer order, grouping. Pure functions computing commands from
// the effective configuration and placements; the store applies them.
import { defaultLockAspect } from "../../document/catalog";
import { LIDAR_GRID_CHANNEL } from "../../lidar-source/options";
import { dict } from "../../document/dict";
import { ROOT, type EffectiveConfig, type EffectiveElement, type ElementType, type OverlayElement, type PropertyValue } from "../../document/types";
import { allClipIds, allElementIds, withBase } from "./commands";
import { apply, invert, localMatrix, multiply, round, selectionBox, staticProps, worldBox, type Box, type Placement } from "./geometry";
import type { EditorStore } from "./store";
import type { EditorCommand, Point } from "./types";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** New id `e_`/`c_` + 10 random characters (Shared/Overlay/README.md §2), unused in `taken`. */
export function newId(prefix: "e" | "c", taken: Set<string>, random: () => number = Math.random): string {
  for (;;) {
    let id = `${prefix}_`;
    for (let i = 0; i < 10; i++) id += ALPHABET[Math.floor(random() * ALPHABET.length)];
    if (!taken.has(id)) {
      taken.add(id);
      return id;
    }
  }
}

export const newElementId = (store: EditorStore, random?: () => number) => newId("e", allElementIds(store.document), random);
export const newClipId = (store: EditorStore, random?: () => number) => newId("c", allClipIds(store.document), random);

/** Static value of a prop of an effective element. */
const sv = (el: EffectiveElement, name: string) => staticProps(el.type, el.props, el.lockAspect)[name];
const num = (v: unknown, fallback = 0) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** Converts a workspace vector into the parent coordinate system of an element. */
function toParent(p: Placement, dx: number, dy: number): [number, number] {
  const inv = invert(p.parentWorld);
  return [inv[0] * dx + inv[2] * dy, inv[1] * dx + inv[3] * dy];
}

function setProps(el: EffectiveElement, values: Record<string, number>): EditorCommand {
  const props: Record<string, PropertyValue> = {};
  for (const [k, v] of Object.entries(values)) props[k] = withBase(el.props[k], v);
  return { type: "setProperties", element: el.id, props };
}

/** Moves elements by a workspace offset. */
export function moveCommands(config: EffectiveConfig, placements: Map<string, Placement>, ids: string[], dx: number, dy: number): EditorCommand[] {
  const out: EditorCommand[] = [];
  for (const id of topLevel(config, ids)) {
    const el = config.elements[id];
    const p = placements.get(id);
    if (!el || !p) continue;
    const [px, py] = toParent(p, dx, dy);
    out.push(setProps(el, { x: round(num(sv(el, "x")) + px), y: round(num(sv(el, "y")) + py) }));
  }
  return out;
}

/** Drops ids whose ancestor is also given (moving a group moves its children). */
export function topLevel(config: EffectiveConfig, ids: string[]): string[] {
  const set = new Set(ids);
  return ids.filter((id) => {
    for (let p = config.elements[id]?.parent; p !== undefined && p !== ROOT; p = config.elements[p]?.parent) if (set.has(p)) return false;
    return true;
  });
}

export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** Elements resized through their size props instead of scale (stroke widths stay). */
const SIZED: ElementType[] = ["rect", "ellipse", "linearGauge"];

/**
 * Resize by dragging a handle to `pointer` (workspace). The opposite side stays
 * in place. `keepAspect` (Shift, or lockAspect) scales proportionally.
 */
export function resizeCommand(el: EffectiveElement, start: Placement, handle: Handle, pointer: Point, keepAspect: boolean): EditorCommand {
  const [bx, by, bw, bh] = start.box;
  const [lx, ly] = apply(invert(start.world), pointer.x, pointer.y);
  const hx = handle.includes("e") ? 1 : handle.includes("w") ? -1 : 0;
  const hy = handle.includes("s") ? 1 : handle.includes("n") ? -1 : 0;
  // Anchor = opposite edge/corner in local coordinates.
  const ax = hx === 1 ? bx : hx === -1 ? bx + bw : bx + bw / 2;
  const ay = hy === 1 ? by : hy === -1 ? by + bh : by + bh / 2;
  let fx = hx === 0 || bw === 0 ? 1 : (hx * (lx - ax)) / bw;
  let fy = hy === 0 || bh === 0 ? 1 : (hy * (ly - ay)) / bh;
  const lock = keepAspect || el.lockAspect;
  if (lock) {
    const f = hx === 0 ? fy : hy === 0 ? fx : Math.max(Math.abs(fx), Math.abs(fy)) * Math.sign(fx * fy || 1);
    fx = f;
    fy = f;
  }
  const minF = 0.01;
  const sized = SIZED.includes(el.type);
  // Sized elements do not flip; scaled ones may mirror.
  if (sized) {
    fx = Math.max(minF, fx);
    fy = Math.max(minF, fy);
  }
  if (Math.abs(fx) < minF) fx = minF * (Math.sign(fx) || 1);
  if (Math.abs(fy) < minF) fy = minF * (Math.sign(fy) || 1);

  const p = staticProps(el.type, el.props, el.lockAspect);
  const next: Record<string, unknown> = { ...p };
  const values: Record<string, number> = {};
  if (sized) {
    values.width = round(Math.max(0, num(p.width) * fx));
    values.height = round(Math.max(0, num(p.height) * fy));
    next.width = values.width;
    next.height = values.height;
  } else {
    values.scaleX = round(num(p.scaleX, 1) * fx, 6);
    next.scaleX = values.scaleX;
    if (!el.lockAspect) {
      values.scaleY = round(num(p.scaleY, 1) * fy, 6);
      next.scaleY = values.scaleY;
    } else {
      next.scaleY = values.scaleX;
    }
  }
  // Keep the anchor: world position of the anchor before == after.
  const anchorBefore = apply(start.world, ax, ay);
  const sizedBox: Box = sized ? [0, 0, values.width, values.height] : start.box;
  const anchorLocal: [number, number] = sized
    ? [hx === -1 ? sizedBox[2] : hx === 1 ? 0 : sizedBox[2] / 2, hy === -1 ? sizedBox[3] : hy === 1 ? 0 : sizedBox[3] / 2]
    : [ax, ay];
  const worldAfter = multiply(start.parentWorld, localMatrix(next, sizedBox));
  const anchorAfter = apply(worldAfter, anchorLocal[0], anchorLocal[1]);
  const [dx, dy] = toParent(start, anchorBefore[0] - anchorAfter[0], anchorBefore[1] - anchorAfter[1]);
  values.x = round(num(p.x) + dx);
  values.y = round(num(p.y) + dy);
  return setProps(el, values);
}

/** Rotation around the pivot so that the handle points at `pointer`; `snapDeg` rounds (Shift: 15°). */
export function rotateCommand(el: EffectiveElement, start: Placement, startPointer: Point, pointer: Point, snapDeg = 0): EditorCommand {
  const [cx, cy] = apply(start.world, start.pivot[0], start.pivot[1]);
  const a0 = Math.atan2(startPointer.y - cy, startPointer.x - cx);
  const a1 = Math.atan2(pointer.y - cy, pointer.x - cx);
  const mirrored = start.parentWorld[0] * start.parentWorld[3] - start.parentWorld[1] * start.parentWorld[2] < 0;
  let delta = ((a1 - a0) * 180) / Math.PI;
  if (mirrored) delta = -delta;
  let rotation = num(sv(el, "rotation")) + delta;
  if (snapDeg > 0) rotation = Math.round(rotation / snapDeg) * snapDeg;
  return setProps(el, { rotation: round(rotation, 4) });
}

export type AlignMode = "left" | "centerX" | "right" | "top" | "centerY" | "bottom";

/** Aligns the selection to its common box, or a single element to the workspace. */
export function alignCommands(config: EffectiveConfig, placements: Map<string, Placement>, ids: string[], mode: AlignMode): EditorCommand[] {
  const items = topLevel(config, ids).filter((id) => placements.has(id));
  if (items.length === 0) return [];
  const ws = config.workspace;
  const target: Box = items.length === 1 ? [0, 0, ws.width, ws.height] : selectionBox(placements, items)!;
  const out: EditorCommand[] = [];
  for (const id of items) {
    const b = worldBox(placements.get(id)!);
    let dx = 0;
    let dy = 0;
    switch (mode) {
      case "left": dx = target[0] - b[0]; break;
      case "centerX": dx = target[0] + target[2] / 2 - (b[0] + b[2] / 2); break;
      case "right": dx = target[0] + target[2] - (b[0] + b[2]); break;
      case "top": dy = target[1] - b[1]; break;
      case "centerY": dy = target[1] + target[3] / 2 - (b[1] + b[3] / 2); break;
      case "bottom": dy = target[1] + target[3] - (b[1] + b[3]); break;
    }
    if (Math.abs(dx) > 1e-9 || Math.abs(dy) > 1e-9) out.push(...moveCommands(config, placements, [id], dx, dy));
  }
  return out;
}

/** Equal gaps between the boxes along an axis (at least three elements). */
export function distributeCommands(config: EffectiveConfig, placements: Map<string, Placement>, ids: string[], axis: "x" | "y"): EditorCommand[] {
  const items = topLevel(config, ids).filter((id) => placements.has(id));
  if (items.length < 3) return [];
  const k = axis === "x" ? 0 : 1;
  const boxes = items.map((id) => ({ id, b: worldBox(placements.get(id)!) })).sort((a, b) => a.b[k] - b.b[k]);
  const start = boxes[0].b[k];
  const end = Math.max(...boxes.map((x) => x.b[k] + x.b[k + 2]));
  const total = boxes.reduce((s, x) => s + x.b[k + 2], 0);
  const gap = (end - start - total) / (boxes.length - 1);
  const out: EditorCommand[] = [];
  let pos = start;
  for (const { id, b } of boxes) {
    const d = pos - b[k];
    if (Math.abs(d) > 1e-9) out.push(...moveCommands(config, placements, [id], axis === "x" ? d : 0, axis === "y" ? d : 0));
    pos += b[k + 2] + gap;
  }
  return out;
}

export type Arrange = "forward" | "backward" | "front" | "back";

/** Layer order inside the common container of the ids. */
export function arrangeCommand(config: EffectiveConfig, ids: string[], how: Arrange): EditorCommand | undefined {
  if (ids.length === 0) return undefined;
  const container = config.elements[ids[0]]?.parent;
  if (container === undefined || ids.some((id) => config.elements[id]?.parent !== container)) return undefined;
  const list = container === ROOT ? config.root : (config.elements[container]?.children ?? []);
  const moving = new Set(ids);
  let order = [...list];
  switch (how) {
    case "front": order = [...list.filter((id) => !moving.has(id)), ...list.filter((id) => moving.has(id))]; break;
    case "back": order = [...list.filter((id) => moving.has(id)), ...list.filter((id) => !moving.has(id))]; break;
    case "forward":
      for (let i = order.length - 2; i >= 0; i--) {
        if (moving.has(order[i]) && !moving.has(order[i + 1])) [order[i], order[i + 1]] = [order[i + 1], order[i]];
      }
      break;
    case "backward":
      for (let i = 1; i < order.length; i++) {
        if (moving.has(order[i]) && !moving.has(order[i - 1])) [order[i], order[i - 1]] = [order[i - 1], order[i]];
      }
      break;
  }
  if (order.every((id, i) => id === list[i])) return undefined;
  return { type: "reorder", container, order };
}

/** Group command for the selection with the pivot at the center of the members' box (README §4). */
export function groupCommand(config: EffectiveConfig, placements: Map<string, Placement>, ids: string[], groupId: string, name?: string): EditorCommand | undefined {
  const items = topLevel(config, ids);
  if (items.length === 0) return undefined;
  const container = config.elements[items[0]]?.parent;
  if (container === undefined || items.some((id) => config.elements[id]?.parent !== container)) return undefined;
  const box = selectionBox(placements, items);
  const parentWorld = placements.get(items[0])?.parentWorld;
  let pivot: Point | undefined;
  if (box && parentWorld) {
    const [x, y] = apply(invert(parentWorld), box[0] + box[2] / 2, box[1] + box[3] / 2);
    pivot = { x, y };
  }
  return { type: "groupElements", ids: items, groupId, name, pivot };
}

/** Copy of effective elements (with variant overrides applied) under new ids, offset by `offset` in parent units. */
export function duplicateCommand(config: EffectiveConfig, ids: string[], taken: Set<string>, offset = 10, random?: () => number): EditorCommand | undefined {
  const items = topLevel(config, ids).filter((id) => config.elements[id]);
  if (items.length === 0) return undefined;
  const container = config.elements[items[0]].parent;
  const elements = dict<OverlayElement>();
  const copy = (id: string): string => {
    const el = config.elements[id];
    const nid = newId("e", taken, random);
    const out: OverlayElement = { type: el.type };
    if (el.name !== undefined) out.name = el.name;
    if (el.disabled) out.disabled = true;
    if (el.lockAspect !== defaultLockAspect(el.type)) out.lockAspect = el.lockAspect;
    if (el.onInvalid !== "hold") out.onInvalid = el.onInvalid;
    if (Object.keys(el.props).length > 0) out.props = structuredClone({ ...el.props });
    if (el.assetId !== undefined) out.assetId = el.assetId;
    if (el.source !== undefined) out.source = el.source;
    if (Object.keys(el.parts).length > 0) out.parts = structuredClone({ ...el.parts });
    if (el.type === "group") out.children = (el.children ?? []).map(copy);
    elements[nid] = out;
    return nid;
  };
  const roots = items.filter((id) => config.elements[id].parent === container).map((id) => {
    const nid = copy(id);
    const el = config.elements[id];
    const props = elements[nid].props ?? {};
    props.x = withBase(el.props.x, round(num(sv(el, "x")) + offset));
    props.y = withBase(el.props.y, round(num(sv(el, "y")) + offset));
    elements[nid].props = props;
    return nid;
  });
  const list = container === ROOT ? config.root : (config.elements[container]?.children ?? []);
  const index = Math.max(...items.map((id) => list.indexOf(id))) + 1;
  return { type: "addElements", elements, roots, container, index };
}

/** Placeholder stream of a picture-in-picture inserted without known streams; the inspector picks the real one. */
export const DEFAULT_VIDEO_STREAM = "camera";

/** Starting element of a type at a workspace point (catalog defaults otherwise). */
export function newElement(type: ElementType, at: Point, defaults: { stream?: string } = {}): OverlayElement {
  const el: OverlayElement = { type, props: { x: round(at.x), y: round(at.y) } };
  if (type === "group") el.children = [];
  if (type === "lidarWidget") el.source = LIDAR_GRID_CHANNEL;
  if (type === "videoStream") el.source = defaults.stream || DEFAULT_VIDEO_STREAM;
  return el;
}

/** Snaps a value to the grid. */
export const snap = (v: number, size: number) => (size > 0 ? Math.round(v / size) * size : v);

/** Applies commands as one undo step. */
export function dispatchAll(store: EditorStore, commands: EditorCommand[], label: string): boolean {
  if (commands.length === 0) return true;
  if (commands.length === 1) return store.dispatch(commands[0], { label }).ok;
  store.beginTransaction(label);
  let ok = true;
  for (const c of commands) ok = store.dispatch(c).ok && ok;
  store.commitTransaction();
  return ok;
}
