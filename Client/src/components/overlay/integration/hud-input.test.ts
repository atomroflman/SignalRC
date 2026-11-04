import { describe, expect, it } from "vitest";
import { useControlFlowStore, type ControlFlowNode } from "../../control-flow-store";
import { hudInputValues } from "../../filters/HudInputFunction";
import { interactionAt, sliderFraction } from "./hud-interaction";
import { hudInputName, hudInputProblem, nextHudInputValue, sliderValue } from "./hud-input";

const node = (nodeId: number, functionName: string, params: Record<string, unknown>, type = "default"): ControlFlowNode => ({
  nodeId, type, label: functionName, data: {}, position: { x: 0, y: 0 }, nodeTypeName: "UserSetupFunctionNode",
  metadata: { functionName }, params,
});

describe("HUD inputs (D75)", () => {
  it("applies button, toggle and fixed value actions", () => {
    expect(nextHudInputValue(0, "press", 1)).toBe(1);
    expect(nextHudInputValue(1, "release", 0)).toBe(0);
    expect(nextHudInputValue(0, "toggle", 2)).toBe(2);
    expect(nextHudInputValue(2, "toggle", 2)).toBe(0);
    expect(nextHudInputValue(5, "set", 3)).toBe(3);
  });

  it("maps a slider position to min … max in steps", () => {
    const slider = { input: "p", kind: "slider" as const, min: 0.2, max: 1, step: 0.1 };
    expect(sliderValue(slider, 0)).toBe(0.2);
    expect(sliderValue(slider, 1)).toBe(1);
    expect(sliderValue(slider, 0.5)).toBe(0.6);
    expect(sliderValue(slider, 0.13)).toBe(0.3);
    expect(sliderValue(slider, 7)).toBe(1);
    expect(sliderValue({ input: "p", kind: "slider" }, 0.25)).toBe(0.25);
    expect(sliderValue({ input: "p", kind: "slider", min: 1, max: 1 }, 0.5)).toBeUndefined();
    expect(sliderFraction({ left: 10, top: 0, width: 100, height: 20 }, 60, 5)).toBe(0.5);
    expect(sliderFraction({ left: 0, top: 0, width: 20, height: 100 }, 5, 75)).toBe(0.25);
  });

  it("checks the input name like a signal name", () => {
    expect(hudInputName(node(1, "HudInput", { input: " light " }))).toBe("light");
    expect(hudInputProblem(node(1, "HudInput", { input: "" }))).toBe("missing");
    expect(hudInputProblem(node(1, "HudInput", { input: "gas-pedal" }))).toBe("invalid");
    expect(hudInputProblem(node(1, "HudSignal", { signal: "" }))).toBeUndefined();
  });

  it("finds the clickable element or part under the pointer", () => {
    const at = (attrs: Record<string, string>, parent?: Record<string, string>) => {
      const p = parent && { closest: () => null, hasAttribute: () => false, getAttribute: (k: string) => parent[k] ?? null };
      const el = {
        hasAttribute: (k: string) => k in attrs,
        getAttribute: (k: string) => attrs[k] ?? null,
        closest: (sel: string) => (sel === "[data-ovl-interaction]" && "data-ovl-interaction" in attrs ? el : sel === "[data-ovl-id]" ? ("data-ovl-id" in attrs ? el : p) : null),
      };
      return el as unknown as Element;
    };
    const button = at({ "data-ovl-id": "horn", "data-ovl-interaction": '{"input":"horn","kind":"button"}' });
    expect(interactionAt(button, "all")).toMatchObject({ element: "horn", interaction: { input: "horn", kind: "button" } });
    expect(interactionAt(button, "public")).toBeUndefined();
    const part = at({ "data-ovl-part": "eco", "data-ovl-public": "", "data-ovl-interaction": '{"input":"mode","kind":"value","value":1,"public":true}' }, { "data-ovl-id": "panel" });
    expect(interactionAt(part, "public")).toMatchObject({ element: "panel", part: "eco", interaction: { input: "mode", value: 1 } });
  });

  it("a click recalculates every HudInput node of that name and what follows", () => {
    const store = useControlFlowStore;
    store.setState({
      nodes: [node(1, "HudInput", { input: "light" }), node(2, "HudInput", { input: "other" }), node(3, "Reverse", {})],
      edges: [{ id: 1, source: 1, sourcePort: "value", target: 3, targetPort: "input" }],
      nodeLatestValues: {},
      nodeOutputValues: {},
    });
    store.getState().applyHudInput("light", "toggle", 1);
    expect(hudInputValues.get(1)).toBe(1);
    expect(hudInputValues.has(2)).toBe(false);
    expect(store.getState().nodeLatestValues[3]).toBe(-1);
    store.getState().applyHudInput("light", "toggle", 1);
    expect(store.getState().nodeLatestValues[3]).toBe(-0);
  });
});
