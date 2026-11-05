import { describe, expect, it } from "vitest";
import { appendSamples, compile, defaultLayout, evaluateSeries, mergeTimes, stats } from "./series";

const types = { volt: "Number", amp: "Number", on: "Boolean", label: "String" } as const;

describe("telemetry history series", () => {
  it("evaluates a formula with step hold over the union of sample times", () => {
    const c = compile('tel("volt") * tel("amp")', { ...types });
    expect(c.error).toBeUndefined();
    expect(c.channels).toEqual(["volt", "amp"]);
    const r = evaluateSeries(c, {
      volt: { t: [0, 200], v: [40, 38] },
      amp: { t: [100, 300], v: [2, 5] },
    }, 3000, { from: 0, to: 300 });
    expect(r.t).toEqual([0, 100, 200, 300]);
    expect(r.v).toEqual([null, 80, 76, 190]);
  });

  it("treats gaps and values older than the hold time as missing", () => {
    const c = compile('tel("volt")', { ...types });
    const r = evaluateSeries(c, { volt: { t: [0, 100, 5000], v: [1, null, 3] }, amp: { t: [4000], v: [0] } }, 3000, { from: 0, to: 5000 });
    expect(r.v).toEqual([1, null, 3]);
    const p = compile('tel("volt") + tel("amp")', { ...types });
    const q = evaluateSeries(p, { volt: { t: [0], v: [1] }, amp: { t: [4000], v: [2] } }, 3000, { from: 0, to: 4000 });
    expect(q.v).toEqual([null, null]);
  });

  it("plots booleans as 0/1 and rejects text, unknown sources and syntax errors", () => {
    const b = compile('tel("volt") > 39', { ...types });
    expect(b.type).toBe("bool");
    expect(evaluateSeries(b, { volt: { t: [0, 1], v: [40, 30] } }, 3000, { from: 0, to: 1 }).v).toEqual([1, 0]);
    expect(compile('tel("label")', { ...types }).error).toBeTruthy();
    expect(compile('tel("nope")', { ...types }).error).toBeTruthy();
    expect(compile('sig("x")', { ...types }).error).toBeTruthy();
    expect(compile("tel(", { ...types }).error).toBeTruthy();
  });

  it("draws a constant formula over the range", () => {
    const c = compile("42", { ...types });
    expect(evaluateSeries(c, {}, 3000, { from: 10, to: 20 })).toEqual({ t: [10, 20], v: [42, 42] });
  });

  it("merges, appends and summarises", () => {
    expect(mergeTimes([[1, 3, 5], [2, 3, 6]])).toEqual([1, 2, 3, 5, 6]);
    const a = appendSamples({ 1: { t: [1, 2], v: [1, 2] } }, { 1: { t: [2, 3], v: [9, 3] }, 2: { t: [5], v: [5] } });
    expect(a[1]).toEqual({ t: [1, 2, 3], v: [1, 2, 3] });
    expect(a[2]).toEqual({ t: [5], v: [5] });
    expect(stats({ t: [1, 2, 3], v: [4, null, -1] })).toEqual({ min: -1, max: 4, last: -1 });
    expect(stats({ t: [1], v: [null] })).toBeUndefined();
  });

  it("groups the default layout by unit", () => {
    const l = defaultLayout([
      { id: 1, name: "volt", dataType: "Number", unit: "V" },
      { id: 2, name: "cell", dataType: "Number", unit: "V" },
      { id: 3, name: "amp", dataType: "Number", unit: "A" },
    ]);
    expect(l.panels.map(p => p.series.map(s => s.expr))).toEqual([['tel("volt")', 'tel("cell")'], ['tel("amp")']]);
  });
});
