// Store: undo/redo (D55), transactions, merging, structure guard, selection and scope.
import { describe, expect, it } from "vitest";
import type { OverlayDocument } from "../../document/types";
import { applyPatch, diff } from "./json-patch";
import { jsonEqual } from "./writer";
import { EditorStore } from "./store";

const doc = (): OverlayDocument => ({
  schemaVersion: 1,
  workspace: { width: 400, height: 200 },
  elements: { e_a: { type: "rect", props: { x: 10 } }, e_b: { type: "rect" } },
  children: ["e_a", "e_b"],
  variants: { front: {} },
});

const x = (s: EditorStore) => s.document.elements.e_a.props!.x;

describe("undo and redo", () => {
  it("every command is one step; redo is cleared by a new command", () => {
    const s = new EditorStore({ carId: 1, document: doc() });
    s.dispatch({ type: "setProperty", element: "e_a", property: "x", value: 20 });
    s.dispatch({ type: "setProperty", element: "e_a", property: "x", value: 30 });
    expect(s.getState().history).toMatchObject({ canUndo: true, size: 2, undoLabel: "x ändern" });
    s.undo();
    expect(x(s)).toBe(20);
    s.undo();
    expect(x(s)).toBe(10);
    expect(s.getState().history.canUndo).toBe(false);
    s.redo();
    expect(x(s)).toBe(20);
    s.dispatch({ type: "setProperty", element: "e_a", property: "x", value: 99 });
    expect(s.getState().history.canRedo).toBe(false);
  });

  it("keeps at most 200 steps", () => {
    const s = new EditorStore({ carId: 1, document: doc() });
    for (let i = 0; i < 250; i++) s.dispatch({ type: "setProperty", element: "e_a", property: "x", value: i });
    expect(s.getState().history.size).toBe(200);
    for (let i = 0; i < 300; i++) s.undo();
    expect(x(s)).toBe(49);
  });

  it("a drag is one step; cancel reverts", () => {
    const s = new EditorStore({ carId: 1, document: doc() });
    s.beginTransaction("Verschieben");
    for (let i = 1; i <= 30; i++) s.dispatch({ type: "setProperty", element: "e_a", property: "x", value: 10 + i });
    s.commitTransaction();
    expect(x(s)).toBe(40);
    expect(s.getState().history).toMatchObject({ size: 1, undoLabel: "Verschieben" });
    s.undo();
    expect(x(s)).toBe(10);
    s.beginTransaction();
    s.dispatch({ type: "setProperty", element: "e_a", property: "x", value: 77 });
    s.cancelTransaction();
    expect(x(s)).toBe(10);
    expect(s.getState().history.size).toBe(0);
  });

  it("merges typing with a merge key inside the time window", () => {
    let t = 0;
    const s = new EditorStore({ carId: 1, document: doc(), now: () => t });
    for (const v of [1, 12, 123]) {
      t += 200;
      s.dispatch({ type: "setProperty", element: "e_a", property: "x", value: v }, { mergeKey: "x-field" });
    }
    t += 5000;
    s.dispatch({ type: "setProperty", element: "e_a", property: "x", value: 5 }, { mergeKey: "x-field" });
    expect(s.getState().history.size).toBe(2);
    s.undo();
    expect(x(s)).toBe(123);
    s.undo();
    expect(x(s)).toBe(10);
  });

  it("undo restores selection and the variant scope of the step", () => {
    const s = new EditorStore({ carId: 1, document: doc() });
    s.setActiveVariant("front");
    s.select(["e_a"]);
    s.dispatch({ type: "setProperty", element: "e_a", property: "fill", value: "#ff0000" });
    s.setActiveVariant(null);
    s.select([]);
    s.undo();
    expect(s.getState().activeVariant).toBe("front");
    expect(s.getState().selection).toEqual(["e_a"]);
    expect(s.document.variants!.front).toEqual({});
  });

  it("undo of a variant creation falls back to the standard scope", () => {
    const s = new EditorStore({ carId: 1, document: doc() });
    s.dispatch({ type: "setVariant", streamId: "rear" });
    s.setActiveVariant("rear");
    expect(s.getState().activeVariant).toBe("rear");
    s.undo();
    expect(s.getState().activeVariant).toBeNull();
  });
});

