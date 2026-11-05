import { describe, expect, it } from "vitest";
import type { ChannelTypeSchema } from "./options-language";
import { suggestTelemetryValue } from "./telemetry-value-hint";

const drive: ChannelTypeSchema = {
  kind: "telemetry", typeName: "SignalRC.Onboard.Telemetry.CanTrackDriveTelemetryReader", options: [],
  values: [
    { key: "leftSpeed", dataType: 2, unit: "rad/s", decimals: 2 },
    { key: "mode", dataType: "String" },
  ],
};
const gpio: ChannelTypeSchema = {
  kind: "telemetry", typeName: "GpioPinReader", options: [],
  values: [{ key: "", dataType: 3 }, { key: "", dataType: 1, decimals: 0, when: "report=Edges" }],
};

describe("telemetry value hints", () => {
  it("matches the full name, then the part after the last dot", () => {
    expect(suggestTelemetryValue(drive, "leftSpeed", "")).toEqual({ dataType: 2, unit: "rad/s", decimals: 2 });
    expect(suggestTelemetryValue(drive, "drive.leftSpeed", "")).toEqual({ dataType: 2, unit: "rad/s", decimals: 2 });
    expect(suggestTelemetryValue(drive, "drive.mode", "")).toEqual({ dataType: 0, unit: "", decimals: null });
    expect(suggestTelemetryValue(drive, "drive.unknown", "")).toBeUndefined();
    expect(suggestTelemetryValue(undefined, "x", "")).toBeUndefined();
  });

  it("uses the hint of the configured option, else the default", () => {
    expect(suggestTelemetryValue(gpio, "door", "")?.dataType).toBe(3);
    expect(suggestTelemetryValue(gpio, "door", '{"report":"Edges"}')).toEqual({ dataType: 1, unit: "", decimals: 0 });
    expect(suggestTelemetryValue(gpio, "door", '{"Report":"edges"}')?.dataType).toBe(1);
    expect(suggestTelemetryValue(gpio, "door", '{"report":"State"}')?.dataType).toBe(3);
    expect(suggestTelemetryValue(gpio, "door", "{broken")?.dataType).toBe(3);
  });
});
