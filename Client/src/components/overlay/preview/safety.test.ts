// AP11 acceptance: the simulation causes no telemetry writes, no changes of
// personal channel preferences and no vehicle commands, and no simulated
// value reaches the shared live store. Runs against the real AP05 provider on
// a FakeHub that records every invocation.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { effectiveConfig } from "../document";
import type { OverlayDocument } from "../document/types";
import { OverlayController } from "../runtime/controller";
import { FakeDocument } from "../runtime/testing/fake-dom";
import { TestClock } from "../runtime/testing/test-clock";
import { flush, setupSources } from "../sources/testing/setup";
import { PreviewSession } from "./session";

/** Hub methods a preview may cause: demand for the live values it still shows. */
const READ_ONLY = new Set(["UiClientConnected", "SetTelemetryInterest", "SetControlDisplayInterest"]);

const doc: OverlayDocument = {
  schemaVersion: 1,
  workspace: { width: 400, height: 300 },
  elements: {
    e_speed: { type: "valueText", props: { value: { base: null, binding: { expr: 'tel("speed")' } } } },
    e_volt: { type: "valueText", props: { y: 40, value: { base: null, binding: { expr: 'tel("volt")' } } } },
    e_steer: { type: "rect", props: { rotation: { base: 0, binding: { expr: 'out("steering") * 45' } } } },
    e_lidar: { type: "lidarWidget", source: "lidarGrid", props: { x: 200, y: 100, width: 100, height: 100 } },
  },
  children: ["e_speed", "e_volt", "e_steer", "e_lidar"],
};

async function setup() {
  const env = setupSources(
    [
      { id: 11, channelName: "speed", readIntervalTicks: 1, subscribed: true },
      { id: 12, channelName: "volt", readIntervalTicks: 1 },
      { id: 13, channelName: "lidarGrid", dataType: "lidargrid", readIntervalTicks: 2 },
    ],
    [{ id: 5, channelName: "steering" }],
  );
  const car = env.sources.acquire(1);
  const provider = car.provider;
  await flush();
  // A manual bar consumer as in the app: the personal selection is its own consumer.
  const personal = await provider.loadPersonalSelection();
  provider.require("bar", personal.map((name) => ({ kind: "tel" as const, name })));
  env.clock.advance(250);
  await flush();
  env.hub.push("Tlm", 1, 1, 0, [[11, "12.5"], [12, "11.9"]], [], []);

  const base = new TestClock();
  const session = new PreviewSession({ live: provider, clock: base });
  const dom = new FakeDocument();
  const host = dom.createElementNS("", "g");
  const frames: { speed: unknown; steer: unknown; lidar: boolean }[] = [];
  let controller: OverlayController | undefined;
  const open = () => {
    controller = new OverlayController(host, dom, {
      config: effectiveConfig(doc, null), source: session.source, clock: session.clock, mode: "preview", locale: "de",
      onFrame: (f) => frames.push({ speed: f.elements.e_speed.props.value, steer: f.elements.e_steer.props.rotation, lidar: !!f.elements.e_lidar.lidar?.fields.some((x) => x.distanceM !== undefined) }),
    });
  };
  return { env, provider, personal, session, base, frames, open, close: () => controller?.dispose(), car };
}

describe("simulation is local only (AP11 acceptance)", () => {
  it("sends no telemetry, preference or control calls and never writes into the live store", async () => {
    const { env, provider, personal, session, base, frames, open, close, car } = await setup();
    const before = env.hub.invocations.length;
    session.enterPreview();
    session.setOverride("tel", "speed", { generator: { kind: "sine", offset: 50, amplitude: 10, periodS: 2 } });
    session.setOverride("tel", "lidarGrid", { generator: { kind: "lidar", obstacles: [{ angleDeg: 0, widthDeg: 20, distanceMm: 700 }], rotateDegPerS: 30 } });
    session.setOverride("out", "steering", { generator: { kind: "slider", value: 0.5, min: -1, max: 1 }, paused: true });
    session.setDriverActive(true);
    open();
    base.advance(2, 0.1);
    session.pause();
    session.step();
    session.setSpeed(4);
    session.play();
    base.advance(1, 0.1);
    session.setOverride("tel", "speed", { generator: { kind: "fixed", value: 1 }, quality: "stale" });
    session.setSimulateAll(true);
    base.advance(1, 0.1);
    env.clock.advance(1000);
    await flush();

    // Simulated values are displayed …
    expect(frames.some((f) => f.lidar)).toBe(true);
    expect(frames.some((f) => f.steer === 22.5)).toBe(true);
    // … but the shared live store still holds only live values.
    expect(provider.get("tel", "speed")).toMatchObject({ state: "valid", value: "12.5" });
    expect(provider.get("tel", "lidarGrid").state).toBe("invalid");
    expect(provider.driverActive()).toBe(false);

    const calls = env.hub.invocations.slice(before);
    expect(calls.filter((c) => !READ_ONLY.has(c.name))).toEqual([]);
    for (const name of ["UpdateChannel", "UpdateUserChannelValue", "Ctl", "SubscribeToChannel", "UpdateTelemetry", "TelemetryDelta", "AquireCarControl", "ResumeCarControl"]) {
      expect(env.hub.calls(name)).toEqual([]);
    }
    // Simulated out()/sig() need no control display relay.
    expect(env.hub.calls("SetControlDisplayInterest")).toEqual([]);
    // Interest never contains a simulated channel and keeps the bar's channel.
    for (const ids of env.interests()) expect(ids).not.toContain(13);
    expect(env.interests().at(-1)).toEqual([11]);
    // No REST call other than the read-only catalog and the personal selection.
    expect(new Set(env.fetched)).toEqual(new Set(["/api/cars/1/overlay/sources", "/api/car/1/telemetry"]));
    expect(await provider.loadPersonalSelection()).toEqual(personal);

    close();
    session.dispose();
    car.release();
  });

  it("not simulated channels stay live and are requested as preview demand", async () => {
    const { env, session, base, frames, open, close } = await setup();
    session.setOverride("tel", "speed", { generator: { kind: "fixed", value: 77 } });
    session.enterPreview();
    open();
    env.clock.advance(250);
    await flush();
    // speed (bar) and volt (preview, live); lidarGrid live as well, speed is simulated for the preview.
    expect(env.interests().at(-1)).toEqual([11, 12, 13]);
    base.frame(0.1);
    expect(frames.at(-1)!.speed).toBe(77);
    close();
    env.clock.advance(250);
    await flush();
    // Leaving the preview releases its demand; the bar keeps its own.
    expect(env.interests().at(-1)).toEqual([11]);
    session.dispose();
  });

  it("the preview code has no path to hub calls, control flow or persistence", () => {
    const dir = path.dirname(new URL(import.meta.url).pathname);
    for (const file of fs.readdirSync(dir).filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes(".test."))) {
      const text = fs.readFileSync(path.join(dir, file), "utf8");
      expect(text, file).not.toMatch(/\.invoke\(|invokeHub|control-flow-store|onTelemetry\(|onControl\(|saveDraft|patchDraft|fetch\(/);
    }
  });
});
