// AP14 – telemetry quality across modules: hub messages (Tlm) → AP05 provider
// (quality, aging, transport) → AP08 runtime frame. Covers Alt-Onboard /
// unchecked sources (D71), stale values re-sent without fresh measurement,
// transport loss and SignalR reconnect, and the restart without catching up.
import { describe, expect, it } from "vitest";
import { effectiveConfig } from "../document";
import type { OverlayDocument } from "../document/types";
import { createRuntime } from "../runtime";
import { flush, setupSources } from "../sources/testing/setup";
import { SampleState } from "../sources/types";

const doc: OverlayDocument = {
  schemaVersion: 1,
  workspace: { width: 400, height: 300 },
  elements: {
    e_speed: { type: "valueText", props: { value: { base: null, binding: { expr: 'tel("speed")' } }, decimals: 1 } },
    e_needle: { type: "rect", props: { width: 4, height: 40, rotation: { base: 0, binding: { expr: 'tel("heading")' } } } },
    e_belt: { type: "rect", props: { y: 100, width: 40, height: 8, x: { base: 0, rate: { expr: 'tel("speed") * 10', wrap: { min: 0, max: 1000 } } } } },
  },
  children: ["e_speed", "e_needle", "e_belt"],
};

async function setup() {
  const env = setupSources([
    { id: 11, channelName: "speed", readIntervalTicks: 1 },
    { id: 12, channelName: "heading", readIntervalTicks: 1 },
  ]);
  const car = env.sources.acquire(1);
  await flush();
  const config = effectiveConfig(doc, null);
  const req = car.provider.require("hud", [{ kind: "tel", name: "speed" }, { kind: "tel", name: "heading" }]);
  env.clock.advance(250);
  await flush();
  const runtime = createRuntime(config, { channels: (n) => car.provider.metadata(n) ? { dataType: "Number" } : undefined });
  let seq = 0;
  const tlm = (changed: (number | string)[][], touched: number[] = []) => env.hub.push("Tlm", 1, ++seq, 0, changed, touched, []);
  /** Advances the shared clock and renders one frame at the same time. */
  const frame = (ms = 100) => {
    env.clock.advance(ms);
    return runtime.step(env.clock.now() / 1000, req.source);
  };
  return { env, car, req, runtime, tlm, frame };
}

describe("source quality end to end (telemetry §3, D24, D71)", () => {
  it("valid values drive binding and rate; HUD interest is sent without changing personal selection", async () => {
    const { env, tlm, frame } = await setup();
    expect(env.interests().at(-1)).toEqual([11, 12]);
    tlm([[11, "2", SampleState.Valid], [12, "90", SampleState.Valid]]);
    frame(0);
    const a = frame(100);
    const b = frame(100);
    expect(b.elements.e_speed.props.value).toBe(2);
    expect(b.elements.e_needle.props.rotation).toBe(90);
    expect(b.elements.e_speed.marker).toBeUndefined();
    // 2 * 10 px/s for 0.1 s.
    expect((b.elements.e_belt.props.x as number) - (a.elements.e_belt.props.x as number)).toBeCloseTo(2, 5);
    expect(env.hub.calls("SubscribeToChannel")).toEqual([]);
    expect(env.hub.calls("UnsubscribeFromChannel")).toEqual([]);
  });

  it("Alt-Onboard (unchecked): values and direct bindings follow with the warning, rates hold (D71)", async () => {
    const { tlm, frame } = await setup();
    tlm([[11, "3", SampleState.Unchecked], [12, "45", SampleState.Unchecked]]);
    frame(0);
    const a = frame(100);
    tlm([[11, "4", SampleState.Unchecked], [12, "50", SampleState.Unchecked]]);
    const b = frame(100);
    expect(b.elements.e_speed.props.value).toBe(4);
    expect(b.elements.e_speed.marker).toBe("unchecked");
    expect(b.elements.e_needle.props.rotation).toBe(50);
    expect(b.elements.e_needle.marker).toBe("unchecked");
    expect(b.elements.e_belt.props.x).toBe(a.elements.e_belt.props.x);
  });

  it("re-sent old measurements do not become fresh; source errors are not healed; graphics hold the last valid value", async () => {
    const { tlm, frame } = await setup();
    tlm([[11, "5", SampleState.Valid], [12, "10", SampleState.Valid]]);
    frame(0);
    frame(100);
    // The onboard keeps re-sending the cached value with its growing age (ageMs field).
    for (let i = 0; i < 5; i++) {
      tlm([[11, "5", SampleState.Valid, 1500 + i * 500], [12, "10", SampleState.Valid, 1500 + i * 500]]);
      frame(500);
    }
    const f = frame(100);
    expect(f.elements.e_speed.noValue).toBe(true);
    expect(f.elements.e_speed.marker).toBe("invalid");
    // The needle holds the last valid position and is marked; the belt stops.
    expect(f.elements.e_needle.props.rotation).toBe(10);
    expect(f.elements.e_needle.marker).toBe("invalid");
    const g = frame(100);
    expect(g.elements.e_belt.props.x).toBe(f.elements.e_belt.props.x);

    // An explicit sensor error stays invalid whatever deadline the HUD sets.
    tlm([[11, "5", SampleState.Error], [12, "11", SampleState.Valid]]);
    const h = frame(50);
    expect(h.elements.e_speed.noValue).toBe(true);
    expect(h.elements.e_needle.props.rotation).toBe(11);
  });

  it("a never measured value is no invented zero", async () => {
    const { frame } = await setup();
    const f = frame(0);
    expect(f.elements.e_speed.noValue).toBe(true);
    expect(f.elements.e_needle.marker).toBe("invalid");
    expect(f.elements.e_belt.props.x).toBe(0);
  });

  it("transport loss marks values invalid; after the reconnect values come back from the snapshot without catching up", async () => {
    const { env, tlm, frame } = await setup();
    tlm([[11, "1", SampleState.Valid], [12, "20", SampleState.Valid]]);
    frame(0);
    frame(100);
    const hub = env.hub;
    hub.reconnecting();
    const lost = frame(100);
    expect(lost.elements.e_speed.noValue).toBe(true);
    const x0 = lost.elements.e_belt.props.x as number;
    // A long outage …
    frame(10_000);
    hub.reconnected();
    env.clock.advance(250);
    await flush();
    // … the provider registers its interest again on the new connection.
    expect(hub.calls("SetTelemetryInterest").length).toBeGreaterThanOrEqual(2);
    tlm([[11, "1", SampleState.Valid], [12, "20", SampleState.Valid]]);
    const back = frame(100);
    expect(back.elements.e_speed.props.value).toBe(1);
    // The belt does not jump by 10 s worth of movement (no catching up, runtime §2).
    expect(Math.abs((back.elements.e_belt.props.x as number) - x0)).toBeLessThan(5);
  });
});
