// LiDAR widget core (Shared/Overlay/lidar/README.md §6, Overlay-Feature.md
// "LiDAR-Raster und Abstandsanzeige"): sectors from the 96-cell base grid,
// continuous distance colors, distance-dependent pulsing and afterglow; or the
// contour of the nearest points (§6.2, D74).
import { DEFAULT_ZONE_LIMITS_MM, LIDAR_CELLS, LIDAR_EMPTY, LIDAR_ZONES } from "../../../sources/lidar-grid";
import type { LidarGrid, LidarGridValue } from "../../../sources/types";
import { mixColor } from "../../values";
import type { LidarContourCell, LidarContourFrame, LidarFieldFrame, LidarFrame, Marker } from "../../types";
import { cellNearest, contourJoins, DEFAULT_CONTOUR_JOIN_MM } from "./lidar-contour";

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

export type LidarDisplay = "sectors" | "contour";

export interface LidarWidgetOptions {
  /** Default "sectors". */
  display?: LidarDisplay;
  /** Contour mode: join tolerance in mm (lidar §6.2). */
  contourJoinMm?: number;
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

interface CellState extends FieldState {
  zone: number;
}

/** Shown fields keep pulsing; a vanished occupation glows for `afterglowS`, then the field is cleared. */
function advance(f: FieldState, t: number, dt: number, occupied: boolean, o: LidarWidgetOptions): void {
  if (f.distanceM !== undefined) f.phase = (f.phase + blinkHz(f.distanceM, o) * dt) % 1;
  if (!occupied && f.distanceM !== undefined) {
    if (f.glowUntil === undefined) f.glowUntil = t + o.afterglowS;
    if (t >= f.glowUntil) {
      f.distanceM = undefined;
      f.glowUntil = undefined;
    }
  }
}

export interface LidarStep {
  frame: LidarFrame;
  marker?: Marker;
}

const EMPTY_CONTOUR: LidarContourFrame = { cells: [], opacity: [] };

/** Per-widget state of one display session. */
export class LidarWidgetState {
  private fields: FieldState[] = [];
  private sectors = 0;
  private display: LidarDisplay = "sectors";
  private start: number | undefined;
  private lastT: number | undefined;
  private fresh = true;
  private held: LidarFieldFrame[] | undefined;
  // Contour mode: one state per base grid cell; the cell list is rebuilt only for a
  // new grid, an expired afterglow or changed options.
  private cells: CellState[] = [];
  private contourGrid: LidarGrid | undefined;
  private contourKey = "";
  private contourCells: readonly LidarContourCell[] = [];
  private heldContour: LidarContourFrame | undefined;

  reset() {
    this.fields = [];
    this.start = undefined;
    this.lastT = undefined;
    this.fresh = true;
    this.held = undefined;
    this.heldContour = undefined;
  }

  /** Design mode and missing sources: all fields idle. */
  idle(o: LidarWidgetOptions, zoneLimitsMm = DEFAULT_ZONE_LIMITS_MM): LidarFrame {
    return this.frameOf(o, this.idleFields(o), EMPTY_CONTOUR, zoneLimitsMm);
  }

  step(t: number, value: LidarGridValue, o: LidarWidgetOptions): LidarStep {
    if (this.start === undefined) this.start = t;
    const dt = this.lastT === undefined ? 0 : Math.max(0, t - this.lastT);
    this.lastT = t;
    const zoneLimitsMm = value.zoneLimitsMm ?? DEFAULT_ZONE_LIMITS_MM;
    const display = o.display ?? "sectors";
    if (value.state === "invalid" || !value.grid) {
      // Invalid source: last valid display frozen (no pulse, no sweep, no afterglow), or idle.
      this.fresh = true;
      const same = display === this.display;
      const fields = (same && this.held) || this.idleFields(o);
      const contour = (same && this.heldContour) || EMPTY_CONTOUR;
      return { frame: this.frameOf(o, fields, contour, zoneLimitsMm), marker: "invalid" };
    }
    if (this.fresh || this.sectors !== o.sectors || this.display !== display) {
      // Fresh start after invalid data (D14): nothing carries over.
      this.fields = Array.from({ length: o.sectors * LIDAR_ZONES }, () => ({ phase: 0 }));
      this.cells = Array.from({ length: LIDAR_CELLS }, () => ({ phase: 0, zone: 0 }));
      this.contourGrid = undefined;
      this.contourCells = [];
      this.sectors = o.sectors;
      this.display = display;
      this.fresh = false;
    }
    let frame: LidarFrame;
    if (display === "contour") {
      const contour = this.contourStep(t, dt, value.grid, o);
      this.heldContour = { cells: contour.cells, opacity: contour.cells.map(() => 1) };
      frame = this.frameOf(o, [], contour, zoneLimitsMm);
    } else {
      const fields = this.sectorStep(t, dt, value.grid, o);
      this.held = fields.map((f) => ({ ...f, opacity: 1 }));
      frame = this.frameOf(o, fields, undefined, zoneLimitsMm);
    }
    if (o.sweepEnabled && o.sweepPeriodS > 0) {
      const u = (t - this.start) / o.sweepPeriodS;
      frame.sweepDeg = 360 * (u - Math.floor(u));
    }
    const marker: Marker | undefined = value.state === "unchecked" || !value.grid.complete ? "unchecked" : undefined;
    return marker ? { frame, marker } : { frame };
  }

