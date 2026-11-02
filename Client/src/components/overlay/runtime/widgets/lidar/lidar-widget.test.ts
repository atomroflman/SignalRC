// LiDAR widget: all sector counts from the 96-cell grid (lidar §6), color scale,
// pulsing, afterglow and quality (Overlay-Feature.md LiDAR).
import { describe, expect, it } from "vitest";
import { effectiveConfig } from "../../../document";
import type { OverlayDocument } from "../../../document/types";
import { LIDAR_EMPTY, LIDAR_FIELDS } from "../../../sources/lidar-grid";
import { FakeValueSource } from "../../../sources/testing/fake-value-source";
import type { LidarGrid, LidarGridValue } from "../../../sources/types";
import { readContractJson } from "../../../testing/fixtures";
import { createRuntime } from "../../runtime";
import { SceneBuilder } from "../../scene";
import { toMarkup } from "../../vnode";
import {
  blinkHz, distanceColor, LIDAR_SECTOR_COUNTS, LidarWidgetState, pulseOpacity, sectorCells, sectorDistancesCm, type LidarWidgetOptions,
} from "./lidar-widget";

const { sectorCells: expected } = readContractJson<{ sectorCells: Record<string, number[][]> }>("fixtures/lidar/cases.json");

const options: LidarWidgetOptions = {
  sectors: 8, nearDistanceM: 0.5, farDistanceM: 5, nearColor: "#ff0000", midColor: "#ff8000", farColor: "#ffff00",
  idleColor: "#ffffff26", blinkNearHz: 2, blinkFarHz: 0.5, minPulseOpacity: 0.35, afterglowS: 0.5,
  sweepEnabled: false, sweepPeriodS: 2,
};

function grid(fields: { cell: number; zone: number; cm: number }[], complete = true): LidarGrid {
  const cm = new Uint16Array(LIDAR_FIELDS).fill(LIDAR_EMPTY);
  for (const f of fields) cm[f.cell * 5 + f.zone] = f.cm;
  return { version: 1, complete, cm };
}

const value = (g: LidarGrid, state: "valid" | "unchecked" = "valid"): LidarGridValue => ({ state, grid: g, zoneLimitsMm: [500, 1000, 2000, 3000, 5000] });

describe("sector division", () => {
  it.each(LIDAR_SECTOR_COUNTS)("%i sectors match the contract cells", (s) => {
    expect(sectorCells(s)).toEqual(expected[String(s)]);
  });

  it.each(LIDAR_SECTOR_COUNTS)("%i sectors: every cell belongs to exactly one sector", (s) => {
    const all = sectorCells(s).flat().sort((a, b) => a - b);
    expect(all).toEqual(Array.from({ length: 96 }, (_, i) => i));
  });

  it.each(LIDAR_SECTOR_COUNTS)("%i sectors: a front obstacle at cell 0 and one at 95 land in sector 0", (s) => {
    const d = sectorDistancesCm(grid([{ cell: 0, zone: 1, cm: 90 }, { cell: 95, zone: 1, cm: 80 }]), s);
    expect(d[1]).toBe(80);
    expect([...d].filter((v) => v !== LIDAR_EMPTY)).toHaveLength(1);
  });

  it("field value is the minimum of its cells per zone; zones stay separate", () => {
    const d = sectorDistancesCm(grid([
      { cell: 6, zone: 2, cm: 150 }, { cell: 10, zone: 2, cm: 120 }, { cell: 10, zone: 0, cm: 40 }, { cell: 18, zone: 2, cm: 110 },
    ]), 8);
    expect(d[1 * 5 + 2]).toBe(120);
    expect(d[1 * 5 + 0]).toBe(40);
    expect(d[2 * 5 + 2]).toBe(110);
  });

  it("an obstacle split across a sector border marks both sectors", () => {
    const d = sectorDistancesCm(grid([{ cell: 5, zone: 1, cm: 70 }, { cell: 6, zone: 1, cm: 70 }]), 8);
    expect(d[0 * 5 + 1]).toBe(70);
    expect(d[1 * 5 + 1]).toBe(70);
  });
});

describe("colors and blinking", () => {
  it("continuous scale: red in the near zone, orange in the middle, yellow far", () => {
    expect(distanceColor(0.3, options)).toBe("#ff0000ff");
    expect(distanceColor(0.5, options)).toBe("#ff0000ff");
    expect(distanceColor(2.75, options)).toBe("#ff8000ff");
    expect(distanceColor(5, options)).toBe("#ffff00ff");
    expect(distanceColor(8, options)).toBe("#ffff00ff");
  });

  it("closer is never less red (green channel grows monotonically with distance)", () => {
    let prev = -1;
    for (let d = 0; d <= 6; d += 0.05) {
      const g = parseInt(distanceColor(d, options).slice(3, 5), 16);
      expect(g).toBeGreaterThanOrEqual(prev);
      prev = g;
    }
  });

  it("blink frequency 2 Hz near, 0.5 Hz far, linear between", () => {
    expect(blinkHz(0.2, options)).toBe(2);
    expect(blinkHz(5, options)).toBe(0.5);
    expect(blinkHz(2.75, options)).toBeCloseTo(1.25);
  });

  it("pulsing never fully disappears", () => {
    for (let p = 0; p < 1; p += 0.05) expect(pulseOpacity(p, 0.35)).toBeGreaterThanOrEqual(0.35 - 1e-12);
    expect(pulseOpacity(0, 0.35)).toBe(1);
    expect(pulseOpacity(0.5, 0.35)).toBeCloseTo(0.35);
  });
});

