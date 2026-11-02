import { describe, expect, it } from "vitest";
import { ControlDisplayPublisher } from "../sources/control-display";
import { FakeHub } from "../sources/testing/fake-hub";
import { ManualClock } from "../sources/testing/manual-clock";
import { flush } from "../sources/testing/setup";
import { setupSources } from "../sources/testing/setup";
import { HudSignalFunction } from "../../filters/HudSignalFunction";
import {
  ControlDisplayFeed,
  HUD_SIGNAL_FUNCTION,
  bindControlDisplay,
  collectControlDisplay,
  type ControlKey,
  type FlowEdgeLike,
  type FlowNodeLike,
  type FlowSnapshot,
} from "./control-display-binding";

const output = (nodeId: number, channelId: number): FlowNodeLike => ({ nodeId, nodeTypeName: "UserSetupCarChannelNode", representingId: channelId });
const input = (nodeId: number, userChannelId: number): FlowNodeLike => ({ nodeId, nodeTypeName: "UserSetupUserChannelNode", representingId: userChannelId });
const signal = (nodeId: number, name: unknown): FlowNodeLike => ({
  nodeId, nodeTypeName: "UserSetupFunctionNode", metadata: { functionName: HUD_SIGNAL_FUNCTION }, params: { signal: name },
});
const edge = (source: number, target: number, targetPort: string | null = null): FlowEdgeLike => ({ source, target, targetPort });

function snapshot(partial: Partial<FlowSnapshot> = {}): FlowSnapshot {
  return {
    nodes: [input(1, 100), output(2, 11), output(3, 12), signal(4, "throttleRaw")],
    edges: [edge(1, 2, "in"), edge(1, 4, "value")],
    nodeLatestValues: { 1: 0.25, 2: 0.25, 4: 0.25 },
    updatesEnabled: true,
    isInConfigMode: false,
    ...partial,
  };
}

describe("collect control display values (telemetry §7, D36, D37)", () => {
  it("takes computed outputs by CarChannel.Id and HUD signals by name; unfed nodes have no value", () => {
    const v = collectControlDisplay(snapshot());
    expect([...v.outputs]).toEqual([[11, 0.25]]);
    expect([...v.signals]).toEqual([["throttleRaw", 0.25]]);
    expect(v.duplicateSignals).toEqual([]);
  });

  it("a signal mapped by two nodes is not available, a node without name is ignored", () => {
    const v = collectControlDisplay(snapshot({
      nodes: [input(1, 100), signal(4, "gear"), signal(5, " gear "), signal(6, ""), signal(7, 3)],
      edges: [edge(1, 4, "value"), edge(1, 5, "value"), edge(1, 6, "value"), edge(1, 7, "value")],
      nodeLatestValues: { 1: 2, 4: 2, 5: 2, 6: 2, 7: 2 },
    }));
    expect(v.signals.size).toBe(0);
    expect(v.duplicateSignals).toEqual(["gear"]);
  });

  it("drops non-finite values", () => {
    const v = collectControlDisplay(snapshot({ nodeLatestValues: { 2: NaN, 4: Infinity } }));
    expect(v.outputs.size + v.signals.size).toBe(0);
  });

  it("the HUD-Signal node only passes its input through and has no output port", () => {
    const fn = new HudSignalFunction();
    expect(fn.outputLabels).toEqual([]);
    expect(fn.inputLabels).toEqual(["value"]);
    expect(fn.apply({ value: 0.5 })).toEqual([0.5]);
  });
});

