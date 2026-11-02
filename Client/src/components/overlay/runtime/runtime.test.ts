// Runtime quality rules (runtime §3), conversions, design mode and containment.
import { describe, expect, it } from "vitest";
import { effectiveConfig } from "../document";
import type { Clip, OverlayDocument, OverlayElement } from "../document/types";
import { FakeValueSource } from "../sources/testing/fake-value-source";
import { createRuntime } from "./runtime";
import type { ChannelInfo } from "./types";

const channels: Record<string, ChannelInfo> = {
  speed: { dataType: "Number", unit: "m/s", decimals: 1 },
  count: { dataType: "Integer" },
  on: { dataType: "Boolean" },
  label: { dataType: "String" },
};

function runtimeOf(elements: Record<string, OverlayElement>, clips: Record<string, Clip> = {}, extra: Partial<OverlayDocument> = {}) {
  const doc: OverlayDocument = {
    schemaVersion: 1,
    workspace: { width: 200, height: 100 },
    elements,
    children: Object.keys(elements).filter((id) => !Object.values(elements).some((e) => e.children?.includes(id))),
    clips,
    ...extra,
  };
  return createRuntime(effectiveConfig(doc, null), { channels: (n) => channels[n] });
}

const bound = (expr: string, base: number | string | boolean | null = 0) => ({ base, binding: { expr } });

describe("binding quality", () => {
  it("unchecked values are applied with the warning triangle", () => {
    const rt = runtimeOf({ e_a: { type: "rect", props: { x: bound('tel("speed")') } } });
    const src = new FakeValueSource();
    src.set("tel", "speed", { state: "unchecked", value: "12.5" });
    const f = rt.step(0, src).elements.e_a;
    expect(f.props.x).toBe(12.5);
    expect(f.markers.x).toBe("unchecked");
    expect(f.marker).toBe("unchecked");
    expect(f.hidden).toBe(false);
  });

  it("paused control values animate and only carry the pause marker (D09)", () => {
    const rt = runtimeOf({ e_a: { type: "rect", props: { x: bound('out("steering") * 10') } } });
    const src = new FakeValueSource();
    src.set("out", "steering", { state: "valid", value: 0.5, paused: true });
    const f = rt.step(0, src).elements.e_a;
    expect(f.props.x).toBe(5);
    expect(f.marker).toBe("paused");
  });

  it("invalid > unchecked > paused on one element", () => {
    const rt = runtimeOf({ e_a: { type: "rect", props: {
      x: bound('out("steering")'), y: bound('tel("speed")'), width: bound('tel("missing") + 1', 10),
    } } });
    const src = new FakeValueSource();
    src.set("out", "steering", { state: "valid", value: 1, paused: true });
    src.set("tel", "speed", { state: "unchecked", value: "1" });
    expect(rt.step(0, src).elements.e_a.marker).toBe("invalid");
  });

  it("onInvalid hide hides only on invalid, not on unchecked", () => {
    const rt = runtimeOf({ e_a: { type: "rect", onInvalid: "hide", props: { x: bound('tel("speed")') } } });
    const src = new FakeValueSource();
    src.set("tel", "speed", { state: "unchecked", value: "1" });
    expect(rt.step(0, src).elements.e_a.hidden).toBe(false);
    src.set("tel", "speed", { state: "invalid" });
    expect(rt.step(0.1, src).elements.e_a.hidden).toBe(true);
  });

  it("invalid keeps the last valid value, never an invented zero", () => {
    const rt = runtimeOf({ e_a: { type: "rect", props: { x: bound('tel("speed")', 3) } } });
    const src = new FakeValueSource();
    expect(rt.step(0, src).elements.e_a.props.x).toBe(3);
    src.set("tel", "speed", { state: "valid", value: "8" });
    expect(rt.step(0.1, src).elements.e_a.props.x).toBe(8);
    src.set("tel", "speed", { state: "invalid", reason: "stale" });
    const f = rt.step(0.2, src).elements.e_a;
    expect(f.props.x).toBe(8);
    expect(f.markers.x).toBe("invalid");
  });

  it("valueText shows — without a usable value, also for an unparsable sample", () => {
    const rt = runtimeOf({ e_v: { type: "valueText", props: { value: bound('tel("speed")', null) } } });
    const src = new FakeValueSource();
    let f = rt.step(0, src).elements.e_v;
    expect(f.noValue).toBe(true);
    src.set("tel", "speed", { state: "valid", value: "4.25" });
    f = rt.step(0.1, src).elements.e_v;
    expect(f.noValue).toBe(false);
    expect(f.props.value).toBe(4.25);
    expect(f.props.unit).toBe("m/s");
    expect(f.props.decimals).toBe(1);
    src.set("tel", "speed", { state: "valid", value: "abc" });
    f = rt.step(0.2, src).elements.e_v;
    expect(f.noValue).toBe(true);
    expect(rt.step(0.3, src).diagnostics.map((d) => d.code)).toContain("OVL_EXPR_SOURCE_PARSE");
  });

  it("valueText takes unit and decimals from a signal definition", () => {
    const rt = runtimeOf({ e_v: { type: "valueText", props: { value: bound('sig("steer")', null) } } }, {}, {
      signals: { steer: { label: "Lenkung", unit: "%", decimals: 0 } },
    });
    const src = new FakeValueSource();
    src.set("sig", "steer", { state: "valid", value: 12.4 });
    const f = rt.step(0, src).elements.e_v;
    expect(f.props.unit).toBe("%");
    expect(f.props.decimals).toBe(0);
  });
});

