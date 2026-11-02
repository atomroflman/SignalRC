import { afterEach, describe, expect, it } from "vitest";
import { setSharedSourceHub } from "./overlay/sources";
import { flush, setupSources } from "./overlay/sources/testing/setup";
import { useTelemetryStore } from "./telemetry-store";

function setup() {
  const env = setupSources([
    { id: 11, channelName: "speed", subscribed: true },
    { id: 12, channelName: "volt", subscribed: false },
  ]);
  setSharedSourceHub(env.sources);
  return env;
}

afterEach(async () => {
  await useTelemetryStore.getState().disconnect();
  setSharedSourceHub(undefined);
});

describe("manual telemetry bar on the shared sources", () => {
  it("shows the saved selection only and never uses the legacy path", async () => {
    const env = setup();
    await useTelemetryStore.getState().connect(1);
    await flush();
    const s = useTelemetryStore.getState();
    expect([...s.subscribedChannels]).toEqual(["speed"]);
    expect(s.availableChannels.map((c) => c.channelName)).toEqual(["speed", "volt"]);
    expect(env.interests()).toEqual([[11]]);

    const hud = env.sources.acquire(1);
    hud.provider.require("hud", [{ kind: "tel", name: "volt" }]);
    env.clock.advance(200);
    await flush();
    expect(env.interests().at(-1)).toEqual([11, 12]);
    env.hub.push("Tlm", 1, 1, 0, [[11, "5"], [12, "11.9", 1]], [], []);
    expect(useTelemetryStore.getState().entries).toEqual([{ name: "speed", state: "valid", value: "5", reason: undefined }]);
    expect(env.hub.calls("SubscribeToCarTelemetry")).toEqual([]);
    hud.release();
  });

  it("deselecting keeps the HUD running; leaving the bar keeps the saved selection", async () => {
    const env = setup();
    await useTelemetryStore.getState().connect(1);
    await flush();
    const hud = env.sources.acquire(1);
    const req = hud.provider.require("hud", [{ kind: "tel", name: "speed" }]);
    await useTelemetryStore.getState().unsubscribeChannel("speed");
    expect(env.hub.calls("UnsubscribeFromChannel")).toEqual([["1", "speed"]]);
    env.hub.push("Tlm", 1, 1, 0, [[11, "5"]], [], []);
    env.clock.advance(200);
    await flush();
    expect(env.interests().at(-1)).toEqual([11]);
    expect(req.source.get("tel", "speed").value).toBe("5");
    expect(useTelemetryStore.getState().entries).toEqual([]);

    await useTelemetryStore.getState().subscribeChannel("volt");
    expect(env.hub.calls("SubscribeToChannel")).toEqual([["1", "volt"]]);
    await useTelemetryStore.getState().disconnect();
    await flush();
    // No preference is touched by unmounting, and the HUD keeps the connection.
    expect(env.hub.calls("UnsubscribeFromChannel")).toEqual([["1", "speed"]]);
    expect(env.hub.stopped).toBe(false);
    env.clock.advance(200);
    await flush();
    expect(env.interests().at(-1)).toEqual([11]);
    req.release();
    hud.release();
    await flush();
    expect(env.hub.stopped).toBe(true);
  });

  it("marks transport loss and stale values", async () => {
    const env = setup();
    await useTelemetryStore.getState().connect(1);
    await flush();
    env.hub.push("Tlm", 1, 1, 0, [[11, "5"]], [], []);
    env.clock.advance(1001);
    expect(useTelemetryStore.getState().entries[0]).toMatchObject({ state: "invalid", reason: "stale" });
    env.hub.reconnecting();
    expect(useTelemetryStore.getState().isConnected).toBe(false);
    expect(useTelemetryStore.getState().entries[0].reason).toBe("transport");
  });
});
