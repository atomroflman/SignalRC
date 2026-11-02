import { describe, expect, it } from "vitest";
import { fakeExpressionAnalyzer } from "../testing/fake-expression-analyzer";
import { isSubset, readContractJson } from "../testing/fixtures";
import type { Diagnostic, OverlayDocument, ResolveContext } from "./types";
import { canPublish, canSave, validate } from "./validate";

interface Expected { code: string; category: string; location: Record<string, unknown> }
interface Case { file: string; schemaValid: boolean; diagnostics?: Expected[]; allowExtra?: string[] }
const cases = readContractJson<{ cases: Case[] }>("fixtures/documents/cases.json").cases;
const ctx: ResolveContext = { expressions: fakeExpressionAnalyzer };

const codes = (d: Diagnostic[]) => d.map((x) => x.code);

describe("validate against shared document fixtures", () => {
  it.each(cases.filter((c) => c.schemaValid))("$file", (c) => {
    const doc = readContractJson(`fixtures/documents/${c.file}`);
    const actual = validate(doc, ctx);
    const expected = c.diagnostics ?? [];
    for (const e of expected) {
      const match = actual.find((a) => a.code === e.code && a.category === e.category && isSubset(e.location, a.location));
      expect(match, `${e.code} at ${JSON.stringify(e.location)} in ${JSON.stringify(actual)}`).toBeDefined();
    }
    const extra = actual.filter((a) =>
      !expected.some((e) => a.code === e.code && isSubset(e.location, a.location)) && !(c.allowExtra ?? []).includes(a.code));
    expect(extra).toEqual([]);
  });

  it.each(cases.filter((c) => !c.schemaValid))("$file is rejected structurally", (c) => {
    const d = validate(readContractJson(`fixtures/documents/${c.file}`));
    expect(d.length).toBeGreaterThan(0);
    expect(canSave(d)).toBe(false);
  });
});

function doc(partial: Partial<OverlayDocument>): OverlayDocument {
  return { schemaVersion: 1, workspace: { width: 100, height: 100 }, elements: {}, children: [], ...partial };
}

describe("validate rules beyond the fixtures", () => {
  it("downgrades formula errors in disabled elements to warnings", () => {
    const d = validate(doc({
      elements: { e_a: { type: "valueText", disabled: true, props: { value: { base: null, binding: { expr: 'sig("x")' } } } } },
      children: ["e_a"],
    }), ctx);
    expect(d).toMatchObject([{ code: "OVL_REF_UNKNOWN_SOURCE", category: "warning" }]);
    expect(canPublish(d)).toBe(true);
  });

  it("keeps formula errors active when a variant re-enables the element", () => {
    const d = validate(doc({
      elements: { e_a: { type: "valueText", disabled: true, props: { value: { base: null, binding: { expr: 'sig("x")' } } } } },
      children: ["e_a"],
      variants: { cam: { elements: { e_a: { disabled: false } } } },
    }), ctx);
    expect(d).toMatchObject([{ code: "OVL_REF_UNKNOWN_SOURCE", category: "publish" }]);
  });

  it("treats a disabled vehicle overlay as disabled everywhere", () => {
    const d = validate(doc({
      disabled: true,
      elements: { e_a: { type: "valueText", props: { value: { base: null, binding: { expr: 'sig("x")' } } } } },
      children: ["e_a"],
    }), ctx);
    expect(d.map((x) => x.category)).toEqual(["warning"]);
  });

  it("does not downgrade structure problems in disabled parts", () => {
    const d = validate(doc({ elements: { e_a: { type: "rect", disabled: true, props: { fontSize: 3 } } }, children: ["e_a"] }));
    expect(d).toMatchObject([{ code: "OVL_PROP_UNKNOWN", category: "structure" }]);
  });

  it("warns about orphaned variants only when streams are known", () => {
    const d0 = doc({ variants: { gone: {} } });
    expect(validate(d0)).toEqual([]);
    expect(validate(d0, { streams: ["front"] })).toMatchObject([{ code: "OVL_VARIANT_ORPHANED", category: "warning", location: { variant: "gone" } }]);
  });

  it("reports a variant-only ownership conflict as publish (D38)", () => {
    const d = validate(doc({
      elements: { e_a: { type: "rect" } },
      children: ["e_a"],
      clips: { c_1: { durationS: 1, trigger: { mode: "auto" }, tracks: [{ element: "e_a", property: "x", keyframes: [{ t: 0, value: 0 }] }] } },
      variants: { cam: { elements: { e_a: { props: { x: { base: 0, binding: { expr: "1" } } } } } } },
    }));
    expect(d).toMatchObject([{ code: "OVL_CLIP_PROPERTY_CONFLICT", category: "publish", location: { variant: "cam", clip: "c_1" } }]);
    expect(canSave(d)).toBe(true);
  });

  it("requires added elements to be placed", () => {
    const d = validate(doc({ variants: { cam: { addedElements: { e_x: { type: "rect" } } } } }));
    expect(d).toMatchObject([{ code: "OVL_STRUCT_ORPHAN", location: { variant: "cam", element: "e_x" } }]);
  });

  it("rejects regrouping into a non-group", () => {
    const d = validate(doc({
      elements: { e_a: { type: "rect" }, e_b: { type: "rect" } },
      children: ["e_a", "e_b"],
      variants: { cam: { structure: { parents: { e_a: "e_b" } } } },
    }));
    expect(codes(d)).toEqual(["OVL_STRUCT_NOT_A_GROUP"]);
  });

  it("checks colors, enums and integers of literals", () => {
    const d = validate(doc({
      elements: { e_t: { type: "text", props: { fill: "red", align: "center", fontSize: 0 } }, e_g: { type: "radialGauge", props: { tickCount: 2.5 } } },
      children: ["e_t", "e_g"],
    }));
    expect(d.map((x) => `${x.code}:${x.location.element}.${x.location.property}`).sort()).toEqual([
      "OVL_PROP_OUT_OF_RANGE:e_t.align",
      "OVL_PROP_OUT_OF_RANGE:e_t.fontSize",
      "OVL_PROP_TYPE:e_g.tickCount",
      "OVL_PROP_TYPE:e_t.fill",
    ]);
  });

  it("checks lidar sources and asset references when context is given", () => {
    const d = validate(doc({
      elements: {
        e_l: { type: "lidarWidget", source: "lidarGrid" },
        e_s: { type: "svgAsset", assetId: `sha256-${"0".repeat(64)}`, parts: { p_1: { props: { opacity: 0.5 } } } },
      },
      children: ["e_l", "e_s"],
    }), { sources: { telemetry: { lidarGrid: "String" }, outputs: [] }, assets: {} });
    expect(codes(d).sort()).toEqual(["OVL_REF_UNKNOWN_ASSET", "OVL_REF_UNKNOWN_SOURCE"]);
  });

  it("enforces the element limit per effective view", () => {
    const elements = Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`e_${i}`, { type: "rect" as const }]));
    const d = validate(doc({ elements, children: Object.keys(elements) }));
    expect(d).toMatchObject([{ code: "OVL_LIMIT_EXCEEDED", category: "structure", location: { limit: "elements" } }]);
  });
});
