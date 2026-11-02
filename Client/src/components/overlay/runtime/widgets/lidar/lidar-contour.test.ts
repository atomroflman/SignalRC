// LiDAR contour mode (lidar §6.2, D74): fixture cases, widget state and scene.
import { describe, expect, it } from "vitest";
import { effectiveConfig } from "../../../document";
import type { OverlayDocument } from "../../../document/types";
import { DEFAULT_ZONE_LIMITS_MM, LIDAR_EMPTY, LIDAR_FIELDS } from "../../../sources/lidar-grid";
import { FakeValueSource } from "../../../sources/testing/fake-value-source";
import type { LidarGrid, LidarGridValue } from "../../../sources/types";
import { readContractJson } from "../../../testing/fixtures";
import { createRuntime } from "../../runtime";
import { SceneBuilder } from "../../scene";
import { num, toMarkup } from "../../vnode";
import {
  cellNearest, contourChains, contourJoined, contourJoins, contourRadius, DEFAULT_CONTOUR_JOIN_MM,
} from "./lidar-contour";
import { lidarScene } from "./lidar-scene";
import { LidarWidgetState, type LidarWidgetOptions } from "./lidar-widget";

interface Field { cell: number; zone: number; cm: number }
interface Case {
  id: string;
  contourJoinMm?: number;
  fields: Field[];
  expect: { nearestMm?: Record<string, number>; chains: { cells: number[]; closed: boolean }[] };
}

const { contour } = readContractJson<{ contour: { cases: Case[] } }>("fixtures/lidar/cases.json");

function grid(fields: Field[], complete = true): LidarGrid {
  const cm = new Uint16Array(LIDAR_FIELDS).fill(LIDAR_EMPTY);
  for (const f of fields) cm[f.cell * 5 + f.zone] = f.cm;
  return { version: 1, complete, cm };
}

const value = (g: LidarGrid): LidarGridValue => ({ state: "valid", grid: g, zoneLimitsMm: DEFAULT_ZONE_LIMITS_MM });

const options: LidarWidgetOptions = {
  display: "contour", contourJoinMm: 300,
  sectors: 8, nearDistanceM: 0.5, farDistanceM: 5, nearColor: "#ff0000", midColor: "#ff8000", farColor: "#ffff00",
  idleColor: "#ffffff26", blinkNearHz: 2, blinkFarHz: 0.5, minPulseOpacity: 0.35, afterglowS: 0.5,
  sweepEnabled: false, sweepPeriodS: 2,
};

describe("contour fixture cases", () => {
  it("has cases", () => expect(contour.cases.length).toBeGreaterThanOrEqual(10));

  it.each(contour.cases.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    const nearest = cellNearest(grid(c.fields));
    if (c.expect.nearestMm) {
      const got: Record<string, number> = {};
      nearest.forEach((p, k) => { if (p) got[String(k)] = p.mm; });
      expect(got).toEqual(c.expect.nearestMm);
    }
    const mm = nearest.map((p) => p?.mm);
    expect(contourChains(mm, contourJoins(mm, c.contourJoinMm ?? DEFAULT_CONTOUR_JOIN_MM))).toEqual(c.expect.chains);
  });
});

describe("contour rules", () => {
  it("joins equal distances at any range, through the chord share", () => {
    for (const d of [200, 1000, 5000, 12000]) expect(contourJoined(d, d, 10)).toBe(true);
    // A pure 300 mm limit would split a wall at 5 m (chord ≈ 327 mm).
    expect(contourJoined(5000, 5000, 300)).toBe(true);
    expect(contourJoined(1000, 1400, 300)).toBe(false);
    expect(contourJoined(1000, 1350, 300)).toBe(true);
  });

  it("radius is linear within the ring of the point's zone", () => {
    const L = DEFAULT_ZONE_LIMITS_MM;
    expect(contourRadius({ mm: 250, zone: 0 }, L, 100)).toBe(10);
    expect(contourRadius({ mm: 500, zone: 0 }, L, 100)).toBe(20);
    expect(contourRadius({ mm: 1500, zone: 2 }, L, 100)).toBe(50);
    expect(contourRadius({ mm: 5000, zone: 4 }, L, 100)).toBe(100);
    // cm rounding may move a value just past its zone limit: clamped to the ring.
    expect(contourRadius({ mm: 1000, zone: 2 }, L, 100)).toBe(40);
    expect(contourRadius({ mm: 5004, zone: 4 }, L, 100)).toBe(100);
  });
});

