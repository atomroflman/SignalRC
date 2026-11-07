import { describe, expect, it, vi } from "vitest";
import { flush, setupSources } from "./testing/setup";

const tel = (...names: string[]) => names.map((name) => ({ kind: "tel" as const, name }));

async function start(channels = [
  { id: 11, channelName: "speed", readIntervalTicks: 1 },
  { id: 12, channelName: "volt", readIntervalTicks: 10 },
  { id: 13, channelName: "temp", readIntervalTicks: 1 },
]) {
  const env = setupSources(channels, [{ id: 5, channelName: "steering" }]);
  const car = env.sources.acquire(1);
  await flush();
  return { env, car, provider: car.provider };
}

describe("consumers and interest (telemetry §6)", () => {
  it("sends the union of all consumers as one interest, coalesced to 200 ms", async () => {
    const { env, provider } = await start();
    provider.require("bar", tel("speed"));
    await flush();
    expect(env.interests()).toEqual([[11]]);
    provider.require("hud", tel("speed", "volt"));
    provider.require("preview", tel("temp"));
    await flush();
    expect(env.interests()).toEqual([[11]]);
    env.clock.advance(199);
    await flush();
    expect(env.interests()).toEqual([[11]]);
    env.clock.advance(1);
    await flush();
    expect(env.interests()).toEqual([[11], [11, 12, 13]]);
  });

  it("releasing one consumer leaves the others untouched", async () => {
    const { env, provider } = await start();
    const bar = provider.require("bar", tel("speed", "volt"));
    const hud = provider.require("hud", tel("speed"));
    await flush();
    env.hub.push("Tlm", 1, 1, 0, [[11, "12.5"], [12, "11.9"]], [], []);
    bar.release();
    env.clock.advance(200);
    await flush();
    expect(env.interests().at(-1)).toEqual([11]);
    expect(hud.source.get("tel", "speed")).toMatchObject({ state: "valid", value: "12.5" });
    // Dropped channel is gone from the cache; asking again waits for the snapshot.
    expect(provider.get("tel", "volt").reason).toBe("waiting");
    bar.release(); // idempotent
    expect(hud.source.get("tel", "speed").state).toBe("valid");
  });

  it("manual deselection does not interrupt the HUD", async () => {
    const { env, provider } = await start();
    provider.require("bar", tel("speed"));
    const hud = provider.require("hud", tel("speed"));
    await flush();
    env.hub.push("Tlm", 1, 1, 0, [[11, "3"]], [], []);
    provider.require("bar", []);
    env.clock.advance(300);
    await flush();
    expect(env.interests().at(-1)).toEqual([11]);
    expect(hud.source.get("tel", "speed")).toMatchObject({ state: "valid", value: "3" });
  });

  it("re-registering a consumer id replaces it; the old handle releases nothing", async () => {
    const { env, provider } = await start();
    const first = provider.require("hud", tel("speed"));
    provider.require("hud", tel("volt"));
    first.release();
    env.clock.advance(200);
    await flush();
    expect(env.interests().at(-1)).toEqual([12]);
  });

  it("the last release of the vehicle clears the interest and stops the connection", async () => {
    const { env, car, provider } = await start();
    provider.require("hud", tel("speed"));
    await flush();
    car.release();
    await flush();
    expect(env.interests().at(-1)).toEqual([]);
    expect(env.hub.stopped).toBe(true);
  });
});

describe("channel catalog of a provider kept alive", () => {
  it("a view opening later picks up channels created since, once the catalog is older than 5 s", async () => {
    const { env, provider } = await start();
    expect(provider.channels().map((c) => c.name)).not.toContain("pi.networkTx");
    env.setChannels([{ id: 11, channelName: "speed" }, { id: 14, channelName: "pi.networkTx" }]);

    // Within 5 s a second view reuses the catalog.
    env.clock.advance(1000);
    const early = env.sources.acquire(1);
    await flush();
    expect(provider.channels().map((c) => c.name)).not.toContain("pi.networkTx");
    early.release();

    env.clock.advance(5000);
    const late = env.sources.acquire(1);
    await flush();
    expect(late.provider).toBe(provider);
    expect(provider.channels().map((c) => c.name)).toContain("pi.networkTx");
    expect(provider.metadataLoaded).toBe(true);
  });
});

