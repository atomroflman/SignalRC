// AP14 – reference HUDs R1–R3 of S09 (Shared/Overlay/modules/README.md §4) and
// a frame harness on the real AP08 controller with the fake DOM. Node only;
// the browser measurement with 4× CPU throttling stays a manual check.
import type { Clip, OverlayDocument, OverlayElement } from "../document/types";
import { DEFAULT_LIDAR_OBSTACLES, encodeLidarGrid, synthLidarCells } from "../preview/lidar-synth";
import type { LidarObstacle } from "../preview/types";
import { OverlayController } from "../runtime/controller";
import { FakeDocument } from "../runtime/testing/fake-dom";
import { TestClock } from "../runtime/testing/test-clock";
import type { RuntimeAsset } from "../runtime/types";
import { FakeValueSource } from "../sources/testing/fake-value-source";
import { readContractJson } from "../testing/fixtures";
import { effectiveConfig } from "../document";

export interface ReferenceHud {
  name: string;
  doc: OverlayDocument;
  assets: Record<string, RuntimeAsset>;
}

export const r1 = (): ReferenceHud => ({ name: "R1", doc: readContractJson("fixtures/documents/valid/m2-value-and-rotation.json"), assets: {} });
export const r2 = (): ReferenceHud => ({ name: "R2", doc: readContractJson("fixtures/documents/valid/reference-r2-typical.json"), assets: {} });

function assetSvg(seed: number): RuntimeAsset {
  // 1998 rects + group + path + root ≈ 2000 elements after sanitizing (D32).
  const shapes = Array.from({ length: 1998 }, (_, i) => `<rect x="${(i + seed) % 100}" y="${Math.floor(i / 100)}" width="1" height="1" fill="#ffffff"/>`).join("");
  const svg = `<svg viewBox="0 0 100 20"><g data-part="p_a">${shapes}</g><path data-part="p_n" d="M0 0L10 10"/></svg>`;
  return { svg, metadata: { width: 100, height: 20, parts: { p_n: { tag: "path", bbox: [0, 0, 10, 10] } } } };
}

const A_ID = `sha256-${"a".repeat(64)}`;
const B_ID = `sha256-${"b".repeat(64)}`;

/** R3 at the D33 limits: 500 elements, 200 clips, 300 formulas, 2 assets à ~2000 elements, LiDAR 24 sectors with sweep. */
export function r3(): ReferenceHud {
  const elements: Record<string, OverlayElement> = {};
  const clips: Record<string, Clip> = {};
  const children: string[] = [];
  const add = (id: string, el: OverlayElement) => { elements[id] = el; children.push(id); };
  // 295 bound elements = 295 formulas.
  for (let i = 0; i < 295; i++) {
    add(`e_b${i}`, { type: i % 3 === 0 ? "valueText" : "rect", props: i % 3 === 0
      ? { x: i, value: { base: null, binding: { expr: `tel("c${i % 20}") * 2` } } }
      : { x: { base: 0, binding: { expr: `tel("c${i % 20}") + ${i}`, smoothing: { timeConstantS: 0.2 } } }, width: 10, height: 10 } });
  }
  // 196 clip targets with auto clips, 4 of them also with a whileTrue clip on y (4 condition formulas).
  for (let i = 0; i < 196; i++) {
    add(`e_c${i}`, { type: "ellipse", props: { x: i, width: 8, height: 8 } });
    clips[`c_${i}`] = { durationS: 1 + (i % 5), repeat: "infinite", trigger: { mode: "auto" },
      tracks: [{ element: `e_c${i}`, property: "opacity", keyframes: [{ t: 0, value: 0 }, { t: 1, value: 1, easing: "easeInOut" }] }] };
  }
  for (let i = 0; i < 4; i++) {
    clips[`c_x${i}`] = { durationS: 1, trigger: { mode: "whileTrue", condition: `tel("c${i}") > 5` },
      tracks: [{ element: `e_c${i}`, property: "y", keyframes: [{ t: 0, value: 0 }, { t: 1, value: 5 }] }] };
  }
  for (let i = 0; i < 6; i++) add(`e_t${i}`, { type: "text", props: { x: 10, y: 20 * i, text: `Label ${i}` } });
  // 1 rate formula.
  add("e_a1", { type: "svgAsset", assetId: A_ID, parts: { p_n: { props: { rotation: { base: 0, rate: { expr: 'tel("c1") * 10' } } } } } });
  add("e_a2", { type: "svgAsset", assetId: B_ID });
  add("e_l", { type: "lidarWidget", source: "lidarGrid", props: { sectors: 24, sweepEnabled: true } });
  return {
    name: "R3",
    doc: { schemaVersion: 1, workspace: { width: 1920, height: 1080 }, elements, children, clips },
    assets: { [A_ID]: assetSvg(0), [B_ID]: assetSvg(7) },
  };
}

