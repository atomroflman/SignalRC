// Scene rendering: element types, transform order (README §4), markers
// (runtime §3), assets (svg §5) and the reference documents.
import { describe, expect, it } from "vitest";
import { effectiveConfig } from "../document";
import type { OverlayDocument, OverlayElement } from "../document/types";
import { FakeValueSource } from "../sources/testing/fake-value-source";
import { readContractJson } from "../testing/fixtures";
import { apply, elementMatrix } from "./geometry";
import { createRuntime } from "./runtime";
import { formatValueText, SceneBuilder } from "./scene";
import type { ChannelInfo, RuntimeAsset } from "./types";
import { toMarkup } from "./vnode";

function render(elements: Record<string, OverlayElement>, opts: { source?: FakeValueSource; assets?: Record<string, RuntimeAsset>; pxPerUnit?: number; doc?: Partial<OverlayDocument>; channels?: Record<string, ChannelInfo>; design?: boolean } = {}) {
  const doc: OverlayDocument = {
    schemaVersion: 1,
    workspace: { width: 200, height: 100 },
    elements,
    children: Object.keys(elements).filter((id) => !Object.values(elements).some((e) => e.children?.includes(id))),
    ...opts.doc,
  };
  const config = effectiveConfig(doc, null);
  const rt = createRuntime(config, { channels: (n) => opts.channels?.[n] });
  const frame = opts.design ? rt.baseFrame() : rt.step(0, opts.source ?? new FakeValueSource());
  const scene = new SceneBuilder(config, { locale: "de", pxPerUnit: opts.pxPerUnit ?? 1, idPrefix: "ovl-", assets: opts.assets ?? {} }, rt.staticElements()).build(frame);
  return { frame, scene, markup: toMarkup(scene.tree) };
}

describe("transform order", () => {
  it("translate(x,y) translate(p) rotate scale translate(-p) around the box centre by default", () => {
    const m = elementMatrix(10, 20, 90, 2, 1, 50, 25);
    // The pivot stays in place (shifted by x/y only).
    expect(apply(m, 50, 25).map((v) => Math.round(v * 1e9) / 1e9)).toEqual([60, 45]);
    // Local (100, 25) is 50 right of the pivot: scaled ×2 and rotated 90° clockwise → 100 below.
    expect(apply(m, 100, 25).map((v) => Math.round(v * 1e9) / 1e9)).toEqual([60, 145]);
    const { markup } = render({ e_r: { type: "rect", props: { x: 10, y: 20, width: 100, height: 50, rotation: 90, scaleX: 2 } } });
    expect(markup).toContain('data-ovl-id="e_r" transform="matrix(0 2 -1 0 85 -55)"');
  });

  it("group transforms apply to the whole subtree; the root transform wraps everything", () => {
    const { markup } = render({
      e_g: { type: "group", children: ["e_r"], props: { x: 5, pivotX: 0, pivotY: 0 } },
      e_r: { type: "rect", props: { x: 1, width: 2, height: 2 } },
    }, { doc: { rootTransform: { scale: 0.5, offsetX: 10, offsetY: 0 } } });
    expect(markup).toContain('<g data-ovl-root="" transform="matrix(0.5 0 0 0.5 10 0)"><g data-ovl-id="e_g" transform="translate(5 0)"><g data-ovl-id="e_r" transform="translate(1 0)">');
  });
});

