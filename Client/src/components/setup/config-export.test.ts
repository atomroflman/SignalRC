import { describe, expect, it } from "vitest";
import { configExportFileName, parseConfigFile, planHasChanges, type ImportPlan } from "./config-export";

const plan = (over: Partial<ImportPlan> = {}): ImportPlan => ({
  applied: false, removeMissing: false, sourceCarId: 2, exportedAt: "", audioChanged: false, flowNodesRemoved: 0,
  sections: [{ kind: "controlChannels", added: [], changed: [], unchanged: ["steer"], missing: ["old"] }], ...over,
});

describe("config export/import", () => {
  it("names the file by vehicle and date", () => {
    expect(configExportFileName(2, new Date("2026-11-06T22:10:00Z"))).toBe("signalrc-car-2-config-2026-11-06.json");
  });
  it("accepts only SignalRC vehicle configurations", () => {
    expect(parseConfigFile('{"format":"signalrc-vehicle-config","version":1}')).toEqual({ format: "signalrc-vehicle-config", version: 1 });
    expect(() => parseConfigFile("nope")).toThrow("not JSON");
    expect(() => parseConfigFile('{"format":"x"}')).toThrow("not a SignalRC");
  });
  it("missing channels only count as a change when they are removed", () => {
    expect(planHasChanges(plan())).toBe(false);
    expect(planHasChanges(plan({ removeMissing: true }))).toBe(true);
    expect(planHasChanges(plan({ audioChanged: true }))).toBe(true);
  });
});
