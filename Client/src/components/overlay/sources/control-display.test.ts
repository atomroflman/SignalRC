import { describe, expect, it } from "vitest";
import { ControlDisplayPublisher, round6 } from "./control-display";
import { FakeHub } from "./testing/fake-hub";
import { ManualClock } from "./testing/manual-clock";
import { flush } from "./testing/setup";

function setup() {
  const hub = new FakeHub();
  const clock = new ManualClock();
  const pub = new ControlDisplayPublisher(hub, 1, clock);
  // [seq, paused, outputs, signals, removedOutputs, removedSignals]
  const sent = () => hub.calls("Ctl").map((a) => a.slice(1));
  return { hub, clock, pub, sent };
}

describe("control display publisher (driver, telemetry §7)", () => {
  it("sends nothing without demand", async () => {
    const { clock, pub, sent } = setup();
    pub.setOutput(5, 0.5);
    pub.setSignal("gear", 2);
    clock.advance(5000);
    await flush();
    expect(sent()).toEqual([]);
  });

  it("is complete after CtlDemand(true), then only changes at most every 100 ms", async () => {
    const { hub, clock, pub, sent } = setup();
    pub.setOutput(5, 0.5);
    pub.setSignal("gear", 2);
    hub.push("CtlDemand", 2, true); // other vehicle
    await flush();
    expect(sent()).toEqual([]);
    hub.push("CtlDemand", 1, true);
    await flush();
    expect(sent()).toEqual([[1, false, [[5, 0.5]], [["gear", 2]], [], []]]);
    clock.advance(10);
    pub.setOutput(5, 0.6);
    pub.setOutput(5, 0.7);
    pub.setSignal("gear", 2);
    await flush();
    expect(sent().length).toBe(1);
    clock.advance(89);
    await flush();
    expect(sent().length).toBe(1);
    clock.advance(1);
    await flush();
    expect(sent()[1]).toEqual([2, false, [[5, 0.7]], [], [], []]);
  });

  it("sends a keepalive after 1 s without change and a pause change at once", async () => {
    const { hub, clock, pub, sent } = setup();
    pub.setSignal("gear", 1);
    hub.push("CtlDemand", 1, true);
    await flush();
    clock.advance(999);
    await flush();
    expect(sent().length).toBe(1);
    clock.advance(1);
    await flush();
    expect(sent()[1]).toEqual([2, false, [], [], [], []]);
    clock.advance(10);
    pub.setPaused(true);
    await flush();
    expect(sent()[2]).toEqual([3, true, [], [], [], []]);
  });

  it("reports removed values, also those removed while nobody watched", async () => {
    const { hub, clock, pub, sent } = setup();
    pub.setOutput(5, 1);
    pub.setSignal("a", 1);
    hub.push("CtlDemand", 1, true);
    await flush();
    clock.advance(200);
    pub.removeSignal("a");
    clock.advance(100);
    await flush();
    expect(sent().at(-1)).toEqual([2, false, [], [], [], ["a"]]);
    hub.push("CtlDemand", 1, false);
    pub.removeOutput(5);
    pub.setSignal("b", 3);
    clock.advance(500);
    hub.push("CtlDemand", 1, true);
    await flush();
    expect(sent().at(-1)).toEqual([3, false, [], [["b", 3]], [5], []]);
  });

  it("rounds to 6 significant digits and ignores changes below that", async () => {
    expect(round6(1.23456789)).toBe(1.23457);
    expect(round6(123456789)).toBe(123457000);
    const { hub, clock, pub, sent } = setup();
    pub.setOutput(5, 0.1234561);
    hub.push("CtlDemand", 1, true);
    await flush();
    pub.setOutput(5, 0.1234564);
    clock.advance(150);
    await flush();
    expect(sent()).toEqual([[1, false, [[5, 0.123456]], [], [], []]]);
  });

  it("stops when control ends or the connection is renewed", async () => {
    const { hub, clock, pub, sent } = setup();
    pub.setOutput(5, 1);
    hub.push("CtlDemand", 1, true);
    await flush();
    hub.reconnected();
    clock.advance(3000);
    await flush();
    expect(sent().length).toBe(1);
    hub.push("CtlDemand", 1, true);
    await flush();
    expect(sent().at(-1)).toEqual([2, false, [[5, 1]], [], [], []]);
    pub.controlEnded();
    clock.advance(3000);
    await flush();
    expect(sent().length).toBe(2);
  });

  it("serves the driver's own HUD locally with the pause flag", () => {
    const { pub } = setup();
    expect(pub.output(5).reason).toBe("no-data");
    pub.setOutput(5, 0.25);
    pub.setPaused(true);
    expect(pub.output(5)).toMatchObject({ state: "valid", value: 0.25, paused: true });
    pub.removeOutput(5);
    expect(pub.output(5).state).toBe("invalid");
  });
});
