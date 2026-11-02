// LiDAR widget drawing: S sectors × five equally wide labelled rings, front up.
import { formatDecimal } from "../../../expression";
import { sectorPath } from "../../geometry";
import type { LidarFrame, Locale } from "../../types";
import { h, num, type VNode } from "../../vnode";

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

export interface LidarSceneProps {
  radius: number;
  showLabels: boolean;
  labelColor: string;
  sweepEnabled: boolean;
  sweepColor: string;
}

export function lidarScene(p: LidarSceneProps, frame: LidarFrame, locale: Locale): VNode[] {
  const r = Math.max(0, p.radius);
  const paths = fieldPaths(r, frame.sectors);
  const outline = Math.max(0.5, r / 160);
  const fields = frame.fields.map((f, i) =>
    h("path", { d: paths[i], fill: f.color, "fill-opacity": f.opacity < 1 ? f.opacity : undefined, stroke: "#000000", "stroke-opacity": 0.35, "stroke-width": outline }));
  const out: VNode[] = [h("g", { "data-ovl-lidar": "fields" }, fields)];
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