describe("aging and deadlines", () => {
  it("values age without further messages and listeners hear it", async () => {
    const { env, provider } = await start();
    const hud = provider.require("hud", tel("speed"));
    await flush();
    const listener = vi.fn();
    provider.subscribe(listener);
    env.hub.push("Tlm", 1, 1, 200, [[11, "7"]], [], []);
    listener.mockClear();
    env.clock.advance(800);
    expect(hud.source.get("tel", "speed").state).toBe("valid");
    expect(listener).not.toHaveBeenCalled();
    env.clock.advance(1);
    expect(listener).toHaveBeenCalled();
    expect(hud.source.get("tel", "speed")).toMatchObject({ state: "invalid", reason: "stale", ageMs: 1001 });
  });

  it("a confirmation refreshes the age only", async () => {
    const { env, provider } = await start();
    provider.require("hud", tel("speed"));
    await flush();
    env.hub.push("Tlm", 1, 1, 0, [[11, "7", 1]], [], []);
    env.clock.advance(900);
    env.hub.push("Tlm", 1, 2, 30, [], [11], []);
    env.clock.advance(900);
    expect(provider.get("tel", "speed")).toMatchObject({ state: "unchecked", value: "7", ageMs: 930 });
  });

  it("deadline overrides are per consumer; a source error is not healed by a longer deadline", async () => {
    const { env, provider } = await start();
    const hud = provider.require("hud", tel("speed", "temp"), { staleAfterMs: { speed: 5000, temp: 600000 } });
    const bar = provider.require("bar", tel("speed"));
    await flush();
    env.hub.push("Tlm", 1, 1, 0, [[11, "1"], [13, "40", 3]], [], []);
    env.clock.advance(2000);
    expect(hud.source.get("tel", "speed").state).toBe("valid");
    expect(bar.source.get("tel", "speed").reason).toBe("stale");
    expect(hud.source.get("tel", "temp")).toMatchObject({ state: "invalid", reason: "source-error" });
  });

  it("uses 3 × interval by default (volt reads every second)", async () => {
    const { env, provider } = await start();
    provider.require("hud", tel("volt"));
    await flush();
    env.hub.push("Tlm", 1, 1, 0, [[12, "11.9"]], [], []);
    env.clock.advance(3000);
    expect(provider.get("tel", "volt").state).toBe("valid");
    env.clock.advance(1);
    expect(provider.get("tel", "volt").reason).toBe("stale");
  });
});

