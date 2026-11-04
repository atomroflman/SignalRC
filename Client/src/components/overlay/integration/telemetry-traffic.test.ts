// Data rates of the diagnostics panel: measuring at the hub protocol, the
// "real" size, the window, and the rows the panel shows.
import { JsonHubProtocol, NullLogger } from "@microsoft/signalr";
import { describe, expect, it } from "vitest";
import { MeteredProtocol, RateWindow, TrafficMeter, utf8Length } from "../sources";
import { flush, setupSources } from "../sources/testing/setup";
import { ManualClock } from "../sources/testing/manual-clock";
import {
  TelemetryDiagnosticsSession, formatBytes, formatPerSecond, savingFactor, serverTrafficRows, serverUnmeasured, type ServerTraffic,
} from "./telemetry-diagnostics";

const RS = "\u001e";
const frame = (target: string, args: unknown[]) => JSON.stringify({ type: 1, target, arguments: args }) + RS;
const tel = (...names: string[]) => names.map((name) => ({ kind: "tel" as const, name }));

async function start() {
  const env = setupSources([
    { id: 11, channelName: "speed", readIntervalTicks: 1 },
    { id: 12, channelName: "volt", readIntervalTicks: 1 },
  ], [{ id: 5, channelName: "steering" }]);
  const car = env.sources.acquire(1);
  await flush();
  const provider = car.provider;
  const protocol = new MeteredProtocol(new JsonHubProtocol(), env.sources.traffic, (t, a) => provider.realSize(t, a));
  return { env, provider, protocol, meter: env.sources.traffic };
}

describe("measuring at the protocol", () => {
  it("counts UTF-8 bytes like TextEncoder", () => {
    for (const s of ["abc", "Größe", "€", "😀x", ""]) expect(utf8Length(s)).toBe(new TextEncoder().encode(s).length);
  });

  it("records nothing while no panel holds the meter, then the exact frame length", async () => {
    const { protocol, meter, env } = await start();
    const tlm = frame("Tlm", [1, 1, 10, [[11, "12.5"]], [], []]);
    protocol.parseMessages(tlm, NullLogger.instance);
    expect(meter.rate("tlm", 1).total.messages).toBe(0);

    const release = meter.activate();
    // Two records in one transport message; the ping is not counted.
    const parsed = protocol.parseMessages(tlm + JSON.stringify({ type: 6 }) + RS + frame("Ctl", [1, "d", 1, false, 0, [[5, 0.5]], [], [], []]), NullLogger.instance);
    expect(parsed).toHaveLength(3);
    expect(meter.rate("tlm", 1).total).toMatchObject({ messages: 1, bytes: utf8Length(tlm) });
    expect(meter.rate("ctl", 1).total.messages).toBe(1);
    release();
    protocol.parseMessages(tlm, NullLogger.instance);
    expect(meter.rate("tlm", 1).total.messages).toBe(1);
    env.clock.advance(1);
  });

  it("'real' is every contained value in full, confirmations with the cached value", async () => {
    const { env, provider } = await start();
    provider.require("hud", tel("speed", "volt"));
    env.clock.advance(200);
    await flush();
    env.hub.push("Tlm", 1, 1, 10, [[11, "12.5"], [12, "11.9", 1]], [], []);
    const real = provider.realSize("Tlm", [1, 2, 20, [], [11], [12, 300]])!;
    expect(real).toBe(JSON.stringify([
      { id: 11, name: "speed", value: "12.5", state: "Valid", ageMs: 20 },
      { id: 12, name: "volt", value: "11.9", state: "Unchecked", ageMs: 300 },
    ]).length);
    // The compact message is much smaller than the full information.
    expect(utf8Length(frame("Tlm", [1, 2, 20, [], [11], [12, 300]]))).toBeLessThan(real);
    const ctl = provider.realSize("Ctl", [1, "d", 1, true, 0, [[5, 0.5]], [["boost", 1]], [], []])!;
    expect(ctl).toBe(JSON.stringify([
      { kind: "out", id: 5, name: "steering", value: 0.5, paused: true, ageMs: 0 },
      { kind: "sig", name: "boost", value: 1, paused: true, ageMs: 0 },
    ]).length);
  });

  it("reports permessage-deflate as negotiated by the WebSocket", () => {
    const meter = new TrafficMeter(new ManualClock());
    expect(meter.compression).toBe("unknown");
    meter.webSocketOpened("");
    expect(meter.compression).toBe("none");
    meter.webSocketOpened("permessage-deflate; client_max_window_bits=15");
    expect(meter.compression).toBe("deflate");
    meter.webSocketClosed();
    expect(meter.compression).toBe("unknown");
  });
});

