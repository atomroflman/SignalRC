// Preview time, generators, synthetic LiDAR and the overlay of simulated over live values.
import { describe, expect, it } from "vitest";
import { effectiveConfig } from "../document";
import type { OverlayDocument } from "../document/types";
import { OverlayController } from "../runtime/controller";
import { FakeDocument } from "../runtime/testing/fake-dom";
import { TestClock } from "../runtime/testing/test-clock";
import { decodeLidarGrid, lidarField } from "../sources/lidar-grid";
import { FakeValueSource } from "../sources/testing/fake-value-source";
import type { ChannelMetadata, Dependency, OverlaySourceProvider, RequireOptions } from "../sources/types";
import { isDynamic, numberAt, telemetryText } from "./generators";
import { encodeLidarGrid, synthLidarCells, zoneOf } from "./lidar-synth";
import { PreviewClock } from "./preview-clock";
import { PreviewSourceProvider } from "./preview-source";
import { PreviewSession } from "./session";

class RecordingProvider extends FakeValueSource implements OverlaySourceProvider {
  readonly required: { id: string; deps: Dependency[]; options?: RequireOptions }[] = [];
  readonly released: string[] = [];
  meta: Record<string, ChannelMetadata> = {};
  require(id: string, deps: Dependency[], options?: RequireOptions) {
    this.required.push({ id, deps, options });
    return { source: this, release: () => { this.released.push(id); } };
  }
  metadata(name: string) {
    return this.meta[name];
  }
}

describe("preview clock", () => {
  it("pauses, steps and changes speed without jumps", () => {
    const base = new TestClock();
    const clock = new PreviewClock(base);
    const seen: number[] = [];
    clock.onFrame((t) => seen.push(t));
    base.frame(1);
    clock.setSpeed(2);
    base.frame(2);
    expect(seen).toEqual([1, 3]);
    clock.pause();
    base.frame(5);
    expect(clock.now()).toBe(3);
    clock.step(0.5);
    expect(seen.at(-1)).toBe(3.5);
    clock.play();
    base.frame(6);
    expect(clock.now()).toBe(5.5);
    clock.reset();
    expect(clock.now()).toBe(0);
  });

  it("runs base frames only while someone listens", () => {
    const base = new TestClock();
    const clock = new PreviewClock(base);
    const off = clock.onFrame(() => {});
    expect(base.listenerCount).toBe(1);
    off();
    expect(base.listenerCount).toBe(0);
  });
});

describe("generators", () => {
  it("ramp, triangle and sine are pure functions of t", () => {
    expect(numberAt({ kind: "ramp", from: 0, to: 10, periodS: 4 }, 1)).toBe(2.5);
    expect(numberAt({ kind: "ramp", from: 0, to: 10, periodS: 4 }, 5)).toBe(2.5);
    expect(numberAt({ kind: "ramp", from: 0, to: 10, periodS: 4, shape: "triangle" }, 3)).toBe(5);
    expect(numberAt({ kind: "sine", offset: 1, amplitude: 2, periodS: 4 }, 1)).toBeCloseTo(3);
    expect(numberAt({ kind: "slider", value: 200, min: 0, max: 100 }, 0)).toBe(100);
    expect(isDynamic({ kind: "fixed", value: 1 })).toBe(false);
    expect(isDynamic({ kind: "sine", offset: 0, amplitude: 1, periodS: 1 })).toBe(true);
  });

  it("produces telemetry text by data type", () => {
    expect(telemetryText({ kind: "fixed", value: 2.6 }, 0, "Integer")).toBe("3");
    expect(telemetryText({ kind: "fixed", value: true }, 0, "Boolean")).toBe("true");
    expect(telemetryText({ kind: "slider", value: 0.1 + 0.2, min: 0, max: 1 }, 0, "Number")).toBe("0.3");
    expect(telemetryText({ kind: "fixed", value: "abc" }, 0, "Number")).toBe("abc");
  });
});

