// Telemetry diagnostics: LiDAR short info, the provider snapshot, and that the
// panel only reads (no own requirement unless "request all channels").
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { LocaleProvider } from "@/i18n/provider";
import { messagesByLocale } from "@/i18n/translations";
import { LIDAR_FIELDS, decodeLidarGrid, setSharedSourceHub, summarizeLidarGrid } from "../sources";
import { flush, setupSources } from "../sources/testing/setup";
import { integrationMessages } from "./messages";
import {
  ALL_CHANNELS_CONSUMER, TelemetryDiagnosticsSession, diagnosticsRows, fetchServerDebug, formatMs, stateText, truncate,
  type ServerTelemetryDebug,
} from "./telemetry-diagnostics";
import { DiagnosticsView, TelemetryDiagnosticsPanel } from "./telemetry-diagnostics-panel";

const tel = (...names: string[]) => names.map((name) => ({ kind: "tel" as const, name }));

function dense(occupied: number, complete = true): string {
  const bytes = new Uint8Array(LIDAR_FIELDS * 2);
  for (let i = 0; i < LIDAR_FIELDS; i++) {
    const v = i < occupied ? 150 : 0xffff;
    bytes[i * 2] = v & 0xff;
    bytes[i * 2 + 1] = v >> 8;
  }
  return `1${complete ? 1 : 0}d:${btoa(String.fromCharCode(...bytes))}`;
}

function sparse(pairs: [number, number][], complete = false): string {
  const bytes = pairs.flatMap(([i, v]) => [i & 0xff, i >> 8, v & 0xff, v >> 8]);
  return `1${complete ? 1 : 0}s:${btoa(String.fromCharCode(...bytes))}`;
}

const channels = [
  { id: 11, channelName: "speed", readIntervalTicks: 1 },
  { id: 12, channelName: "volt", readIntervalTicks: 1 },
  { id: 21, channelName: "lidarGrid", dataType: "lidargrid", readIntervalTicks: 2 },
];

async function start() {
  const env = setupSources(channels);
  const car = env.sources.acquire(1);
  await flush();
  return { env, car, provider: car.provider };
}

afterEach(() => setSharedSourceHub(undefined));

describe("LiDAR short info", () => {
  it("counts occupied fields of dense and sparse grids like the decoder", () => {
    const d = dense(42);
    expect(summarizeLidarGrid(d)).toEqual({ length: d.length, complete: true, encoding: "dense", occupied: 42 });
    expect(decodeLidarGrid(d)).toBeDefined();
    const s = sparse([[3, 100], [7, 200], [9, 0xffff]]);
    expect(summarizeLidarGrid(s)).toEqual({ length: s.length, complete: false, encoding: "sparse", occupied: 2 });
  });

  it("names the broken rule where the decoder only fails", () => {
    for (const [value, error] of [
      ["garbage", "format"],
      ["11d:AAA", "base64"],
      ["11d:AAAA", "length"],
      [sparse([[5, 1], [5, 2]]), "index"],
      [sparse([[LIDAR_FIELDS, 1]]), "index"],
    ] as const) {
      expect(decodeLidarGrid(value)).toBeUndefined();
      expect(summarizeLidarGrid(value).error).toBe(error);
    }
  });
});

describe("provider diagnostics (additive, AP05)", () => {
  it("reports what is requested, by whom, and what arrived, without any hub call", async () => {
    const { env, provider } = await start();
    provider.require("manual-telemetry-bar", tel("speed"));
    provider.require("hud", tel("speed", "lidarGrid"));
    env.clock.advance(200);
    await flush();
    const grid = dense(5);
    env.hub.push("Tlm", 1, 1, 20, [[11, "12.5"], [21, grid, 1], [12, "11.0"]], [], []);
    env.clock.advance(100);
    env.hub.push("Tlm", 1, 2, 30, [], [11], []);
    env.hub.push("Tlm", 1, 2, 30, [], [11], []);
    env.clock.advance(50);
    const calls = env.hub.invocations.length;

    const d = provider.diagnostics();
    expect(env.hub.invocations.length).toBe(calls);
    expect(d).toMatchObject({ connected: true, metadata: "loaded", wanted: [11, 21], sent: [11, 21] });
    expect(d.stream).toMatchObject({ messages: 2, droppedOldSeq: 1, ignoredChanges: 1, lastSeq: 2, lastAgeMs: 30 });
    expect(d.consumers.map((c) => c.id)).toEqual(["manual-telemetry-bar", "hud"]);

    const speed = d.channels.find((c) => c.id === 11)!;
    expect(speed).toMatchObject({ name: "speed", raw: "12.5", changes: 1, confirmations: 1, wanted: true, sent: true, consumers: ["manual-telemetry-bar", "hud"] });
    expect(speed.value).toMatchObject({ state: "valid", ageMs: 80 });
    expect(d.now - speed.lastArrival!).toBe(50);

    const volt = d.channels.find((c) => c.id === 12)!;
    expect(volt).toMatchObject({ wanted: false, sent: false, changes: 0, consumers: [] });
    expect(volt.raw).toBeUndefined();

    const lidar = d.channels.find((c) => c.id === 21)!;
    expect(lidar.dataType).toBe("LidarGrid");
    expect(lidar.value?.state).toBe("unchecked");
    expect(lidar.lidar).toEqual({ length: grid.length, complete: true, encoding: "dense", occupied: 5 });
  });
});

