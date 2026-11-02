// Transformations (Shared/Overlay/README.md §4) as affine matrices [a b c d e f].
import { num } from "./vnode";

export type Mat = readonly [number, number, number, number, number, number];
export type Box = readonly [number, number, number, number];

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

export function multiply(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/** translate(x, y) translate(px, py) rotate(r) scale(sx, sy) translate(-px, -py). */
export function elementMatrix(x: number, y: number, rotationDeg: number, sx: number, sy: number, px: number, py: number): Mat {
  const r = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const a = cos * sx;
  const b = sin * sx;
  const c = -sin * sy;
  const d = cos * sy;
  return [a, b, c, d, x + px - a * px - c * py, y + py - b * px - d * py];
}

export function apply(m: Mat, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function matrixAttr(m: Mat): string | undefined {
  if (m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0) return undefined;
  if (m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1) return `translate(${num(m[4])} ${num(m[5])})`;
  return `matrix(${m.map(num).join(" ")})`;
}

/** Bounding box of a box after a transformation. */
export function transformBox(m: Mat, box: Box): Box {
  const pts = [apply(m, box[0], box[1]), apply(m, box[0] + box[2], box[1]), apply(m, box[0], box[1] + box[3]), apply(m, box[0] + box[2], box[1] + box[3])];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  return [x0, y0, Math.max(...xs) - x0, Math.max(...ys) - y0];
}

export function unionBox(a: Box | undefined, b: Box): Box {
  if (!a) return b;
  const x0 = Math.min(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]);
  return [x0, y0, Math.max(a[0] + a[2], b[0] + b[2]) - x0, Math.max(a[1] + a[3], b[1] + b[3]) - y0];
}

/** Point on a circle; 0° is up (12 o'clock), clockwise. */
export function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
}

/** Arc path from `start` to `end` degrees; a full circle for |end − start| ≥ 360. */
export function arcPath(cx: number, cy: number, r: number, start: number, end: number): string {
  const sweep = end - start;
  if (Math.abs(sweep) >= 360) {
    const [x0, y0] = polar(cx, cy, r, 0);
    const [x1, y1] = polar(cx, cy, r, 180);
    return `M${num(x0)} ${num(y0)}A${num(r)} ${num(r)} 0 1 1 ${num(x1)} ${num(y1)}A${num(r)} ${num(r)} 0 1 1 ${num(x0)} ${num(y0)}`;
  }
  const [x0, y0] = polar(cx, cy, r, start);
  const [x1, y1] = polar(cx, cy, r, end);
  return `M${num(x0)} ${num(y0)}A${num(r)} ${num(r)} 0 ${Math.abs(sweep) > 180 ? 1 : 0} ${sweep >= 0 ? 1 : 0} ${num(x1)} ${num(y1)}`;
}

/** Annular sector between radii and angles (angles as in `polar`, end > start, ≤ 180°). */
export function sectorPath(cx: number, cy: number, r0: number, r1: number, start: number, end: number): string {
  const [ox0, oy0] = polar(cx, cy, r1, start);
  const [ox1, oy1] = polar(cx, cy, r1, end);
  const outer = `M${num(ox0)} ${num(oy0)}A${num(r1)} ${num(r1)} 0 0 1 ${num(ox1)} ${num(oy1)}`;
  if (r0 <= 0) return `${outer}L${num(cx)} ${num(cy)}Z`;
  const [ix1, iy1] = polar(cx, cy, r0, end);
  const [ix0, iy0] = polar(cx, cy, r0, start);
  return `${outer}L${num(ix1)} ${num(iy1)}A${num(r0)} ${num(r0)} 0 0 0 ${num(ix0)} ${num(iy0)}Z`;
}