describe("conversion of formula results", () => {
  const src = new FakeValueSource();
  src.set("tel", "speed", { state: "valid", value: "2.5" });
  src.set("tel", "label", { state: "valid", value: "#00ff00" });

  it("opacity is clamped, integers rounded half away from zero", () => {
    const rt = runtimeOf({
      e_a: { type: "rect", props: { opacity: bound('tel("speed")', 1) } },
      e_g: { type: "linearGauge", props: { tickCount: 3, value: bound('tel("speed")') } },
      e_t: { type: "text", props: { text: { base: "", binding: { expr: 'format(tel("speed"), 1)' } } } },
    });
    const f = rt.step(0, src);
    expect(f.elements.e_a.props.opacity).toBe(1);
    expect(f.elements.e_t.props.text).toBe("2,5");
  });

  it("text results are localized per viewer (D48)", () => {
    const rt = runtimeOf({ e_t: { type: "text", props: { text: { base: "", binding: { expr: 'concat("v=", format(tel("speed"), 2))' } } } } });
    expect(rt.step(0, src).elements.e_t.props.text).toBe("v=2,50");
    rt.setLocale("en");
    expect(rt.step(0.1, src).elements.e_t.props.text).toBe("v=2.50");
  });

  it("a valid color text is applied, an invalid one is an invalid graphic state", () => {
    const rt = runtimeOf({
      e_ok: { type: "rect", props: { fill: { base: "#ffffff", binding: { expr: 'tel("label")' } } } },
      e_bad: { type: "rect", props: { fill: { base: "#ffffff", binding: { expr: '"red"' } } } },
    });
    const f = rt.step(0, src);
    expect(f.elements.e_ok.props.fill).toBe("#00ff00");
    expect(f.elements.e_bad.props.fill).toBe("#ffffff");
    expect(f.elements.e_bad.markers.fill).toBe("invalid");
    expect(f.diagnostics.some((d) => d.code === "OVL_RUNTIME_INVALID_VALUE" && d.location.element === "e_bad")).toBe(true);
  });

  it("negative dynamic sizes and inverted gauge ranges are invalid", () => {
    const rt = runtimeOf({
      e_r: { type: "rect", props: { width: bound('0 - tel("speed")', 10) } },
      e_g: { type: "linearGauge", props: { min: 5, max: bound('tel("speed")', 10) } },
    });
    const f = rt.step(0, src);
    expect(f.elements.e_r.props.width).toBe(10);
    expect(f.elements.e_r.marker).toBe("invalid");
    expect(f.elements.e_g.marker).toBe("invalid");
    expect(f.diagnostics.some((d) => d.code === "OVL_RUNTIME_INVALID_GRAPHIC")).toBe(true);
  });

  it("division by zero is contained to its property", () => {
    const rt = runtimeOf({
      e_a: { type: "rect", props: { x: bound('tel("speed") / 0', 1), y: bound('tel("speed")') } },
      e_b: { type: "rect", props: { x: bound('tel("speed") * 2') } },
    });
    const f = rt.step(0, src);
    expect(f.elements.e_a.markers.x).toBe("invalid");
    expect(f.elements.e_a.props.y).toBe(2.5);
    expect(f.elements.e_b.props.x).toBe(5);
    expect(f.elements.e_b.marker).toBeUndefined();
    expect(f.diagnostics.find((d) => d.code === "OVL_EXPR_DIV_ZERO")?.location).toMatchObject({ element: "e_a", property: "x" });
  });

  it("a broken formula is reported and does not affect other elements", () => {
    const rt = runtimeOf({
      e_a: { type: "rect", props: { x: bound("1 +", 4) } },
      e_b: { type: "rect", props: { x: bound('tel("speed")') } },
    });
    const f = rt.step(0, src);
    expect(f.elements.e_a.props.x).toBe(4);
    expect(f.elements.e_a.marker).toBe("invalid");
    expect(f.elements.e_b.props.x).toBe(2.5);
    expect(f.diagnostics.find((d) => d.code === "OVL_EXPR_SYNTAX")?.severity).toBe("error");
  });
});