describe("element types", () => {
  it("renders shapes, text, gauges and value texts", () => {
    const source = new FakeValueSource();
    source.set("tel", "v", { state: "valid", value: "12.345" });
    const { markup, scene } = render({
      e_rect: { type: "rect", props: { width: 10, height: 5, cornerRadius: 2, fill: "#ff000080", stroke: "#00ff00", strokeWidth: 2 } },
      e_ell: { type: "ellipse", props: { width: 10, height: 6 } },
      e_line: { type: "line", props: { x2: 10, y2: 10, lineCap: "round" } },
      e_arc: { type: "arc", props: { radius: 10, startAngle: 0, endAngle: 90 } },
      e_text: { type: "text", props: { text: "Hallo", fontFamily: "condensed", align: "middle", fontWeight: "bold" } },
      e_val: { type: "valueText", props: { value: { base: null, binding: { expr: 'tel("v")' } }, prefix: "U=" } },
      e_lin: { type: "linearGauge", props: { width: 100, height: 10, value: 25, tickCount: 3, borderColor: "#ffffff", borderWidth: 1 } },
      e_rad: { type: "radialGauge", props: { radius: 50, value: 50, needle: true, tickCount: 2 } },
    }, { source, channels: { v: { dataType: "Number", unit: "V", decimals: 2 } } });
    expect(scene.diagnostics).toEqual([]);
    expect(markup).toContain('<rect width="10" height="5" rx="2" fill="#ff000080" stroke="#00ff00" stroke-width="2"/>');
    expect(markup).toContain('<ellipse cx="5" cy="3" rx="5" ry="3" fill="#ffffff"/>');
    expect(markup).toContain('<line x1="0" y1="0" x2="10" y2="10" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>');
    expect(markup).toContain('<path d="M10 0A10 10 0 0 1 20 10" fill="none" stroke="#ffffff" stroke-width="6"/>');
    expect(markup).toContain('font-family="sans-serif" font-stretch="condensed" font-size="24" font-weight="bold" text-anchor="middle" fill="#ffffff">Hallo</text>');
    expect(markup).toContain(">U=12,35 V</text>");
    expect(markup).toContain('<rect x="0" y="0" width="25" height="10" fill="#ffffff"/>');
    expect(markup).toContain('stroke="#ff0000"');
  });

  it("valueText formatting per locale; — without value", () => {
    expect(formatValueText({ value: 3.14159, decimals: 2, unit: "°", prefix: "" }, false, "de")).toBe("3,14°");
    expect(formatValueText({ value: 3.5, decimals: undefined, unit: "" }, false, "en")).toBe("3.5");
    expect(formatValueText({ value: 3, decimals: undefined, unit: "" }, false, "de")).toBe("3");
    expect(formatValueText({ value: 3, decimals: 1, unit: "V" }, true, "de")).toBe("— V");
    expect(formatValueText({ value: [{ text: "x=" }, { number: 1.5, decimals: 1 }], unit: "" }, false, "de")).toBe("x=1,5");
  });

  it("invisible elements stay in the DOM with display none", () => {
    const { markup } = render({ e_a: { type: "rect", props: { visible: false } } });
    expect(markup).toContain('data-ovl-id="e_a" display="none"');
  });
});

describe("markers", () => {
  it("invalid: grey symbol at the top right corner, opacity × 0.4, fixed screen size", () => {
    const { markup } = render({ e_a: { type: "rect", props: { x: 10, y: 20, width: 40, height: 10, opacity: 0.5, fill: { base: "#ffffff", binding: { expr: 'tel("gone")' } } } } }, { pxPerUnit: 2 });
    expect(markup).toContain('data-ovl-id="e_a" transform="translate(10 20)" opacity="0.2"');
    expect(markup).toContain('<g data-ovl-marker="invalid" data-ovl-for="e_a" transform="translate(50 20) scale(0.5)">');
  });

  it("unchecked: yellow warning triangle with exclamation mark, element unchanged", () => {
    const source = new FakeValueSource();
    source.set("tel", "v", { state: "unchecked", value: "5" });
    const { markup } = render({ e_a: { type: "rect", props: { x: { base: 0, binding: { expr: 'tel("v")' } } } } }, { source, channels: { v: { dataType: "Number" } } });
    expect(markup).toContain('data-ovl-marker="unchecked"');
    expect(markup).toContain('fill="#ffcc00"');
    expect(markup).not.toContain("opacity=");
  });

  it("paused: pause symbol", () => {
    const source = new FakeValueSource();
    source.set("out", "s", { state: "valid", value: 1, paused: true });
    const { markup } = render({ e_a: { type: "rect", props: { x: { base: 0, binding: { expr: 'out("s")' } } } } }, { source });
    expect(markup).toContain('data-ovl-marker="paused"');
  });

  it("hidden on invalid: no symbol and display none", () => {
    const { markup } = render({ e_a: { type: "rect", onInvalid: "hide", props: { x: { base: 0, binding: { expr: 'tel("gone")' } } } } });
    expect(markup).toContain('display="none"');
    expect(markup).not.toContain("data-ovl-marker=");
  });

  it("design mode draws no markers", () => {
    const { markup } = render({ e_a: { type: "rect", props: { x: { base: 0, binding: { expr: 'tel("gone")' } } } } }, { design: true });
    expect(markup).not.toContain("data-ovl-marker=");
  });
});

