import { describe, expect, it } from "vitest";
import { DeadZoneFunction } from "./DeadZoneFunction";

const dz = new DeadZoneFunction();
const run = (input: number, params: Record<string, any>) => dz.apply({ input }, params)[0] as number;

describe("dead zone", () => {
  it("returns 0 inside the zone and rescales the rest without a jump", () => {
    const p = { deadzone: "0.1", rescale: "1" };
    expect(run(0.05, p)).toBe(0);
    expect(run(-0.1, p)).toBe(0);
    expect(run(0.55, p)).toBeCloseTo(0.5);
    expect(run(-0.55, p)).toBeCloseTo(-0.5);
    expect(run(1, p)).toBeCloseTo(1);
    expect(run(-1, p)).toBeCloseTo(-1);
    expect(run(0.1001, p)).toBeCloseTo(0, 3);
  });

  it("passes the input unchanged outside the zone with rescale 0", () => {
    const p = { deadzone: "0.1", rescale: "0" };
    expect(run(0.05, p)).toBe(0);
    expect(run(0.55, p)).toBe(0.55);
    expect(run(-0.2, p)).toBe(-0.2);
  });

  it("uses the defaults and tolerates bad parameters", () => {
    expect(run(0.04, {})).toBe(0);
    expect(run(1, {})).toBeCloseTo(1);
    expect(run(0.5, { deadzone: "abc" })).toBeCloseTo((0.5 - 0.05) / 0.95);
    expect(run(0.5, { deadzone: "-0.1", rescale: "0" })).toBe(0.5);
    expect(run(0.05, { deadzone: "-0.1" })).toBe(0);
  });
});
