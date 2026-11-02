import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_OPTIONS, buildChannelUpdate, parseZoneLimits, readOptions, validateOptions } from "./options";
import { loadGridChannel, saveGridOptions, setupGridSource, type Fetch } from "./api";
import { lidarSourceMessages } from "./messages";

const fixture = JSON.parse(readFileSync(path.resolve(__dirname, "../../../../../Shared/Overlay/fixtures/lidar/cases.json"), "utf8"));

function fakeFetch(responses: Record<string, { status: number; body?: unknown }>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f: Fetch = async (url, init) => {
    calls.push({ url, init });
    const key = `${init?.method ?? "GET"} ${url}`;
    const r = responses[key];
    if (!r) throw new Error(`unexpected ${key}`);
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status });
  };
  return { f, calls };
}

describe("lidar source options", () => {
  it("defaults match the contract fixture", () => {
    const d = fixture.defaultOptions;
    expect(DEFAULT_OPTIONS.mountYawDeg).toBe(d.mountYawDeg);
    expect(DEFAULT_OPTIONS.zoneLimitsMm).toEqual(d.zoneLimitsMm);
    expect(DEFAULT_OPTIONS.neighborMaxMm).toBe(d.neighborMaxMm);
    expect(DEFAULT_OPTIONS.minGroupPoints).toBe(d.minGroupPoints);
    expect(validateOptions({ ...DEFAULT_OPTIONS })).toEqual([]);
  });

  it("reads channel options with defaults for missing or wrong values", () => {
    expect(readOptions(null)).toEqual({ ...DEFAULT_OPTIONS });
    expect(readOptions({ mountYawDeg: 90, zoneLimitsMm: "x", scannerClockwise: false })).toEqual({
      ...DEFAULT_OPTIONS, mountYawDeg: 90, scannerClockwise: false,
    });
  });

  it("validates like the onboard", () => {
    const v = (patch: Partial<typeof DEFAULT_OPTIONS>) => validateOptions({ ...DEFAULT_OPTIONS, ...patch });
    expect(v({ zoneLimitsMm: [500, 1000, 2000, 3000] })).toEqual(["zoneCount"]);
    expect(v({ zoneLimitsMm: [500, 500, 2000, 3000, 5000] })).toEqual(["zoneIncreasing"]);
    expect(v({ zoneLimitsMm: [0, 1000, 2000, 3000, 5000] })).toEqual(["zonePositive"]);
    expect(v({ zoneLimitsMm: [500, 1000, 2000, 3000, 65535] })).toEqual(["zoneMax"]);
    expect(v({ zoneLimitsMm: [1, 2, 3, 4, 65534], mountYawDeg: -725.5 })).toEqual([]);
    expect(v({ neighborMaxMm: 0 })).toEqual(["neighbor"]);
    expect(v({ minGroupPoints: 1441 })).toEqual(["minPoints"]);
    expect(v({ mountYawDeg: NaN })).toEqual(["mountYaw"]);
    expect(parseZoneLimits("500, 1000;2000 3000,5000")).toEqual([500, 1000, 2000, 3000, 5000]);
  });

  it("keeps the channel and unknown options when saving", () => {
    const channel = {
      pinManager: "roofLidar", readIntervalTicks: 2, telemetryType: "SignalRC.Onboard.Telemetry.LidarGridTelemetryReader",
      dataType: 4, options: { groupKey: "lidarGrid", pinManager: "roofLidar", future: 1, scannerClockwise: false },
    };
    const body = buildChannelUpdate(channel, { ...DEFAULT_OPTIONS, mountYawDeg: 180, zoneLimitsMm: [1, 2, 3, 4, 5] });
    expect(body).toMatchObject({ channelName: "lidarGrid", readIntervalTicks: 2, dataType: 4, pinManager: "roofLidar" });
    expect(body.options).toEqual({
      groupKey: "lidarGrid", pinManager: "roofLidar", future: 1,
      mountYawDeg: 180, zoneLimitsMm: [1, 2, 3, 4, 5], neighborMaxMm: 50, minGroupPoints: 3,
    });
    expect(buildChannelUpdate(channel, { ...DEFAULT_OPTIONS, scannerClockwise: false }).options.scannerClockwise).toBe(false);
  });

  it("has every text in both languages", () => {
    const keys = (o: object): string[] => Object.entries(o).flatMap(([k, v]) => typeof v === "object" ? keys(v).map(x => `${k}.${x}`) : [k]);
    expect(keys(lidarSourceMessages.en).sort()).toEqual(keys(lidarSourceMessages.de).sort());
  });
});

describe("lidar source api", () => {
  it("finds the grid channel in the channel map", async () => {
    const { f } = fakeFetch({ "GET /api/cars/3/channels": { status: 200, body: { telemetryChannels: { lidarGrid: { dataType: 4 } } } } });
    expect(await loadGridChannel(3, f)).toEqual({ ok: true, channel: { dataType: 4 } });
    const empty = fakeFetch({ "GET /api/cars/3/channels": { status: 200, body: { telemetryChannels: {} } } });
    expect(await loadGridChannel(3, empty.f)).toEqual({ ok: true, channel: null });
  });

  it("posts the setup action and reports the problem code", async () => {
    const ok = fakeFetch({ "POST /api/cars/3/overlay/lidar-grid-source": { status: 200, body: { created: true } } });
    expect(await setupGridSource(3, ok.f)).toEqual({ ok: true, created: true });
    const denied = fakeFetch({ "POST /api/cars/3/overlay/lidar-grid-source": { status: 403, body: { code: "OVL_API_NOT_DRIVER" } } });
    expect(await setupGridSource(3, denied.f)).toEqual({ ok: false, status: 403, code: "OVL_API_NOT_DRIVER" });
  });

  it("saves through the channel management", async () => {
    const { f, calls } = fakeFetch({ "PUT /api/cars/3/channels/telemetry/lidarGrid": { status: 200, body: {} } });
    expect(await saveGridOptions(3, { options: {} }, { ...DEFAULT_OPTIONS }, f)).toEqual({ ok: true });
    expect(JSON.parse(String(calls[0].init?.body)).options.zoneLimitsMm).toEqual([500, 1000, 2000, 3000, 5000]);
  });
});