describe("svgAsset", () => {
  const asset: RuntimeAsset = {
    svg: '<svg viewBox="0 0 100 100"><defs><linearGradient id="r1"><stop offset="0" stop-color="#ff0000"/></linearGradient></defs><rect data-part="bg" width="100" height="100" fill="url(#r1)"/><path data-part="p_needle" d="M50 50L50 0" stroke="#000000"/></svg>',
    metadata: { width: 100, height: 100, parts: { bg: { tag: "rect", bbox: [0, 0, 100, 100] }, p_needle: { tag: "path", bbox: [50, 0, 0, 50] } } },
  };

  it("embeds the normalized asset with scoped ids and animated parts", () => {
    const source = new FakeValueSource();
    source.set("sig", "steer", { state: "valid", value: 100 });
    const { markup, scene } = render({
      e_logo: { type: "svgAsset", assetId: "sha256-a", parts: { p_needle: { props: { rotation: { base: 0, binding: { expr: 'sig("steer") * 0.9' } }, stroke: "#ff0000" } } } },
    }, { source, assets: { "sha256-a": asset }, doc: { signals: { steer: { label: "Lenkung" } } } });
    expect(scene.diagnostics).toEqual([]);
    expect(markup).toContain('id="ovl-e_logo-r1"');
    expect(markup).toContain('fill="url(#ovl-e_logo-r1)"');
    // Pivot: centre of the part's bbox (50, 25).
    expect(markup).toMatch(/<g data-ovl-part="p_needle" transform="matrix\(0 1 -1 0 75 -25\)"><path data-part="p_needle" d="M50 50L50 0" stroke="#ff0000"\/><\/g>/);
  });

  it("puts interactions of elements and parts into the DOM (D75)", () => {
    const { markup } = render({
      e_horn: { type: "rect", interaction: { input: "horn", kind: "button" }, props: { width: 10, height: 10 } },
      e_logo: { type: "svgAsset", assetId: "sha256-a", parts: { bg: { interaction: { input: "mode", kind: "value", value: 2, public: true } } } },
    }, { assets: { "sha256-a": asset } });
    expect(markup).toContain('data-ovl-id="e_horn" data-ovl-interaction="{&quot;input&quot;:&quot;horn&quot;,&quot;kind&quot;:&quot;button&quot;}">');
    expect(markup).not.toMatch(/data-ovl-id="e_horn"[^>]*data-ovl-public/);
    // A part with only an interaction is wrapped like an animated one, so it is addressable on its own.
    expect(markup).toContain('data-ovl-part="bg" data-ovl-interaction="{&quot;input&quot;:&quot;mode&quot;,&quot;kind&quot;:&quot;value&quot;,&quot;value&quot;:2,&quot;public&quot;:true}" data-ovl-public=""');
  });

  it("recolours the whole asset; none stays none, a part colour wins (svg §5)", () => {
    const beacon: RuntimeAsset = {
      svg: '<svg viewBox="0 0 10 10"><g data-part="lamp" fill="#111111"><circle cx="5" cy="5" r="4" fill="#222222"/><circle cx="5" cy="5" r="1" fill="none" stroke="#333333"/></g><rect data-part="base" width="10" height="2" fill="#444444"/></svg>',
      metadata: { width: 10, height: 10, parts: { lamp: { tag: "g", bbox: [1, 1, 8, 8] }, base: { tag: "rect", bbox: [0, 0, 10, 2] } } },
    };
    const assets = { "sha256-b": beacon };
    const whole = render({ e_b: { type: "svgAsset", assetId: "sha256-b", props: { fill: "#ffaa00" } } }, { assets }).markup;
    expect(whole).toContain('<g fill="#ffaa00"><g data-part="lamp" fill="#ffaa00"><circle cx="5" cy="5" r="4" fill="#ffaa00"/><circle cx="5" cy="5" r="1" fill="none" stroke="#333333"/>');
    expect(whole).toContain('<rect data-part="base" width="10" height="2" fill="#ffaa00"/>');
    // A part colour reaches the shapes inside a group part and is kept under the asset colour.
    const parts = render({
      e_b: { type: "svgAsset", assetId: "sha256-b", props: { fill: "#ffaa00", stroke: "#000000" }, parts: { lamp: { props: { fill: "#ff0000" } } } },
    }, { assets }).markup;
    expect(parts).toContain('<g data-ovl-part="lamp"><g data-part="lamp" fill="#ff0000"><circle cx="5" cy="5" r="4" fill="#ff0000"/><circle cx="5" cy="5" r="1" fill="none" stroke="#333333"/></g></g>');
    expect(parts).toContain('<rect data-part="base" width="10" height="2" fill="#ffaa00"/>');
    // Without a colour the asset is untouched.
    expect(render({ e_b: { type: "svgAsset", assetId: "sha256-b" } }, { assets }).markup).toContain('<circle cx="5" cy="5" r="4" fill="#222222"/>');
  });

  it("two instances of one asset do not share ids", () => {
    const { markup } = render({
      e_a: { type: "svgAsset", assetId: "sha256-a" },
      e_b: { type: "svgAsset", assetId: "sha256-a" },
    }, { assets: { "sha256-a": asset } });
    expect(markup).toContain('id="ovl-e_a-r1"');
    expect(markup).toContain('id="ovl-e_b-r1"');
  });

  it("a missing or broken asset is contained to its element", () => {
    const { markup, scene } = render({
      e_a: { type: "svgAsset", assetId: "sha256-missing" },
      e_b: { type: "svgAsset", assetId: "sha256-bad" },
      e_c: { type: "rect" },
    }, { assets: { "sha256-bad": { svg: "<svg><!DOCTYPE x></svg>" } } });
    expect(scene.diagnostics.map((d) => [d.code, d.location.element])).toEqual([
      ["OVL_REF_UNKNOWN_ASSET", "e_a"], ["OVL_RUNTIME_ASSET_INVALID", "e_b"],
    ]);
    expect(markup).toContain('data-ovl-marker="invalid" data-ovl-for="e_a"');
    expect(markup).toContain('data-ovl-id="e_c"');
  });
});

