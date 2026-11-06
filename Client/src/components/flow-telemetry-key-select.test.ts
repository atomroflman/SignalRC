import { describe, expect, it } from "vitest";
import { flowValueChannels, telemetryChannelNames } from "./flow-telemetry-key-select";

describe("flowValueChannels", () => {
  it("lists FlowValueReader channels with their key, sorted, any key casing", () => {
    const map = {
      telemetryChannels: {
        gang: { telemetryType: "FlowValueReader", options: { Key: "gear" } },
        abstand: { telemetryType: "FlowValueReader", options: { key: " distance " } },
        ohneKey: { telemetryType: "FlowValueReader", options: {} },
        puls: { telemetryType: "SignalRC.Onboard.Telemetry.FlowValueReader", options: { Key: "GamePadPulse" } },
        lidar: { telemetryType: "LidarTelemetryReader", options: { Key: "x" } },
      },
    };
    expect(flowValueChannels(map)).toEqual([
      { channel: "abstand", key: "distance" },
      { channel: "puls", key: "GamePadPulse" },
      { channel: "gang", key: "gear" },
    ]);
    expect(flowValueChannels(null)).toEqual([]);
  });
});

describe("telemetryChannelNames", () => {
  it("lists every telemetry channel, sorted", () => {
    expect(telemetryChannelNames({ telemetryChannels: { lidar: {}, "drive.mode": {}, cpuTemperature: {} } }))
      .toEqual(["cpuTemperature", "drive.mode", "lidar"]);
    expect(telemetryChannelNames(undefined)).toEqual([]);
  });
});
