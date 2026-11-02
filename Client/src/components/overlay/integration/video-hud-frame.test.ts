// Regression: the HUD layer starts without a frame (no metadata yet, or the
// layer mounted together with the player) and must appear once the frame is
// there — on reload, after a tab switch and in the editor preview.
import { describe, expect, it } from "vitest";
import { effectiveConfig } from "../document";
import type { OverlayDocument } from "../document/types";
import { OverlayController } from "../runtime/controller";
import { FakeDocument } from "../runtime/testing/fake-dom";
import { TestClock } from "../runtime/testing/test-clock";
import { layerRect, observeVideoFrame, type FrameObserverEnv, type Rect, type VideoGeometry } from "./video-frame";

class Events {
  private readonly listeners = new Map<string, Set<() => void>>();
  addEventListener(type: string, l: () => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(l);
  }
  removeEventListener(type: string, l: () => void) {
    this.listeners.get(type)?.delete(l);
  }
  fire(type: string) {
    for (const l of [...(this.listeners.get(type) ?? [])]) l();
  }
  count() {
    return [...this.listeners.values()].reduce((n, s) => n + s.size, 0);
  }
}

class FakeBox extends Events {
  constructor(public rect: Rect) {
    super();
  }
  getBoundingClientRect() {
    return this.rect;
  }
}

class FakeVideo extends FakeBox {
  videoWidth = 0;
  videoHeight = 0;
}

function fakeEnv() {
  const observers: { cb: () => void; disconnected: boolean }[] = [];
  const win = new Events();
  const doc = new Events();
  const env: FrameObserverEnv = {
    ResizeObserver: class {
      private readonly entry: { cb: () => void; disconnected: boolean };
      constructor(cb: () => void) {
        this.entry = { cb, disconnected: false };
        observers.push(this.entry);
      }
      observe() {}
      disconnect() {
        this.entry.disconnected = true;
      }
    },
    window: win,
    document: doc,
  };
  const resize = () => { for (const o of observers) if (!o.disconnected) o.cb(); };
  return { env, win, doc, resize, observers };
}

const doc: OverlayDocument = {
  schemaVersion: 1,
  workspace: { width: 1280, height: 720 },
  elements: { e_box: { type: "rect", props: { x: 10, y: 10, width: 100, height: 50, fill: "#00ff00" } } },
  children: ["e_box"],
};

describe("HUD layer without a frame at first", () => {
  it("reports no frame before metadata, then the frame when it arrives, and none after emptied", () => {
    const { env } = fakeEnv();
    const container = new FakeBox({ left: 0, top: 0, width: 1000, height: 500 });
    const video = new FakeVideo({ left: 100, top: 0, width: 300, height: 500 });
    const seen: VideoGeometry[] = [];
    const stop = observeVideoFrame(container, video, (g) => seen.push(g), env);
    expect(seen).toHaveLength(1);
    expect(seen[0].frame).toBeNull();
    expect(seen[0].box).toEqual({ width: 1000, height: 500 });

    // Metadata: the element widens to the received aspect ratio.
    video.videoWidth = 1280;
    video.videoHeight = 720;
    video.rect = { left: 55.5, top: 0, width: 889, height: 500 };
    video.fire("loadedmetadata");
    expect(seen.at(-1)!.media).toEqual({ width: 1280, height: 720 });
    expect(seen.at(-1)!.frame!.width).toBeCloseTo(889, 0);
    expect(seen.at(-1)!.frame!.left).toBeCloseTo(55.5, 0);

    video.videoWidth = 0;
    video.videoHeight = 0;
    video.fire("emptied");
    expect(seen.at(-1)!.frame).toBeNull();
    stop();
  });

  it("follows element, window and fullscreen changes and reports only real changes", () => {
    const { env, win, doc: d, resize } = fakeEnv();
    const container = new FakeBox({ left: 0, top: 0, width: 1280, height: 720 });
    const video = new FakeVideo({ left: 0, top: 0, width: 1280, height: 720 });
    video.videoWidth = 1280;
    video.videoHeight = 720;
    const seen: VideoGeometry[] = [];
    observeVideoFrame(container, video, (g) => seen.push(g), env);
    resize();
    win.fire("resize");
    expect(seen).toHaveLength(1);
    container.rect = video.rect = { left: 0, top: 0, width: 1920, height: 1080 };
    d.fire("fullscreenchange");
    expect(seen).toHaveLength(2);
    expect(seen[1].frame).toEqual({ left: 0, top: 0, width: 1920, height: 1080 });
    container.rect = video.rect = { left: 0, top: 0, width: 640, height: 360 };
    resize();
    expect(seen[2].frame!.width).toBe(640);
  });

  it("removes every listener on dispose", () => {
    const { env, win, doc: d, observers } = fakeEnv();
    const video = new FakeVideo({ left: 0, top: 0, width: 10, height: 10 });
    const stop = observeVideoFrame(new FakeBox({ left: 0, top: 0, width: 10, height: 10 }), video, () => {}, env);
    expect(video.count()).toBe(3);
    stop();
    expect(video.count() + win.count() + d.count()).toBe(0);
    expect(observers.every((o) => o.disconnected)).toBe(true);
  });

  it("renders the HUD once the frame is set (session started hidden, without pxPerUnit)", () => {
    const { env } = fakeEnv();
    const container = new FakeBox({ left: 0, top: 0, width: 1000, height: 500 });
    const video = new FakeVideo({ left: 350, top: 0, width: 300, height: 500 });
    const dom = new FakeDocument();
    const host = dom.createElementNS("", "g");
    const clock = new TestClock();
    // Wired like VideoHud: active = visible && frame !== null; pxPerUnit from the laid-out layer.
    const controller = new OverlayController(host, dom, { config: effectiveConfig(doc, null), clock, mode: "live", locale: "de" });
    observeVideoFrame(container, video, (g) => {
      const rect = layerRect(g);
      if (rect) controller.update({ pxPerUnit: Math.min(rect.width / 1280, rect.height / 720) });
      controller.setShown(rect !== null);
    }, env);
    clock.frame(0);
    expect(controller.sessionActive).toBe(false);
    expect(host.byAttr("data-ovl-id", "e_box")).toHaveLength(0);

    video.videoWidth = 1280;
    video.videoHeight = 720;
    video.rect = { left: 55.5, top: 0, width: 889, height: 500 };
    video.fire("loadedmetadata");
    clock.frame(0.1);
    expect(controller.sessionActive).toBe(true);
    expect(host.byAttr("data-ovl-id", "e_box")).toHaveLength(1);
  });

  it("places the layer on the fitted workspace without a frame only when a fallback is given (editor preview)", () => {
    const g: VideoGeometry = { box: { width: 1000, height: 800 }, media: { width: 0, height: 0 }, frame: null };
    expect(layerRect(g)).toBeNull();
    const fitted = layerRect(g, { width: 1920, height: 1080 })!;
    expect(fitted.left).toBeCloseTo(0);
    expect(fitted.top).toBeCloseTo(118.75);
    expect(fitted.width).toBeCloseTo(1000);
    expect(fitted.height).toBeCloseTo(562.5);
    const frame = { left: 1, top: 2, width: 3, height: 4 };
    expect(layerRect({ ...g, frame }, { width: 1920, height: 1080 })).toBe(frame);
  });
});