describe("widget state", () => {
  const front = grid([{ cell: 0, zone: 0, cm: 40 }]);
  const empty = grid([]);

  it("new occupation appears at once at full opacity and pulses at its frequency", () => {
    const w = new LidarWidgetState();
    let r = w.step(0, value(front), options);
    expect(r.frame.fields[0]).toMatchObject({ distanceM: 0.4, color: "#ff0000ff", opacity: 1 });
    expect(r.marker).toBeUndefined();
    r = w.step(0.25, value(front), options);
    // 2 Hz: half a period after 0.25 s → minimum opacity.
    expect(r.frame.fields[0].opacity).toBeCloseTo(0.35);
    expect(r.frame.fields[1]).toEqual({ color: options.idleColor, opacity: 1 });
  });

  it("afterglow keeps the last display for 0.5 s after the occupation vanished", () => {
    const w = new LidarWidgetState();
    w.step(0, value(front), options);
    expect(w.step(1, value(empty), options).frame.fields[0].distanceM).toBe(0.4);
    expect(w.step(1.4, value(empty), options).frame.fields[0].distanceM).toBe(0.4);
    expect(w.step(1.5, value(empty), options).frame.fields[0].distanceM).toBeUndefined();
  });

  it("afterglow 0 clears immediately", () => {
    const w = new LidarWidgetState();
    w.step(0, value(front), { ...options, afterglowS: 0 });
    expect(w.step(0.1, value(empty), { ...options, afterglowS: 0 }).frame.fields[0].distanceM).toBeUndefined();
  });

  it("an incomplete scan shows its groups with the warning triangle", () => {
    const w = new LidarWidgetState();
    const r = w.step(0, value(grid([{ cell: 0, zone: 0, cm: 40 }], false)), options);
    expect(r.marker).toBe("unchecked");
    expect(r.frame.fields[0].distanceM).toBe(0.4);
    expect(w.step(0.1, value(front, "unchecked"), options).marker).toBe("unchecked");
  });

  it("an invalid source is invalid; afterglow does not extend validity; no invented obstacles", () => {
    const w = new LidarWidgetState();
    let r = w.step(0, { state: "invalid", reason: "no-data" }, options);
    expect(r.marker).toBe("invalid");
    expect(r.frame.fields.every((f) => f.distanceM === undefined)).toBe(true);
    w.step(1, value(front), options);
    r = w.step(1.1, { state: "invalid", reason: "stale" }, options);
    expect(r.marker).toBe("invalid");
    // Last valid display, frozen and without pulsing.
    expect(r.frame.fields[0]).toMatchObject({ distanceM: 0.4, opacity: 1 });
    expect(w.step(5, { state: "invalid", reason: "stale" }, options).marker).toBe("invalid");
  });

  it("after invalid data the display starts fresh (no afterglow carried over)", () => {
    const w = new LidarWidgetState();
    w.step(0, value(front), options);
    w.step(0.1, { state: "invalid" }, options);
    expect(w.step(0.2, value(empty), options).frame.fields[0].distanceM).toBeUndefined();
  });

  it("sweep turns with its period only while the source is usable", () => {
    const w = new LidarWidgetState();
    const o = { ...options, sweepEnabled: true, sweepPeriodS: 2 };
    expect(w.step(10, value(empty), o).frame.sweepDeg).toBe(0);
    expect(w.step(10.5, value(empty), o).frame.sweepDeg).toBeCloseTo(90);
    expect(w.step(11, { state: "invalid" }, o).frame.sweepDeg).toBeUndefined();
  });
});

describe("widget in the runtime and scene", () => {
  const doc = (sectors: number): OverlayDocument => ({
    schemaVersion: 1,
    workspace: { width: 400, height: 400 },
    elements: { e_l: { type: "lidarWidget", source: "lidarGrid", props: { x: 10, y: 10, radius: 100, sectors, sweepEnabled: true } } },
    children: ["e_l"],
  });

  it.each(LIDAR_SECTOR_COUNTS)("renders %i × 5 fields with five labelled rings", (s) => {
    const config = effectiveConfig(doc(s), null);
    const rt = createRuntime(config);
    const src = new FakeValueSource();
    src.set("tel", "lidarGrid", { state: "valid", value: "11s:AQBkAA==" });
    const frame = rt.step(0, src);
    const f = frame.elements.e_l;
    expect(f.lidar?.fields).toHaveLength(s * 5);
    expect(f.lidar?.fields[1].distanceM).toBe(1);
    expect(f.marker).toBeUndefined();
    const markup = toMarkup(new SceneBuilder(config, { locale: "de", pxPerUnit: 1, idPrefix: "ovl-", assets: {} }).build(frame).tree);
    expect(markup.match(/<path d="M/g)?.length).toBeGreaterThanOrEqual(s * 5);
    for (const label of ["0,5", ">1<", ">2<", ">3<", "5 m"]) expect(markup).toContain(label);
    expect(markup).toContain('data-ovl-lidar="sweep"');
  });

  it("without a source the widget is invalid and shows no obstacles", () => {
    const rt = createRuntime(effectiveConfig(doc(8), null));
    const f = rt.step(0, new FakeValueSource()).elements.e_l;
    expect(f.marker).toBe("invalid");
    expect(f.lidar?.fields.every((x) => x.distanceM === undefined)).toBe(true);
    expect(f.lidar?.sweepDeg).toBeUndefined();
  });

  it("design mode shows an idle grid without markers", () => {
    const f = createRuntime(effectiveConfig(doc(12), null)).baseFrame().elements.e_l;
    expect(f.marker).toBeUndefined();
    expect(f.lidar?.fields).toHaveLength(60);
    expect(f.lidar?.sweepDeg).toBeUndefined();
  });
});