describe("reference documents", () => {
  const assets: Record<string, RuntimeAsset> = {
    "sha256-0000000000000000000000000000000000000000000000000000000000000001": {
      svg: '<svg viewBox="0 0 200 100"><path data-part="p_needle" d="M100 100L100 10" stroke="#ffffff"/></svg>',
      metadata: { width: 200, height: 100, parts: { p_needle: { tag: "path", bbox: [100, 10, 0, 90] } } },
    },
  };
  const channels: Record<string, ChannelInfo> = {
    odoHeading: { dataType: "Number" }, roll: { dataType: "Number" }, pitch: { dataType: "Number" },
    leftSpeed: { dataType: "Number" }, rightSpeed: { dataType: "Number" }, odoSpeed: { dataType: "Number", unit: "m/s", decimals: 2 },
    batteryVoltage: { dataType: "Number", unit: "V", decimals: 1 }, lidarGrid: { dataType: "LidarGrid" },
  };

  it.each(["reference-r2-typical.json", "m2-value-and-rotation.json", "variants-clips-lidar.json"])("%s renders with live values and no diagnostics", (file) => {
    const doc = readContractJson<OverlayDocument>(`fixtures/documents/valid/${file}`);
    const config = effectiveConfig(doc, null);
    const rt = createRuntime(config, { channels: (n) => channels[n] });
    const source = new FakeValueSource();
    for (const [name, info] of Object.entries(channels)) if (info.dataType === "Number") source.set("tel", name, { state: "valid", value: "10.5" });
    source.set("tel", "lidarGrid", { state: "valid", value: "11s:AQBkAA==" });
    source.set("out", "steering", { state: "valid", value: 0.25 });
    source.set("sig", "steeringRaw", { state: "valid", value: 10 });
    const builder = new SceneBuilder(config, { locale: "de", pxPerUnit: 1, idPrefix: "ovl-", assets }, rt.staticElements());
    let markup = "";
    for (let t = 0; t <= 2; t += 0.1) {
      const frame = rt.step(t, source);
      const scene = builder.build(frame);
      expect([...frame.diagnostics, ...scene.diagnostics]).toEqual([]);
      markup = toMarkup(scene.tree);
    }
    expect(markup).toContain("data-ovl-root");
    expect(markup).not.toContain("NaN");
  });
});
