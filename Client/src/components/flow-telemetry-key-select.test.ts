import { describe, expect, it } from "vitest";
import { flowValueChannels } from "./flow-telemetry-key-select";

describe("flowValueChannels", () => {
  it("lists FlowValueReader channels with their key, sorted, any key casing", () => {
    const map = {
      telemetryChannels: {
        gang: { telemetryType: "FlowValueReader", options: { Key: "gear" } },
        abstand: { telemetryType: "FlowValueReader", options: { key: " distance " } },
        ohneKey: { telemetryType: "FlowValueReader", options: {} },
        lidar: { telemetryType: "LidarTelemetryReader", options: { Key: "x" } },
      },
    };
    expect(flowValueChannels(map)).toEqual([
      { channel: "abstand", key: "distance" },
      { channel: "gang", key: "gear" },
    ]);
    expect(flowValueChannels(null)).toEqual([]);
  });
});