describe("guard and errors", () => {
  it("refuses commands that introduce structure errors and reports them", () => {
    const s = new EditorStore({ carId: 1, document: doc() });
    const r = s.dispatch({ type: "setProperty", element: "e_a", property: "opacity", value: "viel" });
    expect(r.ok).toBe(false);
    expect(s.getState().lastError?.code).toBe("OVL_PROP_TYPE");
    expect(s.getState().history.size).toBe(0);
    const unknown = s.dispatch({ type: "setProperty", element: "e_zz", property: "x", value: 1 });
    expect(unknown.ok).toBe(false);
    expect(s.dispatch({ type: "setProperty", element: "e_a", property: "x", value: 1 }).ok).toBe(true);
    expect(s.getState().lastError).toBeUndefined();
  });

  it("publish diagnostics are allowed in the draft", () => {
    const s = new EditorStore({ carId: 1, document: doc() });
    const r = s.dispatch({ type: "setProperty", element: "e_a", property: "x", value: { base: 0, binding: { expr: 'tel("missing") +' } } });
    expect(r.ok).toBe(true);
  });
});

describe("selection and load", () => {
  it("selection follows the view and is pruned on delete", () => {
    const s = new EditorStore({ carId: 1, document: doc() });
    s.select(["e_a", "e_zz"]);
    expect(s.getState().selection).toEqual(["e_a"]);
    s.select(["e_b"], "add");
    s.select(["e_a"], "toggle");
    expect(s.getState().selection).toEqual(["e_b"]);
    s.dispatch({ type: "deleteElements", ids: ["e_b"] });
    expect(s.getState().selection).toEqual([]);
    s.undo();
    expect(s.getState().selection).toEqual(["e_b"]);
  });

  it("load replaces without a step and clears the history", () => {
    const s = new EditorStore({ carId: 1, document: doc() });
    s.dispatch({ type: "setProperty", element: "e_a", property: "x", value: 2 });
    s.load(doc());
    expect(s.getState().history.size).toBe(0);
    expect(x(s)).toBe(10);
  });

  it("replaceDocument is undoable and counted for the next full save", () => {
    const s = new EditorStore({ carId: 1, document: doc() });
    const other = { ...doc(), workspace: { width: 10, height: 10 } };
    s.dispatch({ type: "replaceDocument", document: other, reason: "import" });
    expect(s.replaceCount).toBe(1);
    expect(s.document.workspace.width).toBe(10);
    expect(s.document.elements.e_a).toBe(s.document.elements.e_a);
    s.undo();
    expect(s.document.workspace.width).toBe(400);
  });

  it("notifies subscribers once per command", () => {
    const s = new EditorStore({ carId: 1, document: doc() });
    let n = 0;
    s.subscribe(() => n++);
    s.dispatch({ type: "setProperty", element: "e_a", property: "x", value: 2 });
    expect(n).toBe(1);
  });
});

describe("JSON patch", () => {
  it("diff only touches changed paths, escapes keys and round-trips", () => {
    const a = doc();
    const s = new EditorStore({ carId: 1, document: a });
    s.dispatch({ type: "setProperty", element: "e_a", property: "x", value: 2 });
    s.dispatch({ type: "addElements", elements: { e_x: { type: "rect" } }, roots: ["e_x"] });
    s.dispatch({ type: "setSourceSettings", channel: "a/b~c", settings: { staleAfterMs: 900 } });
    const ops = diff(a, s.document);
    expect(ops).toContainEqual({ op: "replace", path: "/elements/e_a/props/x", value: 2 });
    expect(ops).toContainEqual({ op: "add", path: "/sources", value: { telemetry: { "a/b~c": { staleAfterMs: 900 } } } });
    expect(ops.some((o) => o.path === "/children" && o.op === "replace")).toBe(true);
    expect(jsonEqual(applyPatch(a, ops), s.document)).toBe(true);
    s.dispatch({ type: "setSourceSettings", channel: "a/b~c", settings: { staleAfterMs: 800 } });
    expect(diff(a, s.document).some((o) => o.path === "/sources")).toBe(true);
    const b = s.document;
    s.dispatch({ type: "setSourceSettings", channel: "a/b~c", settings: { staleAfterMs: 700 } });
    expect(diff(b, s.document)).toEqual([{ op: "replace", path: "/sources/telemetry/a~1b~0c/staleAfterMs", value: 700 }]);
  });
});