describe("synthetic LiDAR", () => {
  it("encodes grids the contract decoder reads back, sparse and dense", () => {
    const cm = synthLidarCells([{ angleDeg: 0, widthDeg: 7.5, distanceMm: 795 }], 0);
    const text = encodeLidarGrid(cm, false);
    expect(text.startsWith("10s:")).toBe(true);
    const grid = decodeLidarGrid(text)!;
    expect(grid.complete).toBe(false);
    // 0° ± 3.75°: cells 95 and 0, zone 1 (500, 1000], cm = floor((795 + 5) / 10).
    expect(lidarField(grid, 95, 1)).toBe(80);
    expect(lidarField(grid, 0, 1)).toBe(80);
    expect(lidarField(grid, 1, 1)).toBeUndefined();
    expect(encodeLidarGrid(synthLidarCells([], 0))).toBe("11s:");
    const full = synthLidarCells([{ angleDeg: 180, widthDeg: 360, distanceMm: 400 }, { angleDeg: 180, widthDeg: 360, distanceMm: 900 }, { angleDeg: 180, widthDeg: 360, distanceMm: 1500 }], 0);
    const dense = encodeLidarGrid(full);
    expect(dense.startsWith("11d:")).toBe(true);
    expect(lidarField(decodeLidarGrid(dense)!, 40, 2)).toBe(150);
  });

  it("assigns zones by the upper limits and drops far values", () => {
    expect(zoneOf(500)).toBe(0);
    expect(zoneOf(501)).toBe(1);
    expect(zoneOf(5001)).toBe(-1);
    expect(encodeLidarGrid(synthLidarCells([{ angleDeg: 0, widthDeg: 10, distanceMm: 6000 }], 0))).toBe("11s:");
  });

  it("rotates and swings with the preview time", () => {
    const at = (t: number) => decodeLidarGrid(encodeLidarGrid(synthLidarCells([{ angleDeg: 0, widthDeg: 3.75, distanceMm: 1000, swingMm: 500, periodS: 4 }], t, { rotateDegPerS: 90 })))!;
    expect(lidarField(at(0), 95, 1)).toBe(100);
    // t = 1: rotated to 90°, distance 1500 mm → zone 2.
    expect(lidarField(at(1), 23, 2)).toBe(150);
  });
});

describe("preview source", () => {
  function setup() {
    const base = new TestClock();
    const clock = new PreviewClock(base);
    const live = new RecordingProvider();
    live.meta.speed = { id: 1, name: "speed", dataType: "Number", readIntervalTicks: 1 };
    live.meta.temp = { id: 2, name: "temp", dataType: "Number", readIntervalTicks: 1 };
    live.meta.lidarGrid = { id: 3, name: "lidarGrid", dataType: "LidarGrid", readIntervalTicks: 2, zoneLimitsMm: [500, 1000, 2000, 3000, 5000] };
    live.set("tel", "speed", { state: "valid", value: "12" });
    live.set("tel", "temp", { state: "valid", value: "40" });
    const source = new PreviewSourceProvider(live, clock);
    return { base, clock, live, source };
  }

  const deps: Dependency[] = [{ kind: "tel", name: "speed" }, { kind: "tel", name: "temp" }, { kind: "out", name: "steer" }];

  it("overrides single channels; the rest stays live and only that is requested", () => {
    const { live, source } = setup();
    const req = source.require("hud", deps, { staleAfterMs: { speed: 2000 } });
    expect(live.required.at(-1)!.deps).toEqual(deps);
    source.setSettings({ simulateAll: false, overrides: { "tel:speed": { generator: { kind: "fixed", value: 99 } } } });
    expect(live.required.at(-1)!.deps).toEqual([{ kind: "tel", name: "temp" }, { kind: "out", name: "steer" }]);
    expect(live.required.at(-1)!.options?.staleAfterMs).toEqual({ speed: 2000 });
    expect(req.source.get("tel", "speed")).toMatchObject({ state: "valid", value: "99" });
    expect(req.source.get("tel", "temp")).toMatchObject({ state: "valid", value: "40" });
    // The live store is untouched.
    expect(live.get("tel", "speed")).toMatchObject({ value: "12" });
    req.release();
    expect(live.released).toContain("preview:hud");
  });

  it("test mode simulates every required value and requests nothing live", () => {
    const { live, source } = setup();
    source.require("hud", deps);
    const before = live.required.length;
    source.setSettings({ simulateAll: true, overrides: {} });
    expect(live.required.length).toBe(before);
    expect(live.released).toEqual(["preview:hud"]);
    expect(source.get("tel", "speed").state).toBe("valid");
    expect(source.get("out", "steer")).toMatchObject({ state: "valid", value: 0 });
    expect(source.lidarGrid("lidarGrid").grid).toBeDefined();
  });

  it("simulates missing, unchecked, error, stale and unparsable values with the live rules", () => {
    const { source } = setup();
    const set = (o: object) => source.setSettings({ simulateAll: false, overrides: { "tel:speed": { generator: { kind: "fixed", value: 5 }, ...o } } });
    set({ quality: "missing" });
    expect(source.get("tel", "speed")).toMatchObject({ state: "invalid", reason: "no-data" });
    set({ quality: "unchecked" });
    expect(source.get("tel", "speed")).toMatchObject({ state: "unchecked", value: "5" });
    set({ quality: "error" });
    expect(source.get("tel", "speed")).toMatchObject({ state: "invalid", reason: "source-error" });
    set({ quality: "stale" });
    expect(source.get("tel", "speed")).toMatchObject({ state: "invalid", reason: "stale", ageMs: 1001 });
    // An age within the deadline stays valid; the HUD deadline override counts.
    set({ ageMs: 1500 });
    expect(source.get("tel", "speed")).toMatchObject({ state: "invalid", reason: "stale" });
    expect(source.require("x", deps, { staleAfterMs: { speed: 2000 } }).source.get("tel", "speed")).toMatchObject({ state: "valid", ageMs: 1500 });
    source.setSettings({ simulateAll: false, overrides: { "tel:speed": { generator: { kind: "fixed", value: "x" } } } });
    expect(source.get("tel", "speed")).toMatchObject({ state: "invalid", reason: "parse" });
    source.setSettings({ simulateAll: false, overrides: { "out:steer": { generator: { kind: "fixed", value: 0.5 }, paused: true } } });
    expect(source.get("out", "steer")).toMatchObject({ state: "valid", value: 0.5, paused: true });
  });

  it("signals changes when the preview time advances, only with dynamic simulations", () => {
    const { base, clock, source } = setup();
    let changes = 0;
    source.subscribe(() => changes++);
    source.require("hud", deps);
    source.setSettings({ simulateAll: false, overrides: { "tel:speed": { generator: { kind: "fixed", value: 1 } } } });
    changes = 0;
    expect(base.listenerCount).toBe(0);
    source.setSettings({ simulateAll: false, overrides: { "tel:speed": { generator: { kind: "ramp", from: 0, to: 10, periodS: 10 } } } });
    changes = 0;
    base.frame(1);
    expect(changes).toBe(1);
    expect(source.get("tel", "speed").value).toBe("1");
    clock.pause();
    base.frame(2);
    expect(changes).toBe(1);
  });

  it("without a live source everything not simulated is invalid", () => {
    const source = new PreviewSourceProvider(undefined, new PreviewClock(new TestClock()));
    expect(source.get("tel", "speed")).toMatchObject({ state: "invalid" });
    source.setSettings({ simulateAll: false, overrides: { "tel:speed": { generator: { kind: "fixed", value: 3 } } }, driverActive: true });
    expect(source.metadata("speed")?.dataType).toBe("Number");
    expect(source.get("tel", "speed").value).toBe("3");
    expect(source.driverActiveValue()).toEqual({ state: "valid", value: true });
  });
});

