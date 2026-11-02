// Decoder of the LiDAR base grid sample value (Shared/Overlay/lidar/README.md §4, §5).
import type { LidarGrid } from "./types";

export const LIDAR_CELLS = 96;
export const LIDAR_ZONES = 5;
export const LIDAR_FIELDS = LIDAR_CELLS * LIDAR_ZONES;
export const LIDAR_EMPTY = 0xffff;
export const DEFAULT_ZONE_LIMITS_MM = [500, 1000, 2000, 3000, 5000];

/** Standard Base64 with padding (the caller has checked the alphabet). */
function decodeBase64(text: string): Uint8Array | undefined {
  if (text.length % 4 !== 0) return undefined;
  try {
    const bin = atob(text);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return undefined;
  }
}

/**
 * Decodes `<version><complete><encoding>:<base64>`. Returns undefined for
 * anything that does not match the contract exactly (parse error).
 */
export function decodeLidarGrid(value: string): LidarGrid | undefined {
  const m = /^1([01])([ds]):([A-Za-z0-9+/]*={0,2})$/.exec(value);
  if (!m) return undefined;
  const bytes = decodeBase64(m[3]);
  if (!bytes) return undefined;
  const cm = new Uint16Array(LIDAR_FIELDS).fill(LIDAR_EMPTY);
  const u16 = (i: number) => bytes[i] | (bytes[i + 1] << 8);
  if (m[2] === "d") {
    if (bytes.length !== LIDAR_FIELDS * 2) return undefined;
    for (let i = 0; i < LIDAR_FIELDS; i++) cm[i] = u16(i * 2);
  } else {
    if (bytes.length % 4 !== 0) return undefined;
    let prev = -1;
    for (let i = 0; i < bytes.length; i += 4) {
      const index = u16(i);
      if (index >= LIDAR_FIELDS || index <= prev) return undefined;
      cm[index] = u16(i + 2);
      prev = index;
    }
  }
  return { version: 1, complete: m[1] === "1", cm };
}

/** Field value of a cell and zone in cm, or undefined when empty. */
export function lidarField(grid: LidarGrid, cell: number, zone: number): number | undefined {
  const v = grid.cm[cell * LIDAR_ZONES + zone];
  return v === LIDAR_EMPTY ? undefined : v;
}