describe("the panel is a reading consumer", () => {
  it("does not extend the demand by reading; 'all channels' only while switched on and until closed", async () => {
    const { env, provider } = await start();
    provider.require("hud", tel("speed"));
    env.clock.advance(200);
    await flush();
    expect(env.interests()).toEqual([[11]]);

    const session = new TelemetryDiagnosticsSession(provider);
    session.snapshot();
    session.refresh();
    env.clock.advance(500);
    await flush();
    expect(env.interests()).toEqual([[11]]);
    expect(provider.diagnostics().consumers.map((c) => c.id)).toEqual(["hud"]);

    session.setRequestAll(true);
    expect(session.requestingAll).toBe(true);
    env.clock.advance(200);
    await flush();
    expect(env.interests().at(-1)).toEqual([11, 12, 21]);
    expect(provider.diagnostics().consumers.map((c) => c.id)).toContain(ALL_CHANNELS_CONSUMER);

    session.close();
    env.clock.advance(200);
    await flush();
    expect(env.interests().at(-1)).toEqual([11]);
    expect(session.requestingAll).toBe(false);
  });

  it("renders collapsed by default and holds nothing then", async () => {
    const { env } = await start();
    setSharedSourceHub(env.sources);
    const html = renderToStaticMarkup(<LocaleProvider><TelemetryDiagnosticsPanel carId={1} /></LocaleProvider>);
    expect(html).toContain("Telemetrie-Diagnose");
    expect(html).not.toMatch(/<details[^>]*\sopen/);
    expect(html).not.toContain("data-ovl-diagnostics-body");
  });

  it("renders the client table with LiDAR line and server columns", async () => {
    const { env, provider } = await start();
    setSharedSourceHub(env.sources);
    provider.require("hud", tel("lidarGrid"));
    env.clock.advance(200);
    await flush();
    env.hub.push("Tlm", 1, 1, 0, [[21, "1xd:broken"]], [], []);
    const html = renderToStaticMarkup(<DiagnosticsView provider={provider} m={integrationMessages.de.telemetryDiagnostics} />);
    expect(html).toContain('data-ovl-diag-channel="21"');
    expect(html).toContain('data-ovl-diag-lidar-error="format"');
    expect(html).toContain("invalid: nicht lesbar");
  });
});

describe("server state beside the client state", () => {
  const server: ServerTelemetryDebug = {
    carId: 1, onboardConnected: true, epoch: "e", seq: 9, lastMessageAgoMs: 40, acceptedDeltas: 9, droppedOldSeq: 0,
    demand: [11, 99], demandSentAgoMs: 1000, interestedConnections: 1, legacyClients: 0,
    channels: [
      { id: 11, name: "speed", dataType: "Number", value: "1", valueLength: 1, state: "Valid", ageMs: 20, receivedAgoMs: 10, inDemand: true, interested: 1, changes: 3, touches: 4 },
      { id: 99, name: "other", dataType: "String", value: null, inDemand: true, interested: 1, changes: 0, touches: 0 },
    ],
  };

  it("merges rows by channel id", async () => {
    const { provider } = await start();
    const rows = diagnosticsRows(provider.diagnostics(), server);
    expect(rows.map((r) => r.id)).toEqual([11, 12, 21, 99]);
    expect(rows[0].client?.name).toBe("speed");
    expect(rows[0].server?.changes).toBe(3);
    expect(rows[3]).toMatchObject({ name: "other", dataType: "String" });
    expect(rows[3].client).toBeUndefined();
  });

  it("reports the HTTP status of a refused request", async () => {
    const f = (status: number, body?: unknown) => (async () => new Response(JSON.stringify(body ?? {}), { status })) as unknown as typeof fetch;
    expect(await fetchServerDebug(1, f(403))).toEqual({ ok: false, status: 403 });
    expect(await fetchServerDebug(1, f(200, server), () => 5)).toEqual({ ok: true, state: server, loadedAt: 5 });
    expect(await fetchServerDebug(1, (async () => { throw new Error("x"); }) as unknown as typeof fetch)).toEqual({ ok: false, status: 0 });
    expect(integrationMessages.de.telemetryDiagnostics.serverError(403)).toContain("Steuerung");
  });
});

describe("formatting and texts", () => {
  it("formats values, ages and states", () => {
    expect(truncate("x".repeat(50), 10)).toBe("xxxxxxxxxx… (50)");
    expect(formatMs(undefined)).toBe("–");
    expect(formatMs(250)).toBe("250 ms");
    expect(formatMs(2500)).toBe("2.5 s");
    const reasons = integrationMessages.en.telemetryDiagnostics.reasons;
    expect(stateText({ state: "invalid", reason: "stale" }, reasons)).toEqual({ text: "invalid: stale", tone: "invalid" });
    expect(stateText({ state: "unchecked", value: "1" }, reasons).tone).toBe("unchecked");
  });

  it("is registered in messages.overlay with the same keys in both languages", () => {
    const keys = (o: unknown, p = ""): string[] =>
      o && typeof o === "object" ? Object.entries(o).flatMap(([k, v]) => keys(v, p ? `${p}.${k}` : k)).sort() : [p];
    expect(messagesByLocale.de.overlay.telemetryDiagnostics).toBe(integrationMessages.de.telemetryDiagnostics);
    expect(keys(integrationMessages.de.telemetryDiagnostics)).toEqual(keys(integrationMessages.en.telemetryDiagnostics));
  });
});