describe("order, reconnect, vehicle state", () => {
  it("drops messages with an older seq", async () => {
    const { env, provider } = await start();
    provider.require("hud", tel("speed"));
    await flush();
    env.hub.push("Tlm", 1, 5, 0, [[11, "2"]], [], []);
    env.hub.push("Tlm", 1, 4, 0, [[11, "1"]], [], []);
    env.hub.push("Tlm", 1, 5, 0, [[11, "3"]], [], []);
    expect(provider.get("tel", "speed").value).toBe("2");
  });

  it("is invalid (transport) while reconnecting, then starts over from the snapshot", async () => {
    const { env, provider } = await start();
    provider.require("hud", tel("speed"));
    await flush();
    env.hub.push("Tlm", 1, 50, 0, [[11, "1"]], [], []);
    env.hub.reconnecting();
    expect(provider.get("tel", "speed").reason).toBe("transport");
    env.hub.reconnected();
    await flush();
    expect(env.interests().at(-1)).toEqual([11]);
    expect(env.interests().length).toBe(2);
    expect(provider.get("tel", "speed").reason).toBe("waiting");
    // A restarted server counts seq from the start again.
    env.hub.push("Tlm", 1, 1, 120, [[11, "2", 0, 120]], [], []);
    expect(provider.get("tel", "speed")).toMatchObject({ state: "valid", value: "2", ageMs: 120 });
  });

  it("starts a new connection after the old one closed", async () => {
    const { env, provider } = await start();
    provider.require("hud", tel("speed"));
    await flush();
    const first = env.hub;
    first.close();
    expect(provider.get("tel", "speed").reason).toBe("transport");
    env.clock.advance(1000);
    await flush();
    expect(env.hub).not.toBe(first);
    expect(env.interests().at(-1)).toEqual([11]);
  });

  it("marks values of an offline vehicle", async () => {
    const { env, provider } = await start();
    provider.require("hud", tel("speed"));
    await flush();
    env.hub.push("Tlm", 1, 1, 0, [[11, "1"]], [], []);
    env.hub.push("CarStateUpdated", { id: "1", isConnected: false });
    expect(provider.get("tel", "speed").reason).toBe("vehicle-offline");
    env.hub.push("CarStateUpdated", { id: "1", isConnected: true, driverId: "7" });
    expect(provider.get("tel", "speed").state).toBe("valid");
    expect(provider.driverActive()).toBe(true);
  });

  it("reloads the metadata once for an unknown channel id", async () => {
    const { env, provider } = await start();
    provider.require("hud", tel("speed", "fresh"));
    await flush();
    expect(provider.get("tel", "fresh").reason).toBe("no-data");
    env.setChannels([{ id: 11, channelName: "speed" }, { id: 99, channelName: "fresh" }]);
    env.hub.push("Tlm", 1, 1, 0, [[99, "4"]], [], []);
    await flush();
    env.clock.advance(200);
    await flush();
    expect(env.fetched.filter((u) => u.endsWith("/overlay/sources")).length).toBe(2);
    expect(env.interests().at(-1)).toEqual([11, 99]);
    env.hub.push("Tlm", 1, 2, 0, [[99, "4"]], [], []);
    await flush();
    expect(provider.get("tel", "fresh")).toMatchObject({ state: "valid", value: "4" });
  });

  it("decodes LiDAR grids with their zone limits", async () => {
    const { env, provider } = await start([{ id: 21, channelName: "lidarGrid", dataType: "lidargrid", readIntervalTicks: 2 } as never]);
    provider.require("hud", tel("lidarGrid"));
    await flush();
    env.hub.push("Tlm", 1, 1, 0, [[21, "10s:AQBQANwBUQA="]], [], []);
    const v = provider.lidarGrid("lidarGrid");
    expect(v.state).toBe("valid");
    expect(v.grid?.complete).toBe(false);
    expect(v.grid?.cm[1]).toBe(80);
    expect(v.zoneLimitsMm).toEqual([500, 1000, 2000, 3000, 5000]);
    env.hub.push("Tlm", 1, 2, 0, [[21, "garbage"]], [], []);
    expect(provider.lidarGrid("lidarGrid").reason).toBe("parse");
  });
});

