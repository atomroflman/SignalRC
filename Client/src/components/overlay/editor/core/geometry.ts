// Editor geometry: local boxes, matrices and hit tests on the effective
// configuration (Shared/Overlay/README.md §3, §4). Boxes follow the same rules
// as the runtime scene (runtime/scene.ts localBox) so handles match the picture.
import { propDef } from "../../document/catalog";
import { ROOT, type AssetMetadata, type EffectiveConfig, type EffectiveElement, type ElementType, type PropMap } from "../../document/types";
import { apply, elementMatrix, IDENTITY, multiply, transformBox, unionBox, type Box, type Mat } from "../../runtime/geometry";
import { formatValueText } from "../../runtime/scene";
import type { Locale } from "../../runtime/types";
import type { Point } from "./types";

export type { Box, Mat };
export { apply, multiply, IDENTITY, transformBox, unionBox };

const n = (v: unknown, fallback = 0) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** Static value of a property: literal or `base`, catalog default when absent. */
export function staticValue(type: ElementType, props: PropMap | undefined, name: string, part = false): unknown {
  const v = props?.[name];
  if (v !== undefined) return typeof v === "object" && v !== null ? v.base : v;
  return propDef(type, name, part)?.default;
}

/** All static values the geometry needs (catalog defaults filled in). */
export function staticProps(type: ElementType, props: PropMap | undefined, lockAspect = false): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const name of ["x", "y", "rotation", "scaleX", "scaleY", "pivotX", "pivotY", "width", "height", "x2", "y2", "radius", "text", "fontSize", "align", "prefix", "unit", "decimals", "visible"]) {
    const v = staticValue(type, props, name);
    if (v !== undefined) out[name] = v;
  }
  if (lockAspect) out.scaleY = out.scaleX;
  return out;
}

export interface GeometryContext {
  assets?: Record<string, { metadata?: AssetMetadata; width?: number; height?: number }>;
  locale?: Locale;
}

function textBox(p: Record<string, unknown>, text: string): Box {
  const fs = n(p.fontSize, 24);
  const w = 0.6 * fs * [...text].length;
  const x0 = p.align === "middle" ? -w / 2 : p.align === "end" ? -w : 0;
  return [x0, -0.8 * fs, w, fs];
}

export interface Placement {
  id: string;
  /** Local box of the element. */
  box: Box;
  /** Local → parent coordinates. */
  local: Mat;
  /** Parent → workspace coordinates (including the root transform). */
  parentWorld: Mat;
  /** Local → workspace coordinates. */
  world: Mat;
  /** Pivot in local coordinates. */
  pivot: [number, number];
}

export type PropsOf = (el: EffectiveElement) => Record<string, unknown>;

/** Static values by default; the canvas passes the displayed frame values. */
export const staticPropsOf: PropsOf = (el) => staticProps(el.type, el.props, el.lockAspect);

export function rootMatrix(config: EffectiveConfig): Mat {
  const rt = config.rootTransform;
  return rt ? [rt.scale, 0, 0, rt.scale, rt.offsetX, rt.offsetY] : IDENTITY;
}

/** Placement of every element of the configuration. */
export function layout(config: EffectiveConfig, propsOf: PropsOf = staticPropsOf, ctx: GeometryContext = {}): Map<string, Placement> {
  const result = new Map<string, Placement>();
  const boxes = new Map<string, Box>();
  const boxOf = (id: string): Box => {
    const cached = boxes.get(id);
    if (cached) return cached;
    const el = config.elements[id];
    const box = el ? localBox(el, propsOf(el), ctx, (c) => {
      const ce = config.elements[c];
      if (!ce) return undefined;
      const cp = propsOf(ce);
      const cb = boxOf(c);
      return transformBox(localMatrix(cp, cb), cb);
    }) : ([0, 0, 0, 0] as Box);
    boxes.set(id, box);
    return box;
  };
  const visit = (ids: string[], parentWorld: Mat) => {
    for (const id of ids) {
      const el = config.elements[id];
      if (!el) continue;
      const p = propsOf(el);
      const box = boxOf(id);
      const local = localMatrix(p, box);
      const world = multiply(parentWorld, local);
      result.set(id, { id, box, local, parentWorld, world, pivot: pivotOf(p, box) });
      if (el.type === "group") visit(el.children ?? [], world);
    }
  };
  visit(config.root, rootMatrix(config));
  return result;
}

export function pivotOf(p: Record<string, unknown>, box: Box): [number, number] {
  const px = p.pivotX === "center" || p.pivotX === undefined ? box[0] + box[2] / 2 : n(p.pivotX);
  const py = p.pivotY === "center" || p.pivotY === undefined ? box[1] + box[3] / 2 : n(p.pivotY);
  return [px, py];
}

export function localMatrix(p: Record<string, unknown>, box: Box): Mat {
  const [px, py] = pivotOf(p, box);
  const sx = n(p.scaleX, 1);
  const sy = p.scaleY === undefined ? sx : n(p.scaleY, 1);
  return elementMatrix(n(p.x), n(p.y), n(p.rotation), sx, sy, px, py);
}