/** Source names a document reads (tel/out/sig and LiDAR sources). */
export function sourceNames(doc: OverlayDocument) {
  const json = JSON.stringify(doc);
  const names = { tel: new Set<string>(), out: new Set<string>(), sig: new Set<string>() };
  for (const m of json.matchAll(/(tel|out|sig)\(\\"([^\\]+)\\"\)/g)) names[m[1] as "tel" | "out" | "sig"].add(m[2]);
  for (const m of json.matchAll(/"source":"([^"]+)"/g)) names.tel.add(m[1]);
  return names;
}

export interface FrameStats {
  frames: number;
  meanMs: number;
  p95Ms: number;
  maxMs: number;
  domWrites: number;
}

export function stats(samples: number[]): Omit<FrameStats, "domWrites"> {
  const sorted = [...samples].sort((a, b) => a - b);
  const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { frames: samples.length, meanMs: samples.reduce((a, b) => a + b, 0) / samples.length, p95Ms: p(0.95), maxMs: sorted[sorted.length - 1] };
}

/** Moving obstacles giving ≈ 60 occupied fields (S09 synthetic drive). */
export const DRIVE_OBSTACLES: LidarObstacle[] = [
  ...DEFAULT_LIDAR_OBSTACLES,
  { angleDeg: 180, widthDeg: 120, distanceMm: 1500, swingMm: 600, periodS: 4 },
  { angleDeg: 300, widthDeg: 60, distanceMm: 3500, swingMm: 300, periodS: 3 },
];

/**
 * A running HUD session as the driver view has it: controller + scene + DOM
 * patch, 30 fps frames, telemetry at 10 Hz (every 3rd frame), LiDAR at 5 Hz.
 */
export class HudBench {
  readonly dom = new FakeDocument();
  readonly host = this.dom.createElementNS("", "g");
  readonly clock = new TestClock();
  readonly source = new FakeValueSource();
  readonly controller: OverlayController;
  readonly names: ReturnType<typeof sourceNames>;
  required = 0;
  released = 0;
  renderedFrames = 0;
  private frame = 0;

  constructor(readonly hud: ReferenceHud) {
    this.names = sourceNames(hud.doc);
    const source = this.source;
    const provider = Object.assign(source, {
      require: () => { this.required++; return { source, release: () => { this.released++; } }; },
      metadata: (n: string) => (n === "lidarGrid" ? { id: 99, name: n, dataType: "LidarGrid" as const, readIntervalTicks: 2 } : { id: 1, name: n, dataType: "Number" as const, readIntervalTicks: 1 }),
    });
    this.feed(0);
    this.clock.frame(0);
    this.controller = new OverlayController(this.host, this.dom, {
      config: effectiveConfig(hud.doc, null), assets: hud.assets, source: provider, clock: this.clock, mode: "live", locale: "de",
      onFrame: () => { this.renderedFrames++; },
    });
  }

  private feed(i: number) {
    const t = i / 30;
    if (i % 3 === 0) {
      let k = 0;
      for (const n of this.names.tel) if (n !== "lidarGrid") this.source.set("tel", n, { state: "valid", value: String(Math.round((20 + 15 * Math.sin(t + k++)) * 100) / 100) });
      for (const n of this.names.out) this.source.set("out", n, { state: "valid", value: Math.sin(t) });
      for (const n of this.names.sig) this.source.set("sig", n, { state: "valid", value: Math.cos(t) });
      this.source.driver = true;
    }
    if (i % 6 === 0 && this.names.tel.has("lidarGrid")) {
      this.source.set("tel", "lidarGrid", { state: "valid", value: encodeLidarGrid(synthLidarCells(DRIVE_OBSTACLES, t)) });
    }
  }

  /** Runs `count` frames and returns per-frame wall time in ms (source updates included). */
  run(count: number): number[] {
    const out: number[] = [];
    for (let n = 0; n < count; n++) {
      const i = ++this.frame;
      const start = performance.now();
      this.feed(i);
      this.clock.frame(i / 30);
      out.push(performance.now() - start);
    }
    return out;
  }

  measure(count: number): FrameStats {
    const before = this.dom.writes;
    const s = stats(this.run(count));
    return { ...s, domWrites: (this.dom.writes - before) / count };
  }

  dispose() {
    this.controller.dispose();
  }
}