describe("contour widget state", () => {
  const wall = grid([20, 21, 22].map((cell) => ({ cell, zone: 2, cm: 150 })));
  const front = grid([{ cell: 0, zone: 0, cm: 40 }]);
  const empty = grid([]);

  it("shows the nearest point per cell with color, joins and pulse", () => {
    const w = new LidarWidgetState();
    let r = w.step(0, value(wall), options);
    expect(r.frame.fields).toEqual([]);
    const c = r.frame.contour!;
    expect(c.cells.map((x) => [x.cell, x.joinPrev, x.joinNext])).toEqual([[20, false, true], [21, true, true], [22, true, false]]);
    expect(c.cells[0]).toMatchObject({ distanceM: 1.5, zone: 2 });
    expect(c.opacity).toEqual([1, 1, 1]);
    r = w.step(0, value(front), options);
    expect(r.frame.contour!.cells[0]).toMatchObject({ cell: 0, color: "#ff0000ff", joinPrev: false, joinNext: false });
    r = w.step(0.25, value(front), options);
    // 2 Hz in the near zone: half a period after 0.25 s → minimum opacity, never zero.
    expect(r.frame.contour!.opacity[0]).toBeCloseTo(0.35);
  });

  it("keeps the cell list while only the pulse changes (no recomputation without a new sample)", () => {
    const w = new LidarWidgetState();
    const a = w.step(0, value(wall), options).frame.contour!.cells;
    const b = w.step(0.1, value(wall), options).frame.contour!.cells;
    expect(b).toBe(a);
    const c = w.step(0.2, value(grid([20, 21, 22].map((cell) => ({ cell, zone: 2, cm: 150 })))), options).frame.contour!.cells;
    expect(c).toBe(a);
    expect(w.step(0.3, value(wall), { ...options, contourJoinMm: 10 }).frame.contour!.cells).not.toBe(a);
  });

  it("afterglow keeps vanished cells for 0.5 s, joins included", () => {
    const w = new LidarWidgetState();
    w.step(0, value(wall), options);
    const only20 = grid([{ cell: 20, zone: 2, cm: 150 }]);
    expect(w.step(1, value(only20), options).frame.contour!.cells.map((c) => c.cell)).toEqual([20, 21, 22]);
    expect(w.step(1.4, value(only20), options).frame.contour!.cells).toHaveLength(3);
    const after = w.step(1.5, value(only20), options).frame.contour!.cells;
    expect(after.map((c) => [c.cell, c.joinNext])).toEqual([[20, false]]);
    expect(w.step(1.6, value(empty), { ...options, afterglowS: 0 }).frame.contour!.cells).toEqual([]);
  });

  it("invalid: last valid contour frozen, fresh start afterwards", () => {
    const w = new LidarWidgetState();
    w.step(0, value(front), options);
    w.step(0.25, value(front), options);
    const r = w.step(0.3, { state: "invalid", reason: "stale" }, options);
    expect(r.marker).toBe("invalid");
    expect(r.frame.contour!.cells).toHaveLength(1);
    expect(r.frame.contour!.opacity).toEqual([1]);
    expect(w.step(0.4, value(empty), options).frame.contour!.cells).toEqual([]);
    expect(new LidarWidgetState().step(0, { state: "invalid" }, options).frame.contour!.cells).toEqual([]);
  });

  it("incomplete scan shows the warning triangle; switching the display starts fresh", () => {
    const w = new LidarWidgetState();
    expect(w.step(0, value(grid([{ cell: 3, zone: 1, cm: 80 }], false)), options).marker).toBe("unchecked");
    const s = w.step(0.1, value(front), { ...options, display: "sectors" }).frame;
    expect(s.contour).toBeUndefined();
    expect(s.fields).toHaveLength(40);
    expect(w.step(0.2, value(empty), options).frame.contour!.cells).toEqual([]);
  });
});