describe("structure", () => {
  it("lockAspect: scaleY follows scaleX", () => {
    const rt = runtimeOf({ e_g: { type: "group", children: ["e_r"], props: { scaleX: 2 } }, e_r: { type: "rect" } });
    const f = rt.step(0, new FakeValueSource()).elements.e_g;
    expect(f.props.scaleY).toBe(2);
  });

  it("disabled elements are absent and contribute no dependencies", () => {
    const rt = runtimeOf({
      e_a: { type: "rect", disabled: true, props: { x: bound('tel("speed")') } },
      e_b: { type: "rect", props: { x: bound('tel("count")') } },
    });
    expect(rt.step(0, new FakeValueSource()).elements.e_a).toBeUndefined();
    expect(rt.dependencies()).toEqual([{ kind: "tel", name: "count" }]);
  });

  it("collects dependencies of bindings, rates, clip conditions and LiDAR sources", () => {
    const rt = runtimeOf({
      e_a: { type: "rect", props: { x: { base: 0, rate: { expr: 'tel("speed")' } } } },
      e_l: { type: "lidarWidget", source: "lidarGrid" },
    }, { c_a: { durationS: 1, trigger: { mode: "whileTrue", condition: 'tel("on")' }, tracks: [{ element: "e_a", property: "y", keyframes: [{ t: 0, value: 0 }] }] } });
    expect(rt.dependencies()).toEqual(expect.arrayContaining([
      { kind: "tel", name: "speed" }, { kind: "tel", name: "on" }, { kind: "tel", name: "lidarGrid" },
    ]));
    expect(rt.continuous).toBe(true);
  });

  it("only direct bindings without smoothing are event driven; static elements are known", () => {
    const rt = runtimeOf({ e_a: { type: "rect", props: { x: bound('tel("speed")') } }, e_b: { type: "rect", props: { x: 5 } } });
    expect(rt.continuous).toBe(false);
    expect([...rt.staticElements()]).toEqual(["e_b"]);
  });

  it("a second clip on the same property is ignored with a diagnostic", () => {
    const track = { element: "e_a", property: "x", keyframes: [{ t: 0, value: 1 }, { t: 1, value: 2 }] };
    const rt = runtimeOf({ e_a: { type: "rect" } }, {
      c_a: { durationS: 1, trigger: { mode: "auto" }, tracks: [track] },
      c_b: { durationS: 1, trigger: { mode: "auto" }, tracks: [{ ...track, keyframes: [{ t: 0, value: 9 }] }] },
    });
    const f = rt.step(0, new FakeValueSource());
    expect(f.elements.e_a.props.x).toBe(1);
    expect(f.diagnostics.find((d) => d.code === "OVL_CLIP_PROPERTY_CONFLICT")?.location.clip).toBe("c_b");
  });
});

