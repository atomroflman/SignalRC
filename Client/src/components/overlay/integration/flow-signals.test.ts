import { describe, expect, it } from "vitest";
import { flowInputNames, flowSignalNames, loadFlowNames } from "./flow-signals";

const input = (nodeId: number, name: unknown) => ({ nodeId, nodeTypeName: "UserSetupFunctionNode", metadata: { functionName: "HudInput" }, params: { input: name } });
const hud = (nodeId: number, signal: unknown) => ({ nodeId, nodeTypeName: "UserSetupFunctionNode", metadata: { functionName: "HudSignal" }, params: { signal } });

describe("flow signals for the overlay editor", () => {
  it("collects the valid names of HUD-Signal nodes once, sorted", () => {
    const nodes = [
      hud(1, "throttle"), hud(2, " gear "), hud(3, ""), hud(4, "throttle"), hud(7, "gas-pedal"),
      { nodeId: 5, nodeTypeName: "UserSetupFunctionNode", metadata: { functionName: "Smooth" }, params: { signal: "x" } },
      { nodeId: 6, nodeTypeName: "UserSetupCarChannelNode", representingId: 9 },
    ];
    expect(flowSignalNames(nodes)).toEqual(["gear", "throttle"]);
  });

  it("loads the user's setup and its flow", async () => {
    const urls: string[] = [];
    const fetchJson = async (url: string) => {
      urls.push(url);
      return url.endsWith("/setup/7") ? { id: 42 } : { nodes: [hud(1, "speedTarget"), input(2, "light")] };
    };
    expect(await loadFlowNames(7, fetchJson)).toEqual({ signals: ["speedTarget"], inputs: ["light"] });
    expect(urls).toEqual(["/api/userconfig/setup/7", "/api/flow/42"]);
    expect(await loadFlowNames(7, async () => null)).toEqual({ signals: [], inputs: [] });
  });

  it("collects the valid names of HUD-Eingabe nodes once, sorted", () => {
    expect(flowInputNames([input(1, "light"), input(2, " horn "), input(3, "light"), input(4, "bad-name"), hud(5, "x")])).toEqual(["horn", "light"]);
  });
});
