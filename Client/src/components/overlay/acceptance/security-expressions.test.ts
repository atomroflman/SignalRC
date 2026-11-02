// AP14 – abuse and limits of the expression system across modules. The same
// corpus is checked on the server (SecurityExpressionTests.cs).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyze, evaluate, type AnalysisEnv, type ValueSource } from "../expression";
import { validate } from "../document";
import { expressionAnalyzer } from "../expression";
import type { OverlayDocument } from "../document/types";

interface Case { expr?: string; repeat?: [string, number][]; diagnostics: string[]; runtime?: "invalid" }
const corpus = JSON.parse(readFileSync(path.join(__dirname, "security-expressions.json"), "utf8")) as {
  env: AnalysisEnv;
  cases: Case[];
};
const text = (c: Case) => c.expr ?? c.repeat!.map(([s, n]) => s.repeat(n)).join("");

// Every source lookup is recorded; prototype names must never reach a real object.
const lookups: string[] = [];
const source: ValueSource = {
  get(kind, name) {
    lookups.push(`${kind}:${name}`);
    if (kind === "tel" && name === "speed") return { state: "valid", value: "12.5" };
    if (kind === "tel" && name === "name") return { state: "valid", value: "x" };
    return { state: "invalid" };
  },
  driverActive: () => true,
};

describe("expression abuse corpus (client)", () => {
  it.each(corpus.cases.map((c) => [text(c).slice(0, 40), c] as const))("%s", (_, c) => {
    const expr = text(c);
    const a = analyze(expr, corpus.env, "any");
    expect(a.diagnostics.map((d) => `${d.code}/${d.category}@${d.offset}`)).toEqual(c.diagnostics);
    // Evaluation never throws; formulas with diagnostics are invalid, not partially run.
    const r = evaluate(a, source);
    if (c.diagnostics.length > 0) expect(r.state).toBe("invalid");
    if (c.runtime) {
      expect(r.state).toBe(c.runtime);
      expect(r.value).toBeUndefined();
    }
    if (r.value !== undefined && typeof r.value === "number") expect(Number.isFinite(r.value)).toBe(true);
  });

  it("prototype names are never looked up as functions or resolved as sources", () => {
    lookups.length = 0;
    for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      const a = analyze(`tel("${name}")`, corpus.env, "any");
      expect(a.type).toBe("unknown");
      expect(evaluate(a, source).state).toBe("invalid");
    }
    expect(lookups).toEqual([]);
  });

  it("300 maximum-size formulas analyse and evaluate within a bounded time", () => {
    // Deepest allowed nesting with the longest allowed text (both at the D33 limits).
    const deep = "abs(".repeat(31) + "1" + ")".repeat(31);
    const wide = "max(" + Array.from({ length: 16 }, () => "hypot(sin(tel(\"speed\")),cos(tel(\"speed\")))").join(",") + ")";
    expect(wide.length).toBeLessThanOrEqual(1000);
    const t0 = performance.now();
    for (let i = 0; i < 150; i++) {
      for (const expr of [deep, wide]) {
        const a = analyze(expr, corpus.env, "any");
        expect(a.diagnostics).toEqual([]);
        expect(evaluate(a, source).state).toBe("valid");
      }
    }
    // Generous bound for slow CI machines; a frame budget is 33 ms, measured here is ~a few ms.
    expect(performance.now() - t0).toBeLessThan(2000);
  });

  it("document validation: abusive formulas block publishing but not saving; limit breaches block saving", () => {
    const doc = (expr: string, disabled = false): OverlayDocument => ({
      schemaVersion: 1,
      workspace: { width: 100, height: 100 },
      elements: { e_v: { type: "valueText", ...(disabled ? { disabled: true } : {}), props: { value: { base: null, binding: { expr } } } } },
      children: ["e_v"],
    } as unknown as OverlayDocument);
    const ctx = { sources: { telemetry: { speed: "Number" as const }, outputs: [] }, expressions: expressionAnalyzer };
    const cats = (d: OverlayDocument) => validate(d, ctx).map((x) => `${x.code}/${x.category}`);
    expect(cats(doc("globalThis"))).toContain("OVL_EXPR_SYNTAX/publish");
    // Explicitly disabled parts keep broken formulas as warnings (product rule) …
    expect(cats(doc("globalThis", true))).toEqual(["OVL_EXPR_SYNTAX/warning"]);
    // … but size/depth limits apply to disabled parts too.
    const tooDeep = "abs(".repeat(32) + "1" + ")".repeat(32);
    expect(cats(doc(tooDeep, true))).toContain("OVL_LIMIT_EXCEEDED/structure");
  });
});