describe("deterministic preview runs", () => {
  const doc: OverlayDocument = {
    schemaVersion: 1,
    workspace: { width: 200, height: 100 },
    elements: {
      e_needle: { type: "rect", props: { rotation: { base: 0, binding: { expr: 'tel("speed") * 3' } } } },
      e_track: { type: "rect", props: { x: { base: 0, rate: { expr: 'tel("speed")', wrap: { min: 0, max: 50 } } } } },
    },
    children: ["e_needle", "e_track"],
  };

  function run() {
    const base = new TestClock();
    const session = new PreviewSession({ clock: base });
    session.setOverride("tel", "speed", { generator: { kind: "ramp", from: 0, to: 20, periodS: 2 } });
    session.enterPreview();
    const dom = new FakeDocument();
    const host = dom.createElementNS("", "g");
    const frames: unknown[] = [];
    const controller = new OverlayController(host, dom, {
      config: effectiveConfig(doc, null), source: session.source, clock: session.clock, mode: "preview", locale: "de",
      onFrame: (f) => frames.push({ t: f.t, n: f.elements.e_needle.props.rotation, x: f.elements.e_track.props.x }),
    });
    base.advance(1, 0.1);
    session.pause();
    session.step(0.25);
    session.step(0.25);
    base.frame(base.now() + 3);
    session.setSpeed(2);
    session.play();
    base.advance(0.5, 0.1);
    controller.dispose();
    session.dispose();
    return frames;
  }

  it("the same steps give the same frames", () => {
    const a = run();
    expect(a).toEqual(run());
    // At preview t = 1 the ramp is at 10 → rotation 30.
    expect(a).toContainEqual(expect.objectContaining({ t: 1, n: 30 }));
    // Paused: the extra base frame repeats t = 1.5.
    expect(a.filter((f) => (f as { t: number }).t === 1.5).length).toBeGreaterThanOrEqual(2);
  });
});
