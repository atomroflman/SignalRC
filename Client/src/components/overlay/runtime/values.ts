// Value helpers of the runtime contract (Shared/Overlay/runtime/README.md §4–§6):
// colors, easing, angle wrap and keyframe sampling.
import type { Keyframe } from "../document/types";

export const COLOR = /^(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|none)$/;

export type Rgba = [number, number, number, number];

/** Parses #rrggbb / #rrggbbaa; undefined for `none` or anything else. */
export function parseColor(text: string): Rgba | undefined {
  if (!/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(text)) return undefined;
  const n = (i: number) => parseInt(text.slice(i, i + 2), 16);
  return [n(1), n(3), n(5), text.length === 9 ? n(7) : 255];
}

const hex2 = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");

export function formatColor(c: Rgba): string {
  return `#${hex2(c[0])}${hex2(c[1])}${hex2(c[2])}${hex2(c[3])}`;
}

/** Per RGBA channel (0–255) linear, rounded; `none` is not interpolated. */
export function mixColor(a: string, b: string, u: number): string {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return u < 1 ? a : b;
  return formatColor([0, 1, 2, 3].map((i) => Math.round(ca[i] + (cb[i] - ca[i]) * u)) as Rgba);
}

/** Wraps a difference to [-180, 180) (shortest angular path). */
export function wrapAngleDelta(d: number): number {
  return ((((d + 180) % 360) + 360) % 360) - 180;
}

/** min + mod(v − min, max − min), result in [min, max). */
export function wrapRange(v: number, min: number, max: number): number {
  const span = max - min;
  const r = (v - min) % span;
  return min + (r < 0 ? r + span : r);
}

// --- Easing (cubic-bezier as in CSS) ---

function bezier(x1: number, y1: number, x2: number, y2: number): (u: number) => number {
  const coord = (s: number, p1: number, p2: number) => 3 * (1 - s) * (1 - s) * s * p1 + 3 * (1 - s) * s * s * p2 + s * s * s;
  return (u) => {
    if (u <= 0) return 0;
    if (u >= 1) return 1;
    // x(s) is monotonic for x1, x2 in [0, 1]: bisection is exact enough and branch-free of NaN.
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (coord(mid, x1, x2) < u) lo = mid;
      else hi = mid;
    }
    return coord((lo + hi) / 2, y1, y2);
  };
}

export type Easing = NonNullable<Keyframe["easing"]>;

const EASINGS: Record<Exclude<Easing, "step">, (u: number) => number> = {
  linear: (u) => u,
  easeIn: bezier(0.42, 0, 1, 1),
  easeOut: bezier(0, 0, 0.58, 1),
  easeInOut: bezier(0.42, 0, 0.58, 1),
};

export type Interpolation = "linear" | "linearRgba" | "step";

/**
 * Track value at local time τ: before the first keyframe its value, after the
 * last the last one; in between the segment [k_i, k_i+1] with the easing of k_i.
 */
export function sampleKeyframes(keyframes: Keyframe[], tau: number, interpolation: Interpolation): unknown {
  if (keyframes.length === 0) return undefined;
  if (tau <= keyframes[0].t) return keyframes[0].value;
  const last = keyframes[keyframes.length - 1];
  if (tau >= last.t) return last.value;
  let i = 0;
  while (i < keyframes.length - 2 && keyframes[i + 1].t <= tau) i++;
  const a = keyframes[i];
  const b = keyframes[i + 1];
  const easing = a.easing ?? "linear";
  if (interpolation === "step" || easing === "step") return a.value;
  const u = EASINGS[easing]((tau - a.t) / (b.t - a.t));
  if (interpolation === "linearRgba") return mixColor(String(a.value), String(b.value), u);
  if (typeof a.value !== "number" || typeof b.value !== "number") return a.value;
  return a.value + (b.value - a.value) * u;
}

/** Commercial rounding: 0.5 away from zero. */
export function roundHalfAway(x: number): number {
  const a = Math.floor(Math.abs(x) + 0.5);
  return x < 0 ? -a : a;
}
