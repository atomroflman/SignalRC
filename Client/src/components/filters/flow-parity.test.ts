import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { filterFunctionRegistry } from "./filter-function-registry";

// T15 (OnboardFlow-Arbeitspakete.md): the browser functions behave like the onboard
// engine. The same cases run in Tests/SignalRC.Overlay.Tests/Flow/FlowParityTests.cs.
type Case = { name: string; function: string; params: Record<string, string>; steps: { inputs: Record<string, number>; expect: number[] }[] };
const file = path.resolve(__dirname, "../../../../Shared/FlowParity/cases.json");
const cases = (JSON.parse(readFileSync(file, "utf8")) as { cases: Case[] }).cases;

/** Like edgeValue: numeric text as number, other text 0. */
const edge = (raw: unknown) => {
  const v = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(v) ? v : 0;
};

describe("flow function parity with the onboard engine", () => {
  cases.forEach((c, index) => {
    it(c.name, () => {
      const fn = filterFunctionRegistry[c.function as keyof typeof filterFunctionRegistry];
      expect(fn, c.function).toBeDefined();
      // A node id of its own per case: stateful functions keep state per node.
      const nodeId = 900000 + index;
      c.steps.forEach((step, i) => {
        const inputs = Object.fromEntries(fn.inputLabels.map(l => [l, step.inputs[l] ?? 0]));
        const outputs = fn.apply(inputs as any, { ...c.params }, nodeId);
        step.expect.forEach((expected, o) => {
          expect(edge(outputs[o]), `${c.name} step ${i + 1} output ${o}`).toBeCloseTo(expected, 9);
        });
      });
    });
  });

  it("covers every browser function", () => {
    const covered = new Set(cases.map(c => c.function));
    expect(Object.keys(filterFunctionRegistry).filter(n => !covered.has(n))).toEqual([]);
  });
});
