import { describe, expect, it } from "vitest";
import { flowSignalNames, loadFlowSignalNames } from "./flow-signals";

const hud = (nodeId: number, signal: unknown) => ({ nodeId, nodeTypeName: "UserSetupFunctionNode", metadata: { functionName: "HudSignal" }, params: { signal } });

describe("flow signals for the overlay editor", () => {
  it("collects the names of HUD-Signal nodes once, sorted", () => {
    const nodes = [
      hud(1, "throttle"), hud(2, " gear "), hud(3, ""), hud(4, "throttle"),
      { nodeId: 5, nodeTypeName: "UserSetupFunctionNode", metadata: { functionName: "Smooth" }, params: { signal: "x" } },
      { nodeId: 6, nodeTypeName: "UserSetupCarChannelNode", representingId: 9 },
    ];
    expect(flowSignalNames(nodes)).toEqual(["gear", "throttle"]);
  });

  it("loads the user's setup and its flow", async () => {
    const urls: string[] = [];
    const fetchJson = async (url: string) => {
      urls.push(url);
      return url.endsWith("/setup/7") ? { id: 42 } : { nodes: [hud(1, "speedTarget")] };
    };
    expect(await loadFlowSignalNames(7, fetchJson)).toEqual(["speedTarget"]);
    expect(urls).toEqual(["/api/userconfig/setup/7", "/api/flow/42"]);
    expect(await loadFlowSignalNames(7, async () => null)).toEqual([]);
  });
});
