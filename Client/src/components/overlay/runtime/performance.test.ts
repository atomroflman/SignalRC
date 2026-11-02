// Coarse cost guard for an R3-like HUD at the D33 limits (modules §4). The real
// browser measurement with CPU throttling belongs to AP14; this only catches
// gross regressions of the per-frame work (runtime + scene + patch).
import { describe, expect, it } from "vitest";
import { effectiveConfig } from "../document";
import type { Clip, OverlayDocument, OverlayElement } from "../document/types";
import { FakeValueSource } from "../sources/testing/fake-value-source";
import { OverlayController } from "./controller";
import { FakeDocument } from "./testing/fake-dom";
import { TestClock } from "./testing/test-clock";
import type { RuntimeAsset } from "./types";

function r3(): { doc: OverlayDocument; assets: Record<string, RuntimeAsset> } {
  const elements: Record<string, OverlayElement> = {};
  const clips: Record<string, Clip> = {};
  const children: string[] = [];
  for (let i = 0; i < 300; i++) {
    elements[`e_b${i}`] = { type: i % 3 === 0 ? "valueText" : "rect", props: i % 3 === 0
      ? { x: i, value: { base: null, binding: { expr: `tel("c${i % 20}") * 2` } } }
      : { x: { base: 0, binding: { expr: `tel("c${i % 20}") + ${i}`, smoothing: { timeConstantS: 0.2 } } }, width: 10, height: 10 } };
    children.push(`e_b${i}`);
  }
  for (let i = 0; i < 195; i++) {
    elements[`e_c${i}`] = { type: "ellipse", props: { x: i, width: 8, height: 8 } };
    clips[`c_${i}`] = { durationS: 1 + (i % 5), repeat: "infinite", trigger: { mode: "auto" },
      tracks: [{ element: `e_c${i}`, property: "opacity", keyframes: [{ t: 0, value: 0 }, { t: 1, value: 1, easing: "easeInOut" }] }] };
    children.push(`e_c${i}`);
  }
  for (let i = 0; i < 5; i++) clips[`c_x${i}`] = { durationS: 1, trigger: { mode: "whileTrue", condition: `tel("c${i}") > 5` }, tracks: [{ element: `e_c${i}`, property: "y", keyframes: [{ t: 0, value: 0 }, { t: 1, value: 5 }] }] };
  const shapes = Array.from({ length: 2000 }, (_, i) => `<rect x="${i % 100}" y="${Math.floor(i / 100)}" width="1" height="1" fill="#ffffff"/>`).join("");
  const svg = `<svg viewBox="0 0 100 20"><g data-part="p_a">${shapes}</g><path data-part="p_n" d="M0 0L10 10"/></svg>`;
  const assets = { "sha256-r3": { svg, metadata: { width: 100, height: 20, parts: { p_n: { tag: "path", bbox: [0, 0, 10, 10] as [number, number, number, number] } } } } };
  elements.e_a1 = { type: "svgAsset", assetId: "sha256-r3", parts: { p_n: { props: { rotation: { base: 0, rate: { expr: 'tel("c1") * 10' } } } } } };
  elements.e_a2 = { type: "svgAsset", assetId: "sha256-r3" };
  elements.e_l = { type: "lidarWidget", source: "lidarGrid", props: { sectors: 24, sweepEnabled: true } };
  children.push("e_a1", "e_a2", "e_l");
  return { doc: { schemaVersion: 1, workspace: { width: 1920, height: 1080 }, elements, children, clips }, assets };
}

describe("performance (coarse)", () => {
  it("an R3-like HUD frame stays well below the frame budget", () => {
    const { doc, assets } = r3();
    const dom = new FakeDocument();
    const host = dom.createElementNS("", "g");
    const clock = new TestClock();
    const source = new FakeValueSource();
    const meta = { dataType: "Number" as const };
    const provider = Object.assign(source, {
      require: () => ({ source, release() {} }),
      metadata: (n: string) => (n === "lidarGrid" ? { id: 99, name: n, dataType: "LidarGrid" as const, subscribed: false } : { id: 1, name: n, ...meta, subscribed: false }),
    });
    const ctl = new OverlayController(host, dom, { config: effectiveConfig(doc, null), assets, source: provider, clock, mode: "live", locale: "de" });
    const frames = 120;
    clock.frame(0);
    const start = performance.now();
    for (let i = 1; i <= frames; i++) {
      if (i % 3 === 0) for (let c = 0; c < 20; c++) source.set("tel", `c${c}`, { state: "valid", value: String(i % 10) });
      if (i % 6 === 0) source.set("tel", "lidarGrid", { state: "valid", value: i % 12 === 0 ? "11s:AQBkAA==" : "11s:" });
      clock.frame(i / 30);
    }
    const perFrame = (performance.now() - start) / frames;
    ctl.dispose();
    expect(host.byAttr("data-ovl-id")).toHaveLength(498);
    // Node without throttling; the browser budget is 50 ms p95 at 4× throttling (R3).
    console.info(`R3-like frame: ${perFrame.toFixed(2)} ms`);
    expect(perFrame).toBeLessThan(12);
  });
});
