import { describe, expect, it } from "vitest";
import { nodeValue, telemetryChannelOf } from "./flow-telemetry";
import { TelemetryFunction, telemetryInputValues, telemetryNumber } from "./filters/TelemetryFunction";

describe("flow telemetry", () => {
  it("turns telemetry text into flow numbers", () => {
    expect(telemetryNumber("1")).toBe(1);
    expect(telemetryNumber("false")).toBe(0);
    expect(telemetryNumber("42.5°C")).toBe(42.5);
    expect(telemetryNumber("n/a")).toBe(0);
  });

  it("treats invalid values as not valid", () => {
    expect(nodeValue({ state: "invalid", reason: "stale" })).toEqual({ value: 0, valid: false });
    expect(nodeValue({ state: "unchecked", value: "1" })).toEqual({ value: 1, valid: true });
  });

  it("reads the channel of Telemetry nodes only", () => {
    expect(telemetryChannelOf({ nodeId: 1, nodeTypeName: "UserSetupFunctionNode", metadata: { functionName: "Telemetry" }, params: { channel: " door " } })).toBe("door");
    expect(telemetryChannelOf({ nodeId: 1, nodeTypeName: "UserSetupFunctionNode", metadata: { functionName: "HudInput" }, params: { channel: "door" } })).toBeUndefined();
  });

  it("outputs the fallback until a valid value arrives", () => {
    const fn = new TelemetryFunction();
    expect(fn.apply({}, { fallback: 0.5 }, 99)).toEqual([0.5, 0]);
    telemetryInputValues.set(99, { value: 1, valid: true });
    expect(fn.apply({}, { fallback: 0.5 }, 99)).toEqual([1, 1]);
    telemetryInputValues.delete(99);
  });
});
