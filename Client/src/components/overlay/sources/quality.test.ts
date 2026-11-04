import { describe, expect, it } from "vitest";
import { decodeLidarGrid, LIDAR_EMPTY, LIDAR_FIELDS, LIDAR_ZONES } from "./lidar-grid";
import { defaultStaleAfterMs, evaluateSample, expiresAt, staleAfterMs, type Sample } from "./quality";
import { readContractJson } from "../testing/fixtures";

const ctx = { connected: true, vehicleOnline: true, now: 1000 };
const sample = (state: number, ageMs = 0, value = "1.5"): Sample => ({ value, state: state as Sample["state"], ageMs, receivedAt: 1000 });

describe("deadlines (D24)", () => {
  it("defaults to 3 × interval, at least 1 s", () => {
    expect(defaultStaleAfterMs({ readIntervalTicks: 1 })).toBe(1000);
    expect(defaultStaleAfterMs({ readIntervalTicks: 5 })).toBe(1500);
    expect(defaultStaleAfterMs({ readIntervalTicks: 10 })).toBe(3000);
    expect(defaultStaleAfterMs({ readIntervalTicks: 0 })).toBe(1000);
  });

  it("uses the HUD override, never below 500 ms", () => {
    expect(staleAfterMs({ readIntervalTicks: 10 }, 700)).toBe(700);
    expect(staleAfterMs({ readIntervalTicks: 1 }, 100)).toBe(500);
    expect(staleAfterMs({ readIntervalTicks: 1 }, undefined)).toBe(1000);
  });
});

describe("evaluation table (telemetry §3)", () => {
  it("valid and unchecked within the deadline", () => {
    expect(evaluateSample(sample(0, 200), 1000, ctx, "Number")).toMatchObject({ state: "valid", value: "1.5", ageMs: 200 });
    expect(evaluateSample(sample(1, 200), 1000, ctx, "Number")).toMatchObject({ state: "unchecked", value: "1.5" });
  });

  it("source states are invalid whatever the deadline", () => {
    for (const [state, reason] of [[2, "stale"], [3, "source-error"], [4, "no-data"]] as const) {
      expect(evaluateSample(sample(state), 600000, ctx, "Number")).toMatchObject({ state: "invalid", reason });
    }
  });

  it("too old, transport, vehicle offline, parse, waiting", () => {
    expect(evaluateSample(sample(0, 1001), 1000, ctx, "Number")).toMatchObject({ state: "invalid", reason: "stale" });
    expect(evaluateSample(sample(0, 1000), 1000, ctx, "Number").state).toBe("valid");
    expect(evaluateSample(sample(0), 1000, { ...ctx, connected: false }, "Number").reason).toBe("transport");
    expect(evaluateSample(sample(0), 1000, { ...ctx, vehicleOnline: false }, "Number").reason).toBe("vehicle-offline");
    expect(evaluateSample(sample(0, 0, "abc"), 1000, ctx, "Number").reason).toBe("parse");
    expect(evaluateSample(sample(0, 0, ""), 1000, ctx, "String").reason).toBe("parse");
    expect(evaluateSample(sample(0, 0, "maybe"), 1000, ctx, "Boolean").reason).toBe("parse");
    expect(evaluateSample(sample(0, 0, "TRUE"), 1000, ctx, "Boolean").state).toBe("valid");
    expect(evaluateSample(undefined, 1000, ctx, "Number").reason).toBe("waiting");
  });

  it("ages with the client clock from the age at reception", () => {
    const s = sample(0, 300);
    expect(evaluateSample(s, 1000, { ...ctx, now: 1700 }, "Number").state).toBe("valid");
    expect(evaluateSample(s, 1000, { ...ctx, now: 1701 }, "Number").reason).toBe("stale");
    expect(expiresAt(s, 1000)).toBe(1700);
    expect(expiresAt(sample(3), 1000)).toBeUndefined();
  });
});

interface WireCase { id: string; fields: { cell: number; zone: number; mm: number }[]; complete: boolean; value: string }

describe("LiDAR grid decoding (LiDAR §5)", () => {
  const { wire } = readContractJson<{ wire: WireCase[] }>("fixtures/lidar/cases.json");

  it.each(wire.map((w) => [w.id, w] as const))("%s", (_id, w) => {
    const grid = decodeLidarGrid(w.value);
    expect(grid).toBeDefined();
    expect(grid!.complete).toBe(w.complete);
    const expected = new Uint16Array(LIDAR_FIELDS).fill(LIDAR_EMPTY);
    for (const f of w.fields) expected[f.cell * LIDAR_ZONES + f.zone] = Math.floor((f.mm + 5) / 10);
    expect([...grid!.cm]).toEqual([...expected]);
  });

  it("rejects malformed values", () => {
    for (const bad of ["", "11s", "21s:", "12s:", "11x:", "11s:AQBkAA", "11s:AQBk", "11d:AQBkAA==", "11s:AQBkAAEAZAA=" /* index not ascending */, "11s:4AFkAA==" /* index 480 */, " 11s:", "{\"v\":1}"]) {
      expect(decodeLidarGrid(bad), bad).toBeUndefined();
    }
  });
});
