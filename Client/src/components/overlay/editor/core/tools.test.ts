// Design tools: geometry, hit test, move/resize/rotate, align/distribute, layers, duplicate.
import { describe, expect, it } from "vitest";
import type { OverlayDocument } from "../../document/types";
import { hitTest, layout, marqueeSelect, worldBox } from "./geometry";
import { EditorStore } from "./store";
import {
  alignCommands, arrangeCommand, dispatchAll, distributeCommands, duplicateCommand, groupCommand, moveCommands, newId, resizeCommand,
  rotateCommand,
} from "./tools";
import { allElementIds } from "./commands";

const doc = (): OverlayDocument => ({
  schemaVersion: 1,
  workspace: { width: 400, height: 200 },
  elements: {
    e_a: { type: "rect", props: { x: 10, y: 10, width: 20, height: 20 } },
    e_b: { type: "rect", props: { x: 50, y: 30, width: 40, height: 20 } },
    e_c: { type: "rect", props: { x: 200, y: 50, width: 10, height: 10 } },
    e_g: { type: "group", children: ["e_in"], props: { x: 100, y: 100, scaleX: 2 } },
    e_in: { type: "ellipse", props: { width: 10, height: 10 } },
    e_t: { type: "text", props: { x: 300, y: 100, text: "abc", rotation: { base: 0, binding: { expr: "1" } } } },
    e_l: { type: "rect", locked: true, props: { x: 0, y: 0, width: 400, height: 200 } },
  },
  children: ["e_l", "e_a", "e_b", "e_c", "e_g", "e_t"],
});

const setup = () => {
  const store = new EditorStore({ carId: 1, document: doc() });
  const config = () => store.effective();
  const places = () => layout(store.effective());
  return { store, config, places };
};

describe("geometry", () => {
  it("hit test returns the topmost path and skips locked elements", () => {
    const { config, places } = setup();
    expect(hitTest(config(), places(), { x: 15, y: 15 })).toEqual(["e_a"]);
    expect(hitTest(config(), places(), { x: 105, y: 105 })).toEqual(["e_g", "e_in"]);
    expect(hitTest(config(), places(), { x: 380, y: 190 })).toBeUndefined();
    expect(hitTest(config(), places(), { x: 380, y: 190 }, { skipLocked: false })).toEqual(["e_l"]);
  });

  it("group scale applies to children; marquee selects top-level elements", () => {
    const { config, places } = setup();
    const b = worldBox(places().get("e_in")!);
    expect(b[2]).toBeCloseTo(20);
    expect(b[3]).toBeCloseTo(20);
    expect(marqueeSelect(config(), places(), [0, 0, 100, 60])).toEqual(["e_a", "e_b"]);
  });
});

describe("transform tools", () => {
  it("moves in parent coordinates and keeps drivers", () => {
    const { store, config, places } = setup();
    dispatchAll(store, moveCommands(config(), places(), ["e_in", "e_t"], 10, 4), "Verschieben");
    expect(store.document.elements.e_in.props).toMatchObject({ x: 5, y: 2 });
    expect(store.document.elements.e_t.props!.x).toBe(310);
    expect(store.document.elements.e_t.props!.rotation).toEqual({ base: 0, binding: { expr: "1" } });
    expect(store.getState().history.size).toBe(1);
  });

  it("resizing a rect changes width/height and keeps the opposite corner", () => {
    const { store, config, places } = setup();
    const before = worldBox(places().get("e_b")!);
    store.dispatch(resizeCommand(config().elements.e_b, places().get("e_b")!, "nw", { x: 30, y: 20 }, false));
    const after = worldBox(layout(store.effective()).get("e_b")!);
    expect(store.document.elements.e_b.props).toMatchObject({ width: 60, height: 30, x: 30, y: 20 });
    expect(after[0] + after[2]).toBeCloseTo(before[0] + before[2]);
    expect(after[1] + after[3]).toBeCloseTo(before[1] + before[3]);
  });

  it("resizing a group scales proportionally (D02) around the anchor", () => {
    const { store, config, places } = setup();
    const p = places().get("e_g")!;
    const b = worldBox(p);
    store.dispatch(resizeCommand(config().elements.e_g, p, "se", { x: b[0] + b[2] * 2, y: b[1] + b[3] }, false));
    expect(store.document.elements.e_g.props!.scaleX).toBeCloseTo(4);
    expect(store.document.elements.e_g.props!.scaleY).toBeUndefined();
    const after = worldBox(layout(store.effective()).get("e_g")!);
    expect(after[0]).toBeCloseTo(b[0]);
    expect(after[1]).toBeCloseTo(b[1]);
  });

  it("rotates around the pivot with optional 15° snapping", () => {
    const { store, config, places } = setup();
    const p = places().get("e_a")!;
    store.dispatch(rotateCommand(config().elements.e_a, p, { x: 20, y: 0 }, { x: 40, y: 21 }, 15));
    expect(store.document.elements.e_a.props!.rotation).toBe(90);
  });
});

