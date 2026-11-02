// Value helpers and the DOM patcher.
import { describe, expect, it } from "vitest";
import { FakeDocument, type FakeNode } from "./testing/fake-dom";
import { mixColor, sampleKeyframes, wrapAngleDelta, wrapRange } from "./values";
import { create, h, patch, toMarkup } from "./vnode";

describe("values", () => {
  it("easing curves: endpoints fixed, easeIn slow start, easeOut fast start, step holds", () => {
    const kf = (easing: "easeIn" | "easeOut" | "easeInOut" | "step") => [{ t: 0, value: 0, easing }, { t: 1, value: 100 }];
    expect(sampleKeyframes(kf("easeIn"), 0, "linear")).toBe(0);
    expect(sampleKeyframes(kf("easeIn"), 1, "linear")).toBe(100);
    expect(sampleKeyframes(kf("easeIn"), 0.25, "linear") as number).toBeLessThan(25);
    expect(sampleKeyframes(kf("easeOut"), 0.25, "linear") as number).toBeGreaterThan(25);
    expect(sampleKeyframes(kf("easeInOut"), 0.5, "linear") as number).toBeCloseTo(50, 9);
    expect(sampleKeyframes(kf("step"), 0.99, "linear")).toBe(0);
  });

  it("step kinds always step; before the first / after the last keyframe the edge value", () => {
    const kf = [{ t: 0.2, value: 1 }, { t: 0.8, value: 3 }];
    expect(sampleKeyframes(kf, 0.5, "step")).toBe(1);
    expect(sampleKeyframes(kf, 0, "linear")).toBe(1);
    expect(sampleKeyframes(kf, 1, "linear")).toBe(3);
  });

  it("colors: per channel, rounded; none is not interpolated", () => {
    expect(mixColor("#00000000", "#ffffffff", 0.5)).toBe("#80808080");
    expect(mixColor("none", "#ffffff", 0.5)).toBe("none");
    expect(mixColor("none", "#ffffff", 1)).toBe("#ffffff");
  });

  it("angle and range wrap", () => {
    expect(wrapAngleDelta(-340)).toBe(20);
    expect(wrapAngleDelta(180)).toBe(-180);
    expect(wrapRange(-15, 0, 40)).toBe(25);
    expect(wrapRange(40, 0, 40)).toBe(0);
  });
});

describe("patch", () => {
  it("updates attributes and text, adds and removes children, replaces on tag change", () => {
    const doc = new FakeDocument();
    const host = doc.createElementNS("", "g");
    const a = h("g", { x: 1, y: 2 }, [h("text", {}, ["a"]), h("rect"), h("circle")]);
    const dom = create(doc, a) as FakeNode;
    host.appendChild(dom);
    const b = h("g", { x: 3 }, [h("text", {}, ["b"]), h("path", { d: "M0 0" })]);
    const next = patch(doc, host, dom, a, b) as FakeNode;
    expect(next).toBe(dom);
    expect(dom.markup).toBe('<g x="3"><text>b</text><path d="M0 0"></path></g>');
    expect(toMarkup(b)).toBe('<g x="3"><text>b</text><path d="M0 0"/></g>');
  });
});
