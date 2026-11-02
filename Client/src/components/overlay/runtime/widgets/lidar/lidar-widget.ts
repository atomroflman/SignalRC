// LiDAR widget core (Shared/Overlay/lidar/README.md §6, Overlay-Feature.md
// "LiDAR-Raster und Abstandsanzeige"): sectors from the 96-cell base grid,
// continuous distance colors, distance-dependent pulsing and afterglow.
import { DEFAULT_ZONE_LIMITS_MM, LIDAR_CELLS, LIDAR_EMPTY, LIDAR_ZONES } from "../../../sources/lidar-grid";
import type { LidarGrid, LidarGridValue } from "../../../sources/types";
import { mixColor } from "../../values";
import type { LidarFieldFrame, LidarFrame, Marker } from "../../types";

export const LIDAR_SECTOR_COUNTS = [4, 6, 8, 12, 16, 24] as const;
export const DEFAULT_SECTORS = 8;

/** Base grid cells of every sector; sector 0 is centred on the front, clockwise. */
export function sectorCells(sectors: number): number[][] {
  const c = LIDAR_CELLS / sectors;
  const out: number[][] = [];
  for (let j = 0; j < sectors; j++) {
    const k0 = (((j * c - c / 2) % LIDAR_CELLS) + LIDAR_CELLS) % LIDAR_CELLS;
    out.push(Array.from({ length: c }, (_, i) => (k0 + i) % LIDAR_CELLS));
  }
  return out;
}

const cellCache = new Map<number, number[][]>();

/** Field [j][z] at `j * 5 + z`: minimum of the sector's cells in zone z, in cm; 0xFFFF = empty. */
export function sectorDistancesCm(grid: LidarGrid, sectors: number): Uint16Array {
  let cells = cellCache.get(sectors);
  if (!cells) cellCache.set(sectors, (cells = sectorCells(sectors)));
  const out = new Uint16Array(sectors * LIDAR_ZONES).fill(LIDAR_EMPTY);
  for (let j = 0; j < sectors; j++) {
    for (const k of cells[j]) {
      for (let z = 0; z < LIDAR_ZONES; z++) {
        const v = grid.cm[k * LIDAR_ZONES + z];
        if (v < out[j * LIDAR_ZONES + z]) out[j * LIDAR_ZONES + z] = v;
      }
    }
  }
  return out;
}

export interface LidarWidgetOptions {
  sectors: number;
  nearDistanceM: number;
  farDistanceM: number;
  nearColor: string;
  midColor: string;
  farColor: string;
  idleColor: string;
  blinkNearHz: number;
  blinkFarHz: number;
  minPulseOpacity: number;
  afterglowS: number;
  sweepEnabled: boolean;
  sweepPeriodS: number;
}

/** Position on the scale: 0 at or inside the near zone, 1 at or beyond the far distance. */
function scale(d: number, o: LidarWidgetOptions): number {
  const span = o.farDistanceM - o.nearDistanceM;
  if (!(span > 0)) return d <= o.nearDistanceM ? 0 : 1;
  return Math.min(1, Math.max(0, (d - o.nearDistanceM) / span));
}

/** Continuous far → mid → near color over the whole grid (never less red when closer). */
export function distanceColor(d: number, o: LidarWidgetOptions): string {
  const u = scale(d, o);
  return u <= 0.5 ? mixColor(o.nearColor, o.midColor, u * 2) : mixColor(o.midColor, o.farColor, (u - 0.5) * 2);
}

/** Blink frequency: near Hz at the near distance and closer, far Hz at the far distance, linear between. */
export function blinkHz(d: number, o: LidarWidgetOptions): number {
  const u = scale(d, o);
  return o.blinkNearHz + (o.blinkFarHz - o.blinkNearHz) * u;
}

export function pulseOpacity(phase: number, minOpacity: number): number {
  return minOpacity + (1 - minOpacity) * (0.5 + 0.5 * Math.cos(2 * Math.PI * phase));
}

