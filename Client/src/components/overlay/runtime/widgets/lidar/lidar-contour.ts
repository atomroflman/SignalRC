// LiDAR contour mode (Shared/Overlay/lidar/README.md §6.2, D74): the nearest
// point of every base grid cell, neighbouring cells joined by their spatial distance.
import { LIDAR_CELLS, LIDAR_EMPTY, LIDAR_ZONES } from "../../../sources/lidar-grid";
import type { LidarGrid } from "../../../sources/types";

export const LIDAR_CELL_DEG = 360 / LIDAR_CELLS;
export const DEFAULT_CONTOUR_JOIN_MM = 300;

const COS_CELL = Math.cos((LIDAR_CELL_DEG * Math.PI) / 180);
/** Chord between two cell centres at the same distance, per mm of distance (≈ 0.0654). */
export const CONTOUR_CHORD_FACTOR = 2 * Math.sin((LIDAR_CELL_DEG / 2) * Math.PI / 180);

export interface ContourPoint {
  /** Distance in mm (cm value × 10). */
  mm: number;
  zone: number;
}

/** Nearest point of every cell: the lowest occupied zone (its value is the minimum over the zones). */
export function cellNearest(grid: LidarGrid): (ContourPoint | undefined)[] {
  const out: (ContourPoint | undefined)[] = new Array(LIDAR_CELLS);
  for (let k = 0; k < LIDAR_CELLS; k++) {
    out[k] = undefined;
    for (let z = 0; z < LIDAR_ZONES; z++) {
      const v = grid.cm[k * LIDAR_ZONES + z];
      if (v !== LIDAR_EMPTY) {
        out[k] = { mm: v * 10, zone: z };
        break;
      }
    }
  }
  return out;
}

/** Join rule: s² ≤ (joinMm + CHORD_FACTOR · min(r1, r2))², s = distance of the two points (top view). */
export function contourJoined(r1: number, r2: number, joinMm: number): boolean {
  const s2 = r1 * r1 + r2 * r2 - 2 * r1 * r2 * COS_CELL;
  const limit = joinMm + CONTOUR_CHORD_FACTOR * Math.min(r1, r2);
  return s2 <= limit * limit;
}

/** `joins[k]`: cell k is joined to cell (k + 1) mod 96. */
export function contourJoins(mm: ArrayLike<number | undefined>, joinMm: number): boolean[] {
  const out: boolean[] = new Array(LIDAR_CELLS);
  for (let k = 0; k < LIDAR_CELLS; k++) {
    const a = mm[k];
    const b = mm[(k + 1) % LIDAR_CELLS];
    out[k] = a !== undefined && b !== undefined && contourJoined(a, b, joinMm);
  }
  return out;
}

export interface ContourChain {
  cells: number[];
  closed: boolean;
}

/** Maximal runs of joined cells, ordered by their first cell; a full ring is one closed chain from cell 0. */
export function contourChains(mm: ArrayLike<number | undefined>, joins: readonly boolean[]): ContourChain[] {
  if (joins.every(Boolean)) return [{ cells: Array.from({ length: LIDAR_CELLS }, (_, k) => k), closed: true }];
  const out: ContourChain[] = [];
  for (let k = 0; k < LIDAR_CELLS; k++) {
    if (mm[k] === undefined || joins[(k + LIDAR_CELLS - 1) % LIDAR_CELLS]) continue;
    const cells = [k];
    for (let j = k; joins[j]; j = (j + 1) % LIDAR_CELLS) cells.push((j + 1) % LIDAR_CELLS);
    out.push({ cells, closed: false });
  }
  return out;
}

/** Radius in the widget: linear within the ring of the point's zone (five equally wide rings). */
export function contourRadius(p: ContourPoint, zoneLimitsMm: readonly number[], radius: number): number {
  const lo = p.zone > 0 ? zoneLimitsMm[p.zone - 1] : 0;
  const hi = zoneLimitsMm[p.zone];
  const u = hi > lo ? Math.min(1, Math.max(0, (p.mm - lo) / (hi - lo))) : 1;
  return (radius * (p.zone + u)) / LIDAR_ZONES;
}