describe("contour scene", () => {
  const props = { radius: 100, showLabels: true, labelColor: "#ffffffcc", sweepEnabled: false, sweepColor: "#00ff0066", idleColor: "#ffffff26", contourWidth: 3, contourShadow: true, contourShadowOpacity: 0.25 };

  it("draws bare rings, one piece and one shadow per cell, at most 96 each", () => {
    const w = new LidarWidgetState();
    const all = grid(Array.from({ length: 96 }, (_, cell) => ({ cell, zone: 2, cm: 150 })));
    const frame = w.step(0, value(all), options).frame;
    const markup = lidarScene(props, frame, "de").map(toMarkup).join("");
    expect(markup.match(/<circle [^>]*fill="none"/g)).toHaveLength(5);
    expect(markup).not.toContain('data-ovl-lidar="fields"');
    const contourGroup = /data-ovl-lidar="contour"[^>]*>(.*?)<\/g>/.exec(markup)![1];
    expect(contourGroup.match(/<path/g)).toHaveLength(96);
    const shadow = /data-ovl-lidar="shadow"[^>]*>(.*?)<\/g>/.exec(markup)![1];
    expect(shadow.match(/<path/g)).toHaveLength(96);
    expect(lidarScene({ ...props, contourShadow: false }, frame, "de").map(toMarkup).join("")).not.toContain('data-ovl-lidar="shadow"');
  });

  it("joined pieces meet at the mean radius on the cell border; chain ends lie on the own radius", () => {
    const w = new LidarWidgetState();
    // Cell 0 at 1.5 m (ring radius 50), cell 1 at 1.6 m (ring radius 52): s ≈ 142 mm, joined.
    const g = grid([{ cell: 0, zone: 2, cm: 150 }, { cell: 1, zone: 2, cm: 160 }]);
    const frame = w.step(0, value(g), options).frame;
    expect(frame.contour!.cells.map((c) => c.joinNext)).toEqual([true, false]);
    const nodes = lidarScene(props, frame, "de").map(toMarkup).join("");
    const pieces = /data-ovl-lidar="contour"[^>]*>(.*?)<\/g>/.exec(nodes)![1].match(/d="([^"]+)"/g)!;
    // Cell 0 starts at its own radius 50 straight above the centre (100, 50).
    expect(pieces[0]).toMatch(/^d="M100 50L/);
    // Both pieces share the border point at angle 3.75° and radius (50 + 52) / 2 = 51.
    const shared = `${num(100 + 51 * Math.sin((3.75 * Math.PI) / 180))} ${num(100 - 51 * Math.cos((3.75 * Math.PI) / 180))}`;
    expect(pieces[0]).toContain(`L${shared}"`);
    expect(pieces[1]).toContain(`d="M${shared}L`);
  });

  it("renders through the runtime with display contour", () => {
    const doc: OverlayDocument = {
      schemaVersion: 1,
      workspace: { width: 400, height: 400 },
      elements: { e_l: { type: "lidarWidget", source: "lidarGrid", props: { x: 10, y: 10, radius: 100, display: "contour", sweepEnabled: true } } },
      children: ["e_l"],
    };
    const config = effectiveConfig(doc, null);
    const rt = createRuntime(config);
    const src = new FakeValueSource();
    src.set("tel", "lidarGrid", { state: "valid", value: "11s:AQBkAA==" });
    const frame = rt.step(0, src);
    const f = frame.elements.e_l;
    expect(f.lidar?.contour?.cells).toEqual([expect.objectContaining({ cell: 0, distanceM: 1, zone: 1 })]);
    const markup = toMarkup(new SceneBuilder(config, { locale: "de", pxPerUnit: 1, idPrefix: "ovl-", assets: {} }).build(frame).tree);
    expect(markup).toContain('data-ovl-lidar="contour"');
    expect(markup).toContain('data-ovl-lidar="sweep"');
    for (const label of ["0,5", ">1<", ">2<", ">3<", "5 m"]) expect(markup).toContain(label);
    const design = createRuntime(config).baseFrame().elements.e_l;
    expect(design.lidar?.contour?.cells).toEqual([]);
  });
});