interface FieldState {
  distanceM?: number;
  phase: number;
  /** Set when the occupation vanished: the field glows until then. */
  glowUntil?: number;
}

export interface LidarStep {
  frame: LidarFrame;
  marker?: Marker;
}

/** Per-widget state of one display session. */
export class LidarWidgetState {
  private fields: FieldState[] = [];
  private sectors = 0;
  private start: number | undefined;
  private lastT: number | undefined;
  private fresh = true;
  private held: LidarFieldFrame[] | undefined;

  reset() {
    this.fields = [];
    this.start = undefined;
    this.lastT = undefined;
    this.fresh = true;
    this.held = undefined;
  }

  /** Design mode and missing sources: all fields idle. */
  idle(o: LidarWidgetOptions, zoneLimitsMm = DEFAULT_ZONE_LIMITS_MM): LidarFrame {
    return { sectors: o.sectors, fields: this.idleFields(o), zoneLimitsMm };
  }

  step(t: number, value: LidarGridValue, o: LidarWidgetOptions): LidarStep {
    if (this.start === undefined) this.start = t;
    const dt = this.lastT === undefined ? 0 : Math.max(0, t - this.lastT);
    this.lastT = t;
    const zoneLimitsMm = value.zoneLimitsMm ?? DEFAULT_ZONE_LIMITS_MM;
    if (value.state === "invalid" || !value.grid) {
      // Invalid source: last valid display frozen (no pulse, no sweep, no afterglow), or idle.
      this.fresh = true;
      return { frame: { sectors: o.sectors, fields: this.held ?? this.idleFields(o), zoneLimitsMm }, marker: "invalid" };
    }
    if (this.fresh || this.sectors !== o.sectors) {
      // Fresh start after invalid data (D14): nothing carries over.
      this.fields = Array.from({ length: o.sectors * LIDAR_ZONES }, () => ({ phase: 0 }));
      this.sectors = o.sectors;
      this.fresh = false;
    }
    const cm = sectorDistancesCm(value.grid, o.sectors);
    const fields: LidarFieldFrame[] = [];
    for (let i = 0; i < cm.length; i++) {
      const f = this.fields[i];
      if (cm[i] !== LIDAR_EMPTY) {
        // New occupation appears at once at full opacity.
        if (f.distanceM === undefined) f.phase = 0;
        f.distanceM = cm[i] / 100;
        f.glowUntil = undefined;
      } else if (f.distanceM !== undefined) {
        if (f.glowUntil === undefined) f.glowUntil = t + o.afterglowS;
        if (t >= f.glowUntil) {
          f.distanceM = undefined;
          f.glowUntil = undefined;
        }
      }
      if (f.distanceM === undefined) {
        fields.push({ color: o.idleColor, opacity: 1 });
        continue;
      }
      const shown = { distanceM: f.distanceM, color: distanceColor(f.distanceM, o), opacity: pulseOpacity(f.phase, o.minPulseOpacity) };
      f.phase = (f.phase + blinkHz(f.distanceM, o) * dt) % 1;
      fields.push(shown);
    }
    this.held = fields.map((f) => ({ ...f, opacity: 1 }));
    const frame: LidarFrame = { sectors: o.sectors, fields, zoneLimitsMm };
    if (o.sweepEnabled && o.sweepPeriodS > 0) {
      const u = (t - this.start) / o.sweepPeriodS;
      frame.sweepDeg = 360 * (u - Math.floor(u));
    }
    const marker: Marker | undefined = value.state === "unchecked" || !value.grid.complete ? "unchecked" : undefined;
    return marker ? { frame, marker } : { frame };
  }

  private idleFields(o: LidarWidgetOptions): LidarFieldFrame[] {
    return Array.from({ length: o.sectors * LIDAR_ZONES }, () => ({ color: o.idleColor, opacity: 1 }));
  }
}
