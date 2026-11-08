// Telemetry diagnostics: text/state/requested filter and column sort of the channel table.
import { describe, expect, it } from "vitest";
import type { ChannelDiagnostics, QualifiedValue } from "../sources";
import { DEFAULT_DIAG_VIEW, filterAndSortRows, type DiagTableView, type DiagnosticsRow } from "./telemetry-diagnostics";

function row(id: number, name: string | undefined, opts: { type?: string; value?: QualifiedValue; arrival?: number; wanted?: boolean; changes?: number; client?: boolean } = {}): DiagnosticsRow {
  const client: ChannelDiagnostics | undefined = opts.client === false ? undefined : {
    id, name, raw: "1", value: opts.value, changes: opts.changes ?? 0, confirmations: 0,
    lastArrival: opts.arrival, wanted: opts.wanted ?? false, sent: false, consumers: [],
  } as ChannelDiagnostics;
  return { id, name, dataType: opts.type, client };
}

const valid = (ageMs: number) => ({ state: "valid", value: 1, ageMs, paused: false }) as unknown as QualifiedValue;
const unchecked = (ageMs: number) => ({ state: "unchecked", value: 1, ageMs, paused: false }) as unknown as QualifiedValue;
const invalid = { state: "invalid", reason: "no-data" } as unknown as QualifiedValue;

const rows = [
  row(3, "speed", { type: "float", value: valid(50), arrival: 300, wanted: true, changes: 5 }),
  row(1, "Volt", { type: "float", value: unchecked(900), arrival: 100, changes: 1 }),
  row(12, "cpuLoad", { type: "int", value: invalid }),
  row(7, "lidarGrid", { type: "lidargrid", value: valid(10), arrival: 200, wanted: true, changes: 9 }),
  row(20, undefined, { client: false }),
];
const ids = (view: Partial<DiagTableView>) => filterAndSortRows(rows, { ...DEFAULT_DIAG_VIEW, ...view }, {}).map((r) => r.id);

describe("filterAndSortRows", () => {
  it("defaults to all channels by id", () => {
    expect(ids({})).toEqual([1, 3, 7, 12, 20]);
  });

  it("matches id, name and type case-insensitively, all terms required", () => {
    expect(ids({ query: "volt" })).toEqual([1]);
    expect(ids({ query: "FLOAT" })).toEqual([1, 3]);
    expect(ids({ query: "12" })).toEqual([12]);
    expect(ids({ query: "float spe" })).toEqual([3]);
    expect(ids({ query: "  " })).toEqual([1, 3, 7, 12, 20]);
  });

  it("filters by state tone; rows without client value count as invalid", () => {
    expect(ids({ state: "valid" })).toEqual([3, 7]);
    expect(ids({ state: "unchecked" })).toEqual([1]);
    expect(ids({ state: "invalid" })).toEqual([12, 20]);
  });

  it("keeps only requested channels", () => {
    expect(ids({ onlyRequested: true })).toEqual([3, 7]);
  });

  it("sorts by name and by state", () => {
    expect(ids({ sort: "name" })).toEqual([12, 7, 3, 1, 20]);
    expect(ids({ sort: "name", desc: true })).toEqual([1, 3, 7, 12, 20]);
    expect(ids({ sort: "state" })).toEqual([12, 20, 1, 3, 7]);
  });

  it("puts rows without a sort value last in both directions", () => {
    expect(ids({ sort: "age" })).toEqual([7, 3, 1, 12, 20]);
    expect(ids({ sort: "age", desc: true })).toEqual([1, 3, 7, 12, 20]);
    expect(ids({ sort: "arrival", desc: true })).toEqual([3, 7, 1, 12, 20]);
    expect(ids({ sort: "counts", desc: true })).toEqual([7, 3, 1, 12, 20]);
  });
});
