// AP14 – runtime cost, memory and pause behaviour of the reference HUDs (S09)
// in Node on the real AP08 controller (runtime + scene + DOM patch, fake DOM).
// Long runs only with SIGNALRC_PERF=1. The browser figures (Chromium, 4× CPU
// throttling, real SVG layout/paint) remain a manual check (Overlay-Abnahme.md).
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { validate } from "../document";
import { HudBench, r1, r2, r3, type FrameStats, type ReferenceHud } from "./reference-huds";

const LONG = process.env.SIGNALRC_PERF === "1";
/** Rough stand-in for 4× CPU throttling; it ignores layout/paint/composite of the browser. */
const THROTTLE = 4;

let gc: (() => void) | undefined;
try {
  setFlagsFromString("--expose-gc");
  gc = runInNewContext("gc") as () => void;
} catch {
  gc = undefined;
}

const fmt = (s: FrameStats) =>
  `mean ${s.meanMs.toFixed(3)} ms, p95 ${s.p95Ms.toFixed(3)} ms, max ${s.maxMs.toFixed(2)} ms, ${s.domWrites.toFixed(0)} DOM-Schreibvorgänge/Frame`;

function bench(hud: ReferenceHud, frames: number) {
  const b = new HudBench(hud);
  b.run(150); // warm-up (5 s at 30 fps)
  const s = b.measure(frames);
  b.dispose();
  return s;
}

describe("reference HUDs are valid documents", () => {
  for (const hud of [r1(), r2(), r3()]) {
    it(`${hud.name} has no structure errors`, () => {
      const errors = validate(hud.doc).filter((d) => d.severity === "error" && d.category === "structure");
      expect(errors).toEqual([]);
    });
  }

  it("R3 sits at the D33 limits", () => {
    const { doc } = r3();
    const json = JSON.stringify(doc);
    expect(Object.keys(doc.elements)).toHaveLength(500);
    expect(Object.keys(doc.clips ?? {})).toHaveLength(200);
    expect((json.match(/"expr":|"condition":/g) ?? []).length).toBe(300);
  });
});

describe("the bench drives the HUDs with valid data", () => {
  for (const make of [r1, r2, r3]) {
    const hud = make();
    it(`${hud.name}: no element is marked invalid after warm-up`, () => {
      const b = new HudBench(hud);
      let invalid: string[] = [];
      b.controller.update({ onFrame: (f) => { invalid = Object.entries(f.elements).filter(([, e]) => e.marker === "invalid").map(([id]) => id); } });
      b.run(60);
      b.dispose();
      expect(invalid).toEqual([]);
    });
  }
});

describe("frame cost per reference HUD (Node, no throttling)", () => {
  const frames = LONG ? 1800 : 300; // 60 s or 10 s at 30 fps
  const budgets: Record<string, number> = { R1: 33.4, R2: 33.4, R3: 50 };

  for (const make of [r1, r2, r3]) {
    const hud = make();
    it(`${hud.name}: p95 × ${THROTTLE} stays within the S09 budget (approximation)`, () => {
      const s = bench(hud, frames);
      console.info(`${hud.name} (${s.frames} Frames): ${fmt(s)}; p95×${THROTTLE} ≈ ${(s.p95Ms * THROTTLE).toFixed(2)} ms (Budget ${budgets[hud.name]} ms)`);
      expect(s.p95Ms * THROTTLE).toBeLessThan(budgets[hud.name]);
    });
  }
});

describe("memory over long runs", () => {
  // 10 min simulated (S09) with SIGNALRC_PERF=1, otherwise 1 min.
  const minutes = LONG ? 10 : 1;
  for (const make of LONG ? [r2, r3] : [r2]) {
    const hud = make();
    it(`${hud.name}: heap growth over ${minutes} min simulated stays below 10 MB`, () => {
      const b = new HudBench(hud);
      b.run(300);
      gc?.();
      const before = process.memoryUsage().heapUsed;
      const total = minutes * 60 * 30;
      let peak = 0;
      for (let done = 0; done < total; done += 1800) {
        b.run(Math.min(1800, total - done));
        peak = Math.max(peak, process.memoryUsage().heapUsed - before);
      }
      gc?.();
      const growth = process.memoryUsage().heapUsed - before;
      b.dispose();
      console.info(`${hud.name} Heap nach ${minutes} min (${total} Frames, gc ${gc ? "ja" : "nein"}): ${(growth / 1e6).toFixed(2)} MB Zuwachs, Spitze ${(peak / 1e6).toFixed(2)} MB`);
      expect(growth).toBeLessThan(10e6);
    }, 120_000);
  }
});

describe("paused session (hidden tab / hidden HUD)", () => {
  it("runs no frames and releases the telemetry requirement; showing again restarts without catching up", () => {
    const b = new HudBench(r2());
    b.run(60);
    expect(b.required).toBe(1);
    const clipName = Object.keys(b.hud.doc.clips ?? {})[0];
    expect(clipName).toBeDefined();

    b.controller.setShown(false);
    const rendered = b.renderedFrames;
    const writes = b.dom.writes;
    expect(b.clock.listenerCount).toBe(0);
    expect(b.released).toBe(1);
    expect(b.controller.sessionActive).toBe(false);
    b.run(30 * 60); // one minute hidden, values keep arriving
    expect(b.renderedFrames).toBe(rendered);
    expect(b.dom.writes).toBe(writes);

    let first: { t: number; tau?: number } | undefined;
    const frames: number[] = [];
    b.controller.update({ onFrame: (f) => { frames.push(f.t); first ??= { t: f.t, tau: f.clips[clipName]?.tau }; } });
    const shownAt = b.clock.now();
    b.controller.setShown(true);
    expect(b.required).toBe(2);
    b.run(1);
    expect(frames).toHaveLength(1);
    // A new session starts at the current time: the clip does not replay the hidden minute.
    expect(first!.t - shownAt).toBeLessThan(0.05);
    if (first!.tau !== undefined) expect(first!.tau).toBeLessThan(0.1);
    b.dispose();
    expect(b.released).toBe(2);
  });
});