export function localBox(
  el: Pick<EffectiveElement, "type" | "assetId" | "children">,
  p: Record<string, unknown>,
  ctx: GeometryContext,
  childBox?: (id: string) => Box | undefined,
): Box {
  switch (el.type) {
    case "rect": case "ellipse": case "linearGauge":
      return [0, 0, n(p.width), n(p.height)];
    case "line": {
      const x2 = n(p.x2);
      const y2 = n(p.y2);
      return [Math.min(0, x2), Math.min(0, y2), Math.abs(x2), Math.abs(y2)];
    }
    case "arc": case "radialGauge": case "lidarWidget":
      return [0, 0, 2 * n(p.radius), 2 * n(p.radius)];
    case "text":
      return textBox(p, String(p.text ?? ""));
    case "valueText":
      return textBox(p, formatValueText(p, p.value === undefined || p.value === null, ctx.locale ?? "de"));
    case "svgAsset": {
      const a = el.assetId ? ctx.assets?.[el.assetId] : undefined;
      const w = a?.metadata?.width ?? a?.width;
      const h = a?.metadata?.height ?? a?.height;
      return w !== undefined && h !== undefined ? [0, 0, w, h] : [0, 0, 0, 0];
    }
    case "group": {
      let box: Box | undefined;
      for (const c of el.children ?? []) {
        const cb = childBox?.(c);
        if (cb) box = unionBox(box, cb);
      }
      return box ?? [0, 0, 0, 0];
    }
  }
}

export function invert(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) return IDENTITY;
  const a = m[3] / det;
  const b = -m[1] / det;
  const c = -m[2] / det;
  const d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

/** Axis-aligned workspace box of an element. */
export function worldBox(p: Placement): Box {
  return transformBox(p.world, p.box);
}

/** Corners of the element box in workspace coordinates (tl, tr, br, bl). */
export function worldCorners(p: Placement): Point[] {
  const [x, y, w, h] = p.box;
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([cx, cy]) => {
    const [wx, wy] = apply(p.world, cx, cy);
    return { x: wx, y: wy };
  });
}

/** Minimum hit size in workspace units so lines and empty groups stay clickable. */
function contains(p: Placement, point: Point, tolerance: number): boolean {
  const [lx, ly] = apply(invert(p.world), point.x, point.y);
  const scale = Math.max(1e-6, Math.hypot(p.world[0], p.world[1]));
  const t = tolerance / scale;
  const [x, y, w, h] = p.box;
  return lx >= x - t && lx <= x + w + t && ly >= y - t && ly <= y + h + t;
}

export interface HitOptions {
  /** Skip locked elements (D47). Default true. */
  skipLocked?: boolean;
  /** Tolerance in workspace units. */
  tolerance?: number;
}

/**
 * Topmost leaf under the point, skipping disabled, editor-hidden and (by
 * default) locked elements. Returns the path from the top-level element down.
 */
export function hitTest(config: EffectiveConfig, placements: Map<string, Placement>, point: Point, options: HitOptions = {}): string[] | undefined {
  const skipLocked = options.skipLocked ?? true;
  const tolerance = options.tolerance ?? 2;
  const visit = (ids: string[], path: string[]): string[] | undefined => {
    for (let i = ids.length - 1; i >= 0; i--) {
      const el = config.elements[ids[i]];
      const p = placements.get(ids[i]);
      if (!el || !p || el.effectiveDisabled || el.editorHidden) continue;
      if (skipLocked && el.locked) continue;
      if (el.type === "group") {
        const inner = visit(el.children ?? [], [...path, el.id]);
        if (inner) return inner;
        continue;
      }
      if (contains(p, point, tolerance)) return [...path, el.id];
    }
    return undefined;
  };
  return visit(config.root, []);
}

/** Elements whose workspace box intersects the marquee rectangle, at the given level. */
export function marqueeSelect(config: EffectiveConfig, placements: Map<string, Placement>, rect: Box, container: string = ROOT): string[] {
  const ids = container === ROOT ? config.root : (config.elements[container]?.children ?? []);
  return ids.filter((id) => {
    const el = config.elements[id];
    const p = placements.get(id);
    if (!el || !p || el.effectiveDisabled || el.editorHidden || el.locked) return false;
    const b = worldBox(p);
    return b[0] < rect[0] + rect[2] && b[0] + b[2] > rect[0] && b[1] < rect[1] + rect[3] && b[1] + b[3] > rect[1];
  });
}

/** Union of the workspace boxes. */
export function selectionBox(placements: Map<string, Placement>, ids: string[]): Box | undefined {
  let box: Box | undefined;
  for (const id of ids) {
    const p = placements.get(id);
    if (p) box = unionBox(box, worldBox(p));
  }
  return box;
}

export interface Decomposed {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  /** The matrix contains a shear that x/y/rotation/scale cannot express. */
  skewed: boolean;
}

/** x, y, rotation, scale for `m` (local → parent) with the given pivot; rotation closest to `near`. */
export function decompose(m: Mat, pivot: [number, number], near = 0): Decomposed {
  const [a, b, c, d, e, f] = m;
  const sx = Math.hypot(a, b);
  let rotation = (Math.atan2(b, a) * 180) / Math.PI;
  rotation += 360 * Math.round((near - rotation) / 360);
  const sy = sx > 1e-12 ? (a * d - b * c) / sx : Math.hypot(c, d);
  const r = (rotation * Math.PI) / 180;
  const skewed = Math.abs(c - -Math.sin(r) * sy) > 1e-6 || Math.abs(d - Math.cos(r) * sy) > 1e-6;
  const [px, py] = pivot;
  return { x: e - px + a * px + c * py, y: f - py + b * px + d * py, rotation, scaleX: sx, scaleY: sy, skewed };
}

/** Rounds to 1/1000 workspace units to keep documents readable. */
export const round = (v: number, digits = 3) => {
  const f = 10 ** digits;
  const r = Math.round(v * f) / f;
  return Object.is(r, -0) ? 0 : r;
};