describe("sliding window", () => {
  it("rates over the last 5 s, shorter right after the start", () => {
    const w = new RateWindow(0);
    for (let t = 0; t < 8000; t += 100) w.add(t, 50, 200);
    const r = w.rate(7999);
    expect(r.perSecond).toBeGreaterThan(9.5);
    expect(r.perSecond).toBeLessThan(10.1);
    expect(r.bytesPerSecond / r.perSecond).toBeCloseTo(50);
    expect(r.total).toEqual({ messages: 80, bytes: 4000, realBytes: 16000 });
    const fresh = new RateWindow(1000);
    fresh.add(1000, 10, 10);
    fresh.add(1500, 10, 10);
    expect(fresh.rate(2000).perSecond).toBe(2);
    expect(fresh.rate(30_000).perSecond).toBe(0);
  });
});

describe("panel rows", () => {
  const server = (inMsgs: number, outMsgs: number, bytes: number | null): ServerTraffic => ({
    windowMs: 5000, measuring: true, measuringSinceAgoMs: 1000,
    incoming: { perSecond: 10, bytesPerSecond: bytes, realBytesPerSecond: bytes && bytes * 4, total: { messages: inMsgs, measuredMessages: 0, bytes: inMsgs * 60, realBytes: inMsgs * 240 } },
    outgoing: { perSecond: 20, bytesPerSecond: bytes, realBytesPerSecond: bytes && bytes * 3, total: { messages: outMsgs, measuredMessages: 0, bytes: outMsgs * 70, realBytes: outMsgs * 210 } },
    clients: [{ perSecond: 15, bytesPerSecond: 900, messages: 300, bytes: 21000 }, { perSecond: 5, bytesPerSecond: 300, messages: 100, bytes: 7000 }],
    incomingMeasure: "messagepack-reserialized", outgoingMeasure: "json-reserialized", compression: "none",
  });

  it("shows client and server side by side, totals since opening", async () => {
    const { env, provider, protocol, meter } = await start();
    const before = frame("Tlm", [1, 1, 0, [[11, "1"]], [], []]);
    const release = meter.activate();
    protocol.parseMessages(before, NullLogger.instance);
    release();

    const session = new TelemetryDiagnosticsSession(provider, meter);
    session.open();
    meter.webSocketOpened("");
    const tlm = frame("Tlm", [1, 2, 0, [[11, "2"]], [], []]);
    protocol.parseMessages(tlm, NullLogger.instance);
    protocol.parseMessages(frame("Tlm", [1, 3, 0, [[11, "3"]], [], []]), NullLogger.instance);
    env.clock.advance(1000);

    const first = session.traffic(server(100, 200, null));
    expect(first.map((r) => r.key)).toEqual(["browserTlm", "browserCtl", "serverIn", "serverOut", "client", "client"]);
    expect(first[0]).toMatchObject({ compression: "none", total: { messages: 2, bytes: 2 * utf8Length(tlm) } });
    // The rate covers the window (incl. the message before opening); the total only since opening.
    expect(first[0].perSecond).toBe(3);
    expect(first[2]).toMatchObject({ perSecond: 10, bytesPerSecond: null, total: { messages: 0 } });
    expect(serverUnmeasured(server(100, 200, null))).toBe(true);

    const later = session.traffic(server(150, 300, 600));
    expect(later[2]).toMatchObject({ bytesPerSecond: 600, realBytesPerSecond: 2400, total: { messages: 50, bytes: 3000, realBytes: 12000 } });
    expect(later[3].total).toEqual({ messages: 100, bytes: 7000, realBytes: 21000 });
    expect(later[4]).toMatchObject({ index: 1, perSecond: 15, bytesPerSecond: 900, total: null });
    expect(serverUnmeasured(server(1, 1, 600))).toBe(false);

    // Closing releases the meter: nothing is measured any more.
    session.close();
    expect(meter.active).toBe(false);
  });

  it("formats rates in readable units", () => {
    expect(formatBytes(512, true)).toBe("512 B/s");
    expect(formatBytes(1530, true)).toBe("1.5 kB/s");
    expect(formatBytes(2_500_000)).toBe("2.50 MB");
    expect(formatBytes(null, true)).toBe("–");
    expect(formatPerSecond(9.44)).toBe("9.4/s");
    expect(formatPerSecond(12.6)).toBe("13/s");
    expect(savingFactor(3200, 1000)).toBe("×3.2");
    expect(savingFactor(null, 1000)).toBe("–");
    expect(serverTrafficRows(server(1, 1, 10)).every((r) => r.compression === "none")).toBe(true);
  });
});