describe("control display feed", () => {
  it("applies differences only, removals included, and the pause state", () => {
    const calls: unknown[][] = [];
    const port = {
      setOutput: (...a: unknown[]) => calls.push(["setOutput", ...a]),
      removeOutput: (...a: unknown[]) => calls.push(["removeOutput", ...a]),
      setSignal: (...a: unknown[]) => calls.push(["setSignal", ...a]),
      removeSignal: (...a: unknown[]) => calls.push(["removeSignal", ...a]),
      setPaused: (...a: unknown[]) => calls.push(["setPaused", ...a]),
    };
    const feed = new ControlDisplayFeed(port);
    feed.apply({ outputs: new Map([[11, 1], [12, 2]]), signals: new Map([["a", 1]]) }, false);
    expect(calls).toEqual([["setPaused", false], ["setOutput", 11, 1], ["setOutput", 12, 2], ["setSignal", "a", 1]]);
    calls.length = 0;
    feed.apply({ outputs: new Map([[11, 1], [12, 3]]), signals: new Map() }, false);
    expect(calls).toEqual([["setOutput", 12, 3], ["removeSignal", "a"]]);
    calls.length = 0;
    feed.apply({ outputs: new Map([[12, 3]]), signals: new Map() }, true);
    expect(calls).toEqual([["setPaused", true], ["removeOutput", 11]]);
  });
});

