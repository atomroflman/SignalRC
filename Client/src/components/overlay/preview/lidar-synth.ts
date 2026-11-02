// Synthetic LiDAR base grids in the wire format of the contract
// (Shared/Overlay/lidar/README.md §4, §5) for raster and warning checks.
import { DEFAULT_ZONE_LIMITS_MM, LIDAR_CELLS, LIDAR_EMPTY, LIDAR_FIELDS, LIDAR_ZONES } from "../sources/lidar-grid";
import type { LidarObstacle } from "./types";

const CELL_DEG = 360 / LIDAR_CELLS;
/** Sparse while at most 239 fields are occupied (LiDAR §5). */
const SPARSE_MAX = 239;

const wrap360 = (a: number) => ((a % 360) + 360) % 360;

/** Zone index of a distance (LiDAR §4), or -1 beyond the last limit. */
export function zoneOf(distanceMm: number, zoneLimitsMm: number[] = DEFAULT_ZONE_LIMITS_MM): number {
  if (!(distanceMm > 0)) return -1;
  return zoneLimitsMm.findIndex((l) => distanceMm <= l);
}

/** Field values in cm (index `cell * 5 + zone`, 0xFFFF = empty) at time t. */
export function synthLidarCells(
  obstacles: LidarObstacle[],
  t: number,
  options: { rotateDegPerS?: number; zoneLimitsMm?: number[] } = {},
): Uint16Array {
  const cm = new Uint16Array(LIDAR_FIELDS).fill(LIDAR_EMPTY);
  const rotation = (options.rotateDegPerS ?? 0) * t;
  for (const o of obstacles) {
    const swing = o.swingMm && o.periodS && o.periodS > 0 ? o.swingMm * Math.sin((2 * Math.PI * t) / o.periodS) : 0;
    const mm = o.distanceMm + swing;
    const zone = zoneOf(mm, options.zoneLimitsMm);
    if (zone < 0) continue;
    const value = Math.floor((mm + 5) / 10);
    const start = wrap360(o.angleDeg + rotation - Math.max(0, o.widthDeg) / 2);
    const count = Math.max(1, Math.min(LIDAR_CELLS, Math.ceil(Math.max(0, o.widthDeg) / CELL_DEG)));
    const k0 = Math.floor(start / CELL_DEG) % LIDAR_CELLS;
    for (let i = 0; i < count; i++) {
      const f = ((k0 + i) % LIDAR_CELLS) * LIDAR_ZONES + zone;
      if (value < cm[f]) cm[f] = value;
    }
  }
  return cm;
}

function base64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** Encodes `<version><complete><encoding>:<base64>` with the contract's sparse/dense choice. */
export function encodeLidarGrid(cm: Uint16Array, complete = true): string {
  const occupied: number[] = [];
  for (let i = 0; i < LIDAR_FIELDS; i++) if (cm[i] !== LIDAR_EMPTY) occupied.push(i);
  const head = `1${complete ? 1 : 0}`;
  if (occupied.length <= SPARSE_MAX) {
    const bytes = new Uint8Array(occupied.length * 4);
    occupied.forEach((index, n) => {
      bytes[n * 4] = index & 0xff;
      bytes[n * 4 + 1] = index >> 8;
      bytes[n * 4 + 2] = cm[index] & 0xff;
      bytes[n * 4 + 3] = cm[index] >> 8;
    });
    return `${head}s:${base64(bytes)}`;
  }
  const bytes = new Uint8Array(LIDAR_FIELDS * 2);
  for (let i = 0; i < LIDAR_FIELDS; i++) {
    bytes[i * 2] = cm[i] & 0xff;
    bytes[i * 2 + 1] = cm[i] >> 8;
  }
  return `${head}d:${base64(bytes)}`;
}

/** Default test scene: one obstacle ahead in the near zone and one to the right. */
export const DEFAULT_LIDAR_OBSTACLES: LidarObstacle[] = [
  { angleDeg: 0, widthDeg: 15, distanceMm: 800, swingMm: 400, periodS: 6 },
  { angleDeg: 90, widthDeg: 30, distanceMm: 2500 },
];