  private frameOf(o: LidarWidgetOptions, fields: LidarFieldFrame[], contour: LidarContourFrame | undefined, zoneLimitsMm: number[]): LidarFrame {
    if (o.display === "contour") return { sectors: o.sectors, fields: [], contour: contour ?? EMPTY_CONTOUR, zoneLimitsMm };
    return { sectors: o.sectors, fields, zoneLimitsMm };
  }

  private sectorStep(t: number, dt: number, grid: LidarGrid, o: LidarWidgetOptions): LidarFieldFrame[] {
    const cm = sectorDistancesCm(grid, o.sectors);
    const fields: LidarFieldFrame[] = [];
    for (let i = 0; i < cm.length; i++) {
      const f = this.fields[i];
      const occupied = cm[i] !== LIDAR_EMPTY;
      advance(f, t, dt, occupied, o);
      if (occupied) {
        // A new occupation appears at once at full opacity.
        if (f.distanceM === undefined) f.phase = 0;
        f.distanceM = cm[i] / 100;
        f.glowUntil = undefined;
      }
      if (f.distanceM === undefined) {
        fields.push({ color: o.idleColor, opacity: 1 });
        continue;
      }
      fields.push({ distanceM: f.distanceM, color: distanceColor(f.distanceM, o), opacity: pulseOpacity(f.phase, o.minPulseOpacity) });
    }
    return fields;
  }

  private contourStep(t: number, dt: number, grid: LidarGrid, o: LidarWidgetOptions): LidarContourFrame {
    const joinMm = o.contourJoinMm ?? DEFAULT_CONTOUR_JOIN_MM;
    const nearest = grid !== this.contourGrid ? cellNearest(grid) : undefined;
    this.contourGrid = grid;
    let changed = false;
    for (let k = 0; k < LIDAR_CELLS; k++) {
      const c = this.cells[k];
      const shown = c.distanceM !== undefined;
      const p = nearest?.[k];
      // Without a new grid the occupation is unchanged: a shown cell is occupied unless it glows.
      advance(c, t, dt, nearest ? p !== undefined : c.glowUntil === undefined, o);
      if (p) {
        const d = p.mm / 1000;
        if (c.distanceM === undefined) c.phase = 0;
        if (c.distanceM !== d || c.zone !== p.zone) changed = true;
        c.distanceM = d;
        c.zone = p.zone;
        c.glowUntil = undefined;
      } else if (shown !== (c.distanceM !== undefined)) {
        changed = true;
      }
    }
    const key = `${joinMm}|${o.nearDistanceM}|${o.farDistanceM}|${o.nearColor}|${o.midColor}|${o.farColor}`;
    if (changed || key !== this.contourKey) {
      this.contourKey = key;
      const mm = this.cells.map((c) => (c.distanceM === undefined ? undefined : c.distanceM * 1000));
      const joins = contourJoins(mm, joinMm);
      const cells: LidarContourCell[] = [];
      for (let k = 0; k < LIDAR_CELLS; k++) {
        const c = this.cells[k];
        if (c.distanceM === undefined) continue;
        cells.push({
          cell: k, distanceM: c.distanceM, zone: c.zone, color: distanceColor(c.distanceM, o),
          joinPrev: joins[(k + LIDAR_CELLS - 1) % LIDAR_CELLS], joinNext: joins[k],
        });
      }
      this.contourCells = cells;
    }
    return { cells: this.contourCells, opacity: this.contourCells.map((c) => pulseOpacity(this.cells[c.cell].phase, o.minPulseOpacity)) };
  }

  private idleFields(o: LidarWidgetOptions): LidarFieldFrame[] {
    return Array.from({ length: o.sectors * LIDAR_ZONES }, () => ({ color: o.idleColor, opacity: 1 }));
  }
}