describe("sessions and modes", () => {
  const clip: Clip = { durationS: 2, repeat: "infinite", trigger: { mode: "auto" }, tracks: [{ element: "e_a", property: "x", keyframes: [{ t: 0, value: 0 }, { t: 2, value: 20 }] }] };

  it("a new session restarts clips without catching up the hidden time", () => {
    const rt = runtimeOf({ e_a: { type: "rect" } }, { c_a: clip });
    const src = new FakeValueSource();
    rt.reset(10);
    rt.step(10, src);
    expect(rt.step(11, src).elements.e_a.props.x).toBe(10);
    rt.reset(100);
    expect(rt.step(100, src).elements.e_a.props.x).toBe(0);
    expect(rt.step(100.5, src).elements.e_a.props.x).toBe(5);
  });

  it("rates restart at their base value in a new session", () => {
    const rt = runtimeOf({ e_a: { type: "rect", props: { x: { base: 3, rate: { expr: "10" } } } } });
    const src = new FakeValueSource();
    rt.step(0, src);
    expect(rt.step(0.2, src).elements.e_a.props.x).toBeCloseTo(5);
    rt.reset();
    expect(rt.step(50, src).elements.e_a.props.x).toBe(3);
  });

  it("design mode shows base values; scrubbing sets one clip to τ", () => {
    const rt = runtimeOf({
      e_a: { type: "rect", props: { x: { base: 7, binding: { expr: 'tel("speed")' } } } },
      e_b: { type: "rect", props: { y: 4 } },
    }, { c_a: { ...clip, tracks: [{ element: "e_b", property: "x", keyframes: [{ t: 0, value: 0 }, { t: 2, value: 20 }] }] } });
    let f = rt.baseFrame();
    expect(f.elements.e_a.props.x).toBe(7);
    expect(f.elements.e_a.marker).toBeUndefined();
    expect(f.elements.e_b.props.x).toBe(0);
    f = rt.baseFrame({ clipId: "c_a", tau: 0.5 });
    expect(f.elements.e_b.props.x).toBe(5);
    expect(f.elements.e_a.props.x).toBe(7);
    expect(rt.baseFrame({ clipId: "c_a", tau: 9 }).elements.e_b.props.x).toBe(20);
  });

  it("formulas are re-typed when channel metadata arrives", () => {
    const known: Record<string, ChannelInfo> = {};
    const doc: OverlayDocument = { schemaVersion: 1, workspace: { width: 10, height: 10 }, elements: { e_a: { type: "rect", props: { x: bound('tel("late")') } } }, children: ["e_a"] };
    const rt = createRuntime(effectiveConfig(doc, null), { channels: (n) => known[n] });
    const src = new FakeValueSource();
    src.set("tel", "late", { state: "valid", value: "6" });
    expect(rt.step(0, src).elements.e_a.marker).toBe("invalid");
    expect(rt.refreshChannels()).toBe(false);
    known.late = { dataType: "Number" };
    expect(rt.refreshChannels()).toBe(true);
    const f = rt.step(0.1, src);
    expect(f.elements.e_a.props.x).toBe(6);
    expect(f.diagnostics).toEqual([]);
  });
});
