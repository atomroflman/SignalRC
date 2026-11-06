import { describe, expect, it } from "vitest";
import { buildConfigExport, configExportFileName, CONFIG_EXPORT_FORMAT } from "./config-export";

describe("config export", () => {
  const now = new Date("2026-11-06T22:10:00Z");
  it("wraps channel map and audio settings with format and version", () => {
    const map = { controlChannels: { steer: { controlType: "X" } } };
    expect(buildConfigExport(2, map, { volume: 1 }, now)).toEqual({
      format: CONFIG_EXPORT_FORMAT, version: 1, exportedAt: "2026-11-06T22:10:00.000Z", carId: 2,
      channelMap: map, audioSettings: { volume: 1 },
    });
  });
  it("names the file by vehicle and date", () => {
    expect(configExportFileName(2, now)).toBe("signalrc-car-2-config-2026-11-06.json");
  });
});
