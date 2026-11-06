import { describe, expect, it } from "vitest";
import { isAllowedLink, portZone } from "./flow-zone-rules";
import type { ControlFlowNode } from "./control-flow-store";

const node = (nodeId: number, type: string, nodeTypeName: string, zone?: "browser" | "onboard") =>
  ({ nodeId, type, nodeTypeName, zone, label: "", data: {}, position: { x: 0, y: 0 }, params: {} }) as ControlFlowNode;

const gamepad = node(1, "input", "UserSetupUserChannelNode");
const browserFn = node(2, "default", "UserSetupFunctionNode", "browser");
const handoff = node(3, "handoff", "UserSetupHandoffNode", "onboard");
const onboardFn = node(4, "default", "UserSetupFunctionNode", "onboard");
const onboardOut = node(5, "output", "UserSetupCarChannelNode", "onboard");
const controller = node(6, "vehicleInput", "UserSetupVehicleInputNode", "onboard");
const browserOut = node(7, "output", "UserSetupCarChannelNode");

describe("flow zone rules (same as the server)", () => {
  it("allows top-down links", () => {
    expect(isAllowedLink(gamepad, browserFn)).toBe(true);
    expect(isAllowedLink(browserFn, browserOut)).toBe(true);
    expect(isAllowedLink(browserFn, handoff)).toBe(true);
    expect(isAllowedLink(handoff, onboardFn)).toBe(true);
    expect(isAllowedLink(controller, onboardFn)).toBe(true);
    expect(isAllowedLink(onboardFn, onboardOut)).toBe(true);
  });
  it("refuses everything else", () => {
    expect(isAllowedLink(browserFn, onboardFn)).toBe(false);
    expect(isAllowedLink(gamepad, onboardOut)).toBe(false);
    expect(isAllowedLink(onboardFn, browserOut)).toBe(false);
    expect(isAllowedLink(controller, browserFn)).toBe(false);
    expect(isAllowedLink(onboardFn, handoff)).toBe(false);
    expect(isAllowedLink(handoff, browserFn)).toBe(false);
    expect(isAllowedLink(onboardFn, controller)).toBe(false);
    expect(isAllowedLink(browserOut, browserFn)).toBe(false);
  });
});

describe("portZone", () => {
  it("colours ports by zone, the handoff takes web in and gives vehicle out", () => {
    const handoff = { nodeTypeName: "UserSetupHandoffNode", zone: "onboard", type: "handoff" } as any;
    expect(portZone(handoff, "target")).toBe("browser");
    expect(portZone(handoff, "source")).toBe("onboard");
    expect(portZone({ nodeTypeName: "UserSetupVehicleInputNode", type: "vehicleInput" } as any, "source")).toBe("onboard");
    expect(portZone({ nodeTypeName: "UserSetupFunctionNode", zone: "onboard", type: "function" } as any, "source")).toBe("onboard");
    expect(portZone({ nodeTypeName: "UserSetupFunctionNode", zone: "browser", type: "function" } as any, "target")).toBe("browser");
    expect(portZone(undefined, "source")).toBe("browser");
  });
});
