// Conformance with Shared/Overlay/fixtures/runtime/cases.json: every case is a
// display session; the formula result of each frame is fed through a fake source.
import { describe, expect, it } from "vitest";
import { effectiveConfig } from "../document";
import type { Clip, OverlayDocument, PropertyValue } from "../document/types";
import { FakeValueSource } from "../sources/testing/fake-value-source";
import { readContractJson } from "../testing/fixtures";
import { createRuntime } from "./runtime";
import type { ChannelInfo } from "./types";

interface FormulaResult { state: "valid" | "unchecked" | "invalid"; value?: unknown }
interface Frame {
  t: number;
  condition?: FormulaResult;
  rate?: FormulaResult;
  input?: FormulaResult;
  expect: { value?: unknown; phase?: string; marker?: string };
}
interface Case {
  id: string;
  kind: "clip" | "rate" | "binding";
  base: number;
  propertyKind?: "number" | "angle";
  clip?: Clip;
  rate?: { expr: string; wrap?: { min: number; max: number } };
  smoothing?: { timeConstantS: number };
  frames: Frame[];
}

const { cases } = readContractJson<{ cases: Case[] }>("fixtures/runtime/cases.json");

const channels: Record<string, ChannelInfo> = {
  c: { dataType: "Boolean" },
  r: { dataType: "Number" },
  x: { dataType: "Number" },
};

function setup(c: Case) {
  let property = "x";
  let prop: PropertyValue = c.base;
  const clips: Record<string, Clip> = {};
  if (c.kind === "clip") {
    const clip = structuredClone(c.clip!);
    if (clip.trigger.mode !== "auto") clip.trigger.condition = 'tel("c")';
    property = clip.tracks[0].property;
    if (property === "fill") prop = "#123456";
    clips.c_case = clip;
  } else if (c.kind === "rate") {
    prop = { base: c.base, rate: { ...c.rate!, expr: 'tel("r")' } };
  } else {
    if (c.propertyKind === "angle") property = "rotation";
    prop = { base: c.base, binding: { expr: 'tel("x")', ...(c.smoothing ? { smoothing: c.smoothing } : {}) } };
  }
  const doc: OverlayDocument = {
    schemaVersion: 1,
    workspace: { width: 100, height: 100 },
    elements: { e_a: { type: "rect", props: { [property]: prop } } },
    children: ["e_a"],
    clips,
  };
  const runtime = createRuntime(effectiveConfig(doc, null), { channels: (n) => channels[n] });
  return { runtime, property };
}

function feed(source: FakeValueSource, name: string, r: FormulaResult | undefined) {
  if (!r) return;
  source.set("tel", name, r.state === "invalid" ? { state: "invalid" } : { state: r.state, value: String(r.value) });
}

describe("runtime fixtures", () => {
  for (const c of cases) {
    it(c.id, () => {
      const { runtime, property } = setup(c);
      const source = new FakeValueSource();
      // Frame times are relative to the session start at 0.
      runtime.reset(0);
      for (const f of c.frames) {
        feed(source, "c", f.condition);
        feed(source, "r", f.rate);
        feed(source, "x", f.input);
        const frame = runtime.step(f.t, source);
        const el = frame.elements.e_a;
        const at = `${c.id} @ t=${f.t}`;
        if ("value" in f.expect) {
          const actual = el.props[property];
          if (typeof f.expect.value === "number") expect(actual as number, at).toBeCloseTo(f.expect.value, 9);
          else expect(actual, at).toEqual(f.expect.value);
        }
        if (f.expect.phase) expect(frame.clips.c_case?.phase, at).toBe(f.expect.phase);
        if (f.expect.marker) expect(el.markers[property], at).toBe(f.expect.marker);
      }
    });
  }
});
