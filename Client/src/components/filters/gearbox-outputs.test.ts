import { describe, expect, it } from "vitest";
import { edgeValue, type ControlFlowNode } from "../control-flow-store";
import { GearboxFunction } from "./GearboxFunction";

const params = { gearNames: "R,N,1,2", initialGear: "1" };

describe("gearbox outputs", () => {
  it("returns gear index, value 0 … 1 and name; the text start gear is honoured", () => {
    const gearbox = new GearboxFunction();
    expect(gearbox.apply({ shiftUp: 0, shiftDown: 0 }, params, 1)).toEqual([1, 1 / 3, "N"]);
    gearbox.apply({ shiftUp: 1, shiftDown: 0 }, params, 1);
    gearbox.apply({ shiftUp: 0, shiftDown: 0 }, params, 1);
    expect(gearbox.apply({ shiftUp: 1, shiftDown: 0 }, params, 1)).toEqual([3, 1, "2"]);
    expect(new GearboxFunction().apply({ shiftUp: 0, shiftDown: 0 }, { ...params, initialGear: "2" }, 2)).toEqual([2, 2 / 3, "1"]);
  });

  it("each edge carries the value of its source port", () => {
    const node = { nodeId: 7, metadata: { functionName: "Gearbox" } } as ControlFlowNode;
    const state = { nodes: [node], nodeLatestValues: { 7: 3 }, nodeOutputValues: { 7: [3, 1, "2"] } };
    expect(edgeValue(state, { source: 7, sourcePort: "currentGear" })).toBe(3);
    expect(edgeValue(state, { source: 7, sourcePort: "gearValue" })).toBe(1);
    expect(edgeValue(state, { source: 7, sourcePort: "gearName" })).toBe(2);
    expect(edgeValue({ ...state, nodeOutputValues: { 7: [0, 0, "N"] } }, { source: 7, sourcePort: "gearName" })).toBe(0);
    expect(edgeValue(state, { source: 7 })).toBe(3);
    expect(edgeValue(state, { source: 99, sourcePort: "out" })).toBe(0);
  });
});