describe("arrangement tools", () => {
  it("aligns several elements to their common box and one to the workspace", () => {
    const { store, config, places } = setup();
    dispatchAll(store, alignCommands(config(), places(), ["e_a", "e_b"], "right"), "Ausrichten");
    expect(store.document.elements.e_a.props!.x).toBe(70);
    dispatchAll(store, alignCommands(store.effective(), layout(store.effective()), ["e_c"], "centerX"), "Ausrichten");
    expect(store.document.elements.e_c.props!.x).toBe(195);
  });

  it("distributes with equal gaps", () => {
    const { store, config, places } = setup();
    dispatchAll(store, distributeCommands(config(), places(), ["e_a", "e_b", "e_c"], "x"), "Verteilen");
    const boxes = ["e_a", "e_b", "e_c"].map((id) => worldBox(layout(store.effective()).get(id)!));
    expect(boxes[1][0] - (boxes[0][0] + boxes[0][2])).toBeCloseTo(boxes[2][0] - (boxes[1][0] + boxes[1][2]));
  });

  it("changes the layer order", () => {
    const { store, config } = setup();
    store.dispatch(arrangeCommand(config(), ["e_a"], "forward")!);
    expect(store.document.children.slice(0, 3)).toEqual(["e_l", "e_b", "e_a"]);
    store.dispatch(arrangeCommand(store.effective(), ["e_a"], "front")!);
    expect(store.document.children.at(-1)).toBe("e_a");
    store.dispatch(arrangeCommand(store.effective(), ["e_a"], "back")!);
    expect(store.document.children[0]).toBe("e_a");
    expect(arrangeCommand(store.effective(), ["e_a"], "back")).toBeUndefined();
  });

  it("groups with the pivot at the box center and duplicates with new ids", () => {
    const { store, config, places } = setup();
    store.dispatch(groupCommand(config(), places(), ["e_a", "e_b"], "e_ab")!);
    expect(store.document.elements.e_ab.props).toEqual({ pivotX: 50, pivotY: 30 });
    const dup = duplicateCommand(store.effective(), ["e_ab"], allElementIds(store.document), 10)!;
    expect(dup.type).toBe("addElements");
    store.dispatch(dup);
    const copies = Object.keys(store.document.elements).filter((id) => /^e_[a-z0-9]{10}$/.test(id));
    expect(copies).toHaveLength(3);
    const top = store.document.children[store.document.children.indexOf("e_ab") + 1];
    expect(store.document.elements[top].children).toHaveLength(2);
    expect(store.document.elements[top].props!.x).toBe(10);
  });

  it("duplicating in a variant copies the effective element as an added one", () => {
    const store = new EditorStore({ carId: 1, document: { ...doc(), variants: { front: { elements: { e_a: { props: { fill: "#ff0000" } } } } } } });
    store.setActiveVariant("front");
    store.dispatch(duplicateCommand(store.effective(), ["e_a"], allElementIds(store.document))!);
    const added = Object.values(store.document.variants!.front.addedElements!);
    expect(added[0].props!.fill).toBe("#ff0000");
    expect(Object.keys(store.document.elements)).not.toContain(Object.keys(store.document.variants!.front.addedElements!)[0]);
  });

  it("new ids follow the contract pattern", () => {
    expect(newId("e", new Set())).toMatch(/^e_[a-z0-9]{10}$/);
    expect(newId("c", new Set())).toMatch(/^c_[a-z0-9]{10}$/);
  });
});

describe("svg assets", () => {
  it("elements with an assetId get their box from the asset metadata and scale proportionally", () => {
    const store = new EditorStore({ carId: 1, document: { schemaVersion: 1, workspace: { width: 400, height: 200 }, elements: { e_s: { type: "svgAsset", assetId: "sha256-x", props: { x: 10, y: 10 } } }, children: ["e_s"] } });
    const ctx = { assets: { "sha256-x": { metadata: { width: 50, height: 20, parts: {} } } } };
    store.setGeometryContext(ctx);
    const places = layout(store.effective(), undefined, ctx);
    expect(hitTest(store.effective(), places, { x: 55, y: 25 })).toEqual(["e_s"]);
    store.dispatch(resizeCommand(store.effective().elements.e_s, places.get("e_s")!, "se", { x: 110, y: 20 }, false));
    expect(store.document.elements.e_s.props!.scaleX).toBe(2);
    // Pivot at the center: the top-left corner stays where it was.
    const box = worldBox(layout(store.effective(), undefined, ctx).get("e_s")!);
    expect(box.map((v) => Math.round(v))).toEqual([10, 10, 100, 40]);
    expect(store.document.elements.e_s.props!.scaleY).toBeUndefined();
  });
});
