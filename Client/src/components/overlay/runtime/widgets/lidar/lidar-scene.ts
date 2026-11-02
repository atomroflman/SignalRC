// LiDAR widget drawing: S sectors × five equally wide labelled rings, front up;
// in contour mode the nearest points over the bare rings (lidar §6.2).
import { formatDecimal } from "../../../expression";
import { polar, sectorPath } from "../../geometry";
import type { LidarContourCell, LidarFrame, Locale } from "../../types";
import { h, num, type VNode } from "../../vnode";
import { contourRadius, LIDAR_CELL_DEG } from "./lidar-contour";

const ZONES = 5;
const geometryCache = new Map<string, string[]>();

/** Field outlines at `sector * 5 + zone`; geometry is static per radius and sector count. */
function fieldPaths(r: number, sectors: number): string[] {
  const key = `${r}:${sectors}`;
  let paths = geometryCache.get(key);
  if (paths) return paths;
  paths = [];
  const w = 360 / sectors;
  for (let j = 0; j < sectors; j++) {
    for (let z = 0; z < ZONES; z++) paths.push(sectorPath(r, r, (z * r) / ZONES, ((z + 1) * r) / ZONES, j * w - w / 2, j * w + w / 2));
  }
  if (geometryCache.size > 64) geometryCache.clear();
  geometryCache.set(key, paths);
  return paths;
}

function meters(mm: number, locale: Locale): string {
  const text = formatDecimal(mm / 1000, 2).replace(/\.?0+$/, "");
  return locale === "de" ? text.replace(".", ",") : text;
}

interface ContourGeometry {
  key: string;
  /** Per cell: the contour piece and its shadow towards the outer ring. */
  lines: string[];
  shadows: string[];
}

const contourCache = new WeakMap<readonly LidarContourCell[], ContourGeometry>();

const pt = (r: number, rho: number, deg: number) => {
  const [x, y] = polar(r, r, rho, deg);
  return `${num(x)} ${num(y)}`;
};

/**
 * Piece of cell k: from the cell's start border over the cell centre to its end
 * border. At a join the border point lies at the mean radius of both cells, so
 * joined pieces meet; at a chain end it lies at the cell's own radius (arc).
 */
function contourGeometry(r: number, zoneLimitsMm: number[], cells: readonly LidarContourCell[]): ContourGeometry {
  const key = `${r}:${zoneLimitsMm.join(",")}`;
  const cached = contourCache.get(cells);
  if (cached?.key === key) return cached;
  const rho = new Map<number, number>();
  for (const c of cells) rho.set(c.cell, contourRadius({ mm: c.distanceM * 1000, zone: c.zone }, zoneLimitsMm, r));
  const lines: string[] = [];
  const shadows: string[] = [];
  for (const c of cells) {
    const own = rho.get(c.cell)!;
    const prev = c.joinPrev ? (own + rho.get((c.cell + 95) % 96)!) / 2 : own;
    const next = c.joinNext ? (own + rho.get((c.cell + 1) % 96)!) / 2 : own;
    const a0 = c.cell * LIDAR_CELL_DEG;
    const a1 = a0 + LIDAR_CELL_DEG;
    const line = `M${pt(r, prev, a0)}L${pt(r, own, a0 + LIDAR_CELL_DEG / 2)}L${pt(r, next, a1)}`;
    lines.push(line);
    shadows.push(`${line}L${pt(r, r, a1)}A${num(r)} ${num(r)} 0 0 0 ${pt(r, r, a0)}Z`);
  }
  const geometry = { key, lines, shadows };
  contourCache.set(cells, geometry);
  return geometry;
}

export interface LidarSceneProps {
  radius: number;
  showLabels: boolean;
  labelColor: string;
  sweepEnabled: boolean;
  sweepColor: string;
  idleColor?: string;
  contourWidth?: number;
  contourShadow?: boolean;
  contourShadowOpacity?: number;
}

function contourNodes(p: LidarSceneProps, r: number, frame: LidarFrame): VNode[] {
  const contour = frame.contour!;
  const outline = Math.max(0.5, r / 160);
  const rings = Array.from({ length: ZONES }, (_, z) =>
    h("circle", { cx: r, cy: r, r: ((z + 1) * r) / ZONES, fill: "none", stroke: p.idleColor ?? "#ffffff26", "stroke-width": outline }));
  const out: VNode[] = [h("g", { "data-ovl-lidar": "rings" }, rings)];
  const g = contourGeometry(r, frame.zoneLimitsMm, contour.cells);
  const shadowOpacity = p.contourShadowOpacity ?? 0.25;
  if (p.contourShadow !== false && shadowOpacity > 0) {
    out.push(h("g", { "data-ovl-lidar": "shadow", stroke: "none" }, contour.cells.map((c, i) =>
      h("path", { d: g.shadows[i], fill: c.color, "fill-opacity": shadowOpacity * contour.opacity[i] }))));
  }
  out.push(h("g", {
    "data-ovl-lidar": "contour", fill: "none", "stroke-width": Math.max(0, p.contourWidth ?? 3), "stroke-linecap": "round", "stroke-linejoin": "round",
  }, contour.cells.map((c, i) =>
    h("path", { d: g.lines[i], stroke: c.color, "stroke-opacity": contour.opacity[i] < 1 ? contour.opacity[i] : undefined }))));
  return out;
}

export function lidarScene(p: LidarSceneProps, frame: LidarFrame, locale: Locale): VNode[] {
  const r = Math.max(0, p.radius);
  let out: VNode[];
  if (frame.contour) {
    out = contourNodes(p, r, frame);
  } else {
    const paths = fieldPaths(r, frame.sectors);
    const outline = Math.max(0.5, r / 160);
    const fields = frame.fields.map((f, i) =>
      h("path", { d: paths[i], fill: f.color, "fill-opacity": f.opacity < 1 ? f.opacity : undefined, stroke: "#000000", "stroke-opacity": 0.35, "stroke-width": outline }));
    out = [h("g", { "data-ovl-lidar": "fields" }, fields)];
  }
  if (p.sweepEnabled) {
    const a = frame.sweepDeg ?? 0;
    out.push(h("path", {
      "data-ovl-lidar": "sweep",
      d: sectorPath(r, r, 0, r, a - 20, a),
      fill: p.sweepColor,
      display: frame.sweepDeg === undefined ? "none" : undefined,
    }));
  }
  const s = r / 12;
  out.push(h("path", { d: `M${num(r)} ${num(r - s)}L${num(r + s * 0.7)} ${num(r + s * 0.7)}L${num(r - s * 0.7)} ${num(r + s * 0.7)}Z`, fill: p.labelColor }));
  if (p.showLabels) {
    const fs = Math.max(6, r / 11);
    out.push(h("g", { "data-ovl-lidar": "labels", fill: p.labelColor, "font-family": "sans-serif", "font-size": fs }, frame.zoneLimitsMm.slice(0, ZONES).map((mm, z) =>
      h("text", { x: r + fs * 0.3, y: r - ((z + 1) * r) / ZONES + fs }, [z === ZONES - 1 ? `${meters(mm, locale)} m` : meters(mm, locale)]))));
  }
  return out;
}
