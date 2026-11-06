import { describe, expect, it } from "vitest";
import { filterFunctionRegistry } from "./filters/filter-function-registry";
import { flowNodeDocs } from "./flow-node-docs";

describe("flow node descriptions", () => {
  it("describe every registered function and the channel nodes in every language", () => {
    const keys = [...Object.keys(filterFunctionRegistry), "input", "output", "vehicleInput", "handoff"].sort();
    for (const docs of Object.values(flowNodeDocs)) {
      expect(Object.keys(docs).sort()).toEqual(keys);
      for (const doc of Object.values(docs)) {
        expect(doc.summary).not.toBe("");
        expect(doc.example).not.toBe("");
      }
    }
  });
});