describe("control display, viewer side (telemetry §7)", () => {
  const ctl = (epoch: string, seq: number, paused: boolean, ageMs: number, outputs: [number, number][] = [], signals: [string, number][] = [], ro: number[] = [], rs: string[] = []) =>
    [1, epoch, seq, paused, ageMs, outputs, signals, ro, rs];

  it("asks for the display only while a consumer uses out()/sig()", async () => {
    const { env, provider } = await start();
    const hud = provider.require("hud", [{ kind: "out", name: "steering" }, { kind: "tel", name: "speed" }]);
    await flush();
    expect(env.hub.calls("SetControlDisplayInterest")).toEqual([[1, true]]);
    hud.release();
    await flush();
    expect(env.hub.calls("SetControlDisplayInterest")).toEqual([[1, true], [1, false]]);
  });

  it("evaluates freshness, pause, removal, clearing and epochs", async () => {
    const { env, provider } = await start();
    const hud = provider.require("hud", [{ kind: "out", name: "steering" }, { kind: "sig", name: "gear" }]);
    await flush();
    expect(hud.source.get("sig", "gear").reason).toBe("no-data");
    env.hub.push("Ctl", ...ctl("A", 1, true, 100, [[5, 0.5]], [["gear", 2]]));
    expect(hud.source.get("out", "steering")).toMatchObject({ state: "valid", value: 0.5, paused: true });
    expect(hud.source.get("sig", "gear")).toMatchObject({ state: "valid", value: 2 });
    env.clock.advance(901);
    expect(hud.source.get("sig", "gear").reason).toBe("stale");
    env.hub.push("Ctl", ...ctl("A", 2, false, 0)); // keepalive
    expect(hud.source.get("sig", "gear")).toMatchObject({ state: "valid", paused: false });
    env.hub.push("Ctl", ...ctl("A", 2, true, 0)); // old seq
    expect(hud.source.get("sig", "gear").paused).toBe(false);
    env.hub.push("Ctl", ...ctl("A", 3, false, 0, [], [], [], ["gear"]));
    expect(hud.source.get("sig", "gear").reason).toBe("no-data");
    env.hub.push("CtlCleared", 1, "OLD");
    expect(hud.source.get("out", "steering").state).toBe("valid");
    env.hub.push("CtlCleared", 1, "A");
    expect(hud.source.get("out", "steering").reason).toBe("no-data");
    env.hub.push("Ctl", ...ctl("A", 9, false, 0, [[5, 1]]));
    env.hub.push("Ctl", ...ctl("B", 1, false, 0, [], [["gear", 3]]));
    expect(hud.source.get("out", "steering").reason).toBe("no-data"); // values of the old driver are void
    expect(hud.source.get("sig", "gear").value).toBe(3);
  });

  it("ages without further messages", async () => {
    const { env, provider } = await start();
    provider.require("hud", [{ kind: "sig", name: "gear" }]);
    await flush();
    const listener = vi.fn();
    provider.subscribe(listener);
    env.hub.push("Ctl", ...ctl("A", 1, false, 0, [], [["gear", 1]]));
    listener.mockClear();
    env.clock.advance(1001);
    expect(listener).toHaveBeenCalled();
    expect(provider.get("sig", "gear").reason).toBe("stale");
  });

  it("maps out() names to channel ids from the viewer catalog, without login (D69, D70)", async () => {
    const env = setupSources([{ id: 11, channelName: "speed" }], [{ id: 5, channelName: "steering" }]);
    env.env.signedIn = false;
    const car = env.sources.acquire(1);
    const hud = car.provider.require("hud", [{ kind: "out", name: "steering" }, { kind: "tel", name: "speed" }]);
    await flush();
    expect(env.fetched).toEqual(["/api/cars/1/overlay/sources"]);
    expect(car.provider.metadata("speed")).toMatchObject({ id: 11, dataType: "Number" });
    env.hub.push("Ctl", ...ctl("A", 1, false, 0, [[5, 0.75]]));
    env.hub.push("Tlm", 1, 1, 0, [[11, "3"]], [], []);
    expect(hud.source.get("out", "steering")).toMatchObject({ state: "valid", value: 0.75 });
    expect(hud.source.get("tel", "speed").state).toBe("valid");
    expect(await car.provider.loadPersonalSelection()).toEqual([]);
  });

  it("the driver reads local values and asks the server for nothing", async () => {
    const { env, provider } = await start();
    const local = {
      output: (id: number | undefined) => (id === 5 ? { state: "valid" as const, value: 0.25, paused: false } : { state: "invalid" as const, reason: "no-data" as const }),
      signal: () => ({ state: "valid" as const, value: 4, paused: false }),
      subscribe: () => () => {},
    };
    provider.setLocalControlSource(local);
    provider.require("hud", [{ kind: "out", name: "steering" }]);
    await flush();
    expect(env.hub.calls("SetControlDisplayInterest")).toEqual([]);
    expect(provider.get("out", "steering").value).toBe(0.25);
  });
});