/** A zustand-like store holding the parts the binding reads. */
function fakeStore(initial: FlowSnapshot & ControlKey) {
  let state = initial;
  const listeners = new Set<(s: typeof state) => void>();
  return {
    getState: () => state,
    subscribe: (l: (s: typeof state) => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    set(patch: Partial<typeof state>) {
      state = { ...state, ...patch };
      for (const l of [...listeners]) l(state);
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}

describe("driver binding (D57: the connection that acquired control)", () => {
  function setup() {
    const control = new FakeHub();
    const clock = new ManualClock();
    const local: unknown[] = [];
    const acquired: number[] = [];
    let released = 0;
    const publishers: ControlDisplayPublisher[] = [];
    const store = fakeStore({ ...snapshot(), connection: control, carId: 7, carSession: undefined });
    const stop = bindControlDisplay(store, {
      createPublisher: (hub, carId) => {
        const p = new ControlDisplayPublisher(hub, carId, clock);
        publishers.push(p);
        return p;
      },
      acquireProvider: (carId) => {
        acquired.push(carId);
        return { provider: { setLocalControlSource: (s) => local.push(s) }, release: () => released++ };
      },
    });
    const sent = () => control.calls("Ctl").map((a) => a.slice(1));
    return { control, clock, store, stop, local, acquired, publishers, sent, released: () => released };
  }

  it("does nothing until control is acquired, then publishes on CtlDemand from the controlling connection", async () => {
    const t = setup();
    expect(t.publishers.length).toBe(0);
    t.store.set({ carSession: "sess-1" });
    expect(t.publishers.length).toBe(1);
    expect(t.acquired).toEqual([7]);
    expect(t.local).toEqual([t.publishers[0]]);
    await flush();
    expect(t.sent()).toEqual([]);
    t.control.push("CtlDemand", 7, true);
    await flush();
    expect(t.sent()).toEqual([[1, false, [[11, 0.25]], [["throttleRaw", 0.25]], [], []]]);
    // The driver's own HUD reads the same values locally, with the pause flag.
    expect(t.publishers[0].output(11)).toMatchObject({ state: "valid", value: 0.25, paused: false });
  });

  it("follows flow changes and sends a pause change at once, without touching the flow", async () => {
    const t = setup();
    t.store.set({ carSession: "sess-1" });
    t.control.push("CtlDemand", 7, true);
    await flush();
    const before = t.store.getState();
    t.store.set({ nodeLatestValues: { 1: 0.5, 2: 0.5, 4: 0.5 } });
    t.clock.advance(100);
    await flush();
    expect(t.sent()[1]).toEqual([2, false, [[11, 0.5]], [["throttleRaw", 0.5]], [], []]);
    // Config mode pauses sending to the vehicle; values stay visible, marked paused (D09).
    t.store.set({ isInConfigMode: true, updatesEnabled: false });
    await flush();
    expect(t.sent()[2]).toEqual([3, true, [], [], [], []]);
    expect(t.publishers[0].signal("throttleRaw")).toMatchObject({ state: "valid", paused: true });
    // Reading never invokes control calls on the connection.
    expect(t.control.invocations.every((i) => i.name === "Ctl")).toBe(true);
    expect(before.nodes).toBe(t.store.getState().nodes);
  });

  it("ends on release, removes the local source and starts anew on the next acquisition", async () => {
    const t = setup();
    t.store.set({ carSession: "sess-1" });
    t.control.push("CtlDemand", 7, true);
    await flush();
    t.store.set({ carSession: undefined, connection: undefined });
    expect(t.local).toEqual([t.publishers[0], undefined]);
    expect(t.released()).toBe(1);
    t.control.push("CtlDemand", 7, true);
    t.clock.advance(5000);
    await flush();
    expect(t.sent().length).toBe(1);

    const next = new FakeHub();
    t.store.set({ connection: next, carSession: "sess-2" });
    expect(t.publishers.length).toBe(2);
    next.push("CtlDemand", 7, true);
    await flush();
    expect(next.calls("Ctl").length).toBe(1);
  });

  it("after a reconnect resumes the driver role with the session and publishes again on CtlDemand", async () => {
    const t = setup();
    t.store.set({ carSession: "sess-1" });
    t.control.push("CtlDemand", 7, true);
    await flush();
    expect(t.sent().length).toBe(1);
    t.control.results.ResumeCarControl = true;
    t.control.reconnecting();
    t.control.reconnected();
    await flush();
    expect(t.control.calls("ResumeCarControl")).toEqual([[7, "sess-1"]]);
    // The server's ControlAcquired sends CtlDemand(true) to the new connection: a complete message follows.
    t.control.push("CtlDemand", 7, true);
    await flush();
    expect(t.sent()[1]).toEqual([2, false, [[11, 0.25]], [["throttleRaw", 0.25]], [], []]);
  });

  it("does not resume after release", async () => {
    const t = setup();
    t.store.set({ carSession: "sess-1" });
    t.store.set({ carSession: undefined });
    t.control.reconnected();
    await flush();
    expect(t.control.calls("ResumeCarControl")).toEqual([]);
  });

  it("a vehicle change ends the publisher of the old vehicle", () => {
    const t = setup();
    t.store.set({ carSession: "sess-1" });
    t.store.set({ carId: 8 });
    expect(t.publishers.length).toBe(2);
    expect(t.acquired).toEqual([7, 8]);
    expect(t.released()).toBe(1);
  });

  it("stop unsubscribes and ends", () => {
    const t = setup();
    t.store.set({ carSession: "sess-1" });
    t.stop();
    expect(t.store.listenerCount).toBe(0);
    expect(t.released()).toBe(1);
  });
});

describe("driver HUD reads local values through the shared provider (telemetry §7)", () => {
  it("uses the publisher's values with the pause flag and asks the server for no relay", async () => {
    const env = setupSources([], [{ id: 11, channelName: "steering" }]);
    const store = fakeStore({ ...snapshot(), connection: new FakeHub(), carId: 1, carSession: "s" });
    const stop = bindControlDisplay(store, {
      createPublisher: (hub, carId) => new ControlDisplayPublisher(hub, carId, env.clock),
      acquireProvider: (carId) => env.sources.acquire(carId),
    });
    const car = env.sources.acquire(1);
    const hud = car.provider.require("hud", [{ kind: "out", name: "steering" }]);
    await flush();
    env.clock.advance(1000);
    await flush();
    expect(hud.source.get("out", "steering")).toMatchObject({ state: "valid", value: 0.25, paused: false });
    store.set({ updatesEnabled: false });
    expect(hud.source.get("out", "steering")).toMatchObject({ state: "valid", paused: true });
    expect(env.hubs.flatMap((h) => h.calls("SetControlDisplayInterest"))).toEqual([]);
    stop();
    expect(hud.source.get("out", "steering").state).toBe("invalid");
    hud.release();
    car.release();
  });
});
