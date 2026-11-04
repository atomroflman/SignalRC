// Editor commands on standard and variants, checked against the AP01 resolver.
import { describe, expect, it } from "vitest";
import { effectiveConfig, validate } from "../../document";
import type { OverlayDocument } from "../../document/types";
import { readContractJson } from "../../testing/fixtures";
import { applyCommand } from "./commands";
import { layout, worldBox } from "./geometry";
import type { EditorCommand } from "./types";

const base = (): OverlayDocument => ({
  schemaVersion: 1,
  workspace: { width: 400, height: 200 },
  elements: {
    e_a: { type: "rect", props: { x: 10, y: 10, width: 20, height: 20 } },
    e_b: { type: "rect", props: { x: 50, y: 10, width: 20, height: 20 } },
    e_c: { type: "ellipse", props: { x: 100, y: 50 } },
    e_g: { type: "group", children: ["e_c"], props: { x: 100, y: 0, rotation: 90, pivotX: 150, pivotY: 100 } },
  },
  children: ["e_a", "e_b", "e_g"],
  variants: { front: {} },
});

const run = (doc: OverlayDocument, ...cmds: EditorCommand[]) => cmds.reduce((d, c) => applyCommand(d, c), doc);
const structure = (doc: OverlayDocument) => validate(doc).filter((d) => d.category !== "warning");

describe("properties", () => {
  it("standard scope writes the element, variant scope an override", () => {
    const doc = run(base(), { type: "setProperty", element: "e_a", property: "x", value: 99, variant: null });
    expect(doc.elements.e_a.props!.x).toBe(99);
    const v = run(doc, { type: "setProperty", element: "e_a", property: "fill", value: "#ff0000", variant: "front" });
    expect(v.variants!.front.elements!.e_a.props!.fill).toBe("#ff0000");
    expect(v.elements.e_a.props!.fill).toBeUndefined();
    const fx = effectiveConfig(v, "front").elements.e_a;
    expect(fx.propOrigins.fill).toBe("variant");
    expect(fx.props.x).toBe(99);
  });

  it("shares untouched subtrees", () => {
    const doc = base();
    const next = run(doc, { type: "setProperty", element: "e_a", property: "x", value: 1, variant: null });
    expect(next).not.toBe(doc);
    expect(next.elements.e_b).toBe(doc.elements.e_b);
    expect(next.variants).toBe(doc.variants);
    expect(doc.elements.e_a.props!.x).toBe(10);
  });

  it("reset removes the override and prunes empty objects, not the variant", () => {
    let doc = run(base(), { type: "setProperty", element: "e_a", property: "x", value: 5, variant: "front" });
    doc = run(doc, { type: "resetOverride", element: "e_a", property: "x", variant: "front" });
    expect(doc.variants!.front).toEqual({});
    doc = run(doc, { type: "setAttribute", element: "e_a", name: "disabled", value: true, variant: "front" });
    expect(doc.variants!.front.elements!.e_a.disabled).toBe(true);
    doc = run(doc, { type: "resetOverride", element: "e_a", variant: "front" });
    expect(doc.variants!.front.elements).toBeUndefined();
  });

  it("interactions (D75) edit the element or part itself, also in a variant, and can be removed", () => {
    const button = { input: "horn", kind: "button" as const };
    let doc = run(base(), { type: "setInteraction", element: "e_a", interaction: button, variant: "front" });
    expect(doc.elements.e_a.interaction).toEqual(button);
    expect(doc.variants!.front.elements).toBeUndefined();
    expect(effectiveConfig(doc, "front").elements.e_a.interaction).toEqual(button);
    doc = run(doc, { type: "setInteraction", element: "e_a", part: "p_knob", interaction: { input: "mode", kind: "value", value: 2 }, variant: null });
    expect(doc.elements.e_a.parts).toEqual({ p_knob: { interaction: { input: "mode", kind: "value", value: 2 } } });
    doc = run(doc, { type: "setInteraction", element: "e_a", part: "p_knob", interaction: undefined, variant: null },
      { type: "setInteraction", element: "e_a", interaction: undefined, variant: null });
    expect(doc.elements.e_a).toEqual(base().elements.e_a);
  });

  it("name is shared and edits the standard even in a variant", () => {
    const doc = run(base(), { type: "setAttribute", element: "e_a", name: "name", value: "Box", variant: "front" });
    expect(doc.elements.e_a.name).toBe("Box");
    expect(doc.variants!.front.elements).toBeUndefined();
  });

  it("locking the aspect removes scaleY (D02)", () => {
    let doc = run(base(), { type: "setProperties", element: "e_a", props: { scaleX: 2, scaleY: 3 }, variant: null });
    doc = run(doc, { type: "setAttribute", element: "e_a", name: "lockAspect", value: true, variant: null });
    expect(doc.elements.e_a.props!.scaleY).toBeUndefined();
    expect(structure(doc)).toEqual([]);
  });
});

describe("adding and deleting", () => {
  it("adds into a variant at root and keeps the standard untouched", () => {
    const doc = run(base(), { type: "addElements", elements: { e_new: { type: "rect" } }, roots: ["e_new"], index: 0, variant: "front" });
    expect(doc.elements.e_new).toBeUndefined();
    expect(doc.variants!.front.addedElements!.e_new.type).toBe("rect");
    expect(effectiveConfig(doc, "front").root).toEqual(["e_new", "e_a", "e_b", "e_g"]);
    expect(effectiveConfig(doc, null).root).toEqual(["e_a", "e_b", "e_g"]);
    expect(structure(doc)).toEqual([]);
  });

  it("refuses ids already used in another variant (one namespace)", () => {
    const doc = run(base(), { type: "addElements", elements: { e_x: { type: "rect" } }, roots: ["e_x"], variant: "front" });
    expect(() => run(doc, { type: "addElements", elements: { e_x: { type: "rect" } }, roots: ["e_x"], variant: null })).toThrow(/vergeben/);
    expect(() => run(doc, { type: "addElements", elements: { root: { type: "rect" } }, roots: ["root"], variant: null })).toThrow(/ungültig/);
  });

  it("deletes standard elements with their variant adjustments (AP01)", () => {
    let doc = run(base(), { type: "setProperty", element: "e_c", property: "x", value: 1, variant: "front" });
    doc = run(doc, { type: "addElements", elements: { e_in: { type: "rect" } }, roots: ["e_in"], container: "e_g", variant: "front" });
    doc = run(doc, { type: "deleteElements", ids: ["e_g"], variant: null });
    expect(doc.elements.e_g).toBeUndefined();
    expect(doc.elements.e_c).toBeUndefined();
    expect(doc.variants!.front.addedElements?.e_in).toBeUndefined();
    expect(doc.variants!.front.elements?.e_c).toBeUndefined();
    expect(structure(doc)).toEqual([]);
  });

  it("in a variant only added elements can be deleted; moved-in standard elements return", () => {
    expect(() => run(base(), { type: "deleteElements", ids: ["e_a"], variant: "front" })).toThrow(/deaktiviert/);
    let doc = run(base(), { type: "addElements", elements: { e_vg: { type: "group", children: [] } }, roots: ["e_vg"], variant: "front" });
    doc = run(doc, { type: "reparent", ids: ["e_a"], container: "e_vg", variant: "front" });
    expect(effectiveConfig(doc, "front").elements.e_a.parent).toBe("e_vg");
    doc = run(doc, { type: "deleteElements", ids: ["e_vg"], variant: "front" });
    expect(effectiveConfig(doc, "front").elements.e_a.parent).toBe("root");
    expect(doc.variants!.front.structure).toBeUndefined();
    expect(structure(doc)).toEqual([]);
  });
});

describe("structure", () => {
  it("groups in the standard with a fixed pivot at the z position of the top member", () => {
    const doc = run(base(), { type: "groupElements", ids: ["e_a", "e_b"], groupId: "e_ab", pivot: { x: 40, y: 20 }, variant: null });
    expect(doc.children).toEqual(["e_ab", "e_g"]);
    expect(doc.elements.e_ab).toMatchObject({ type: "group", children: ["e_a", "e_b"], props: { pivotX: 40, pivotY: 20 } });
    expect(structure(doc)).toEqual([]);
  });

  it("groups in a variant with structure entries only", () => {
    const doc = run(base(), { type: "groupElements", ids: ["e_b", "e_a"], groupId: "e_vg", variant: "front" });
    const fx = effectiveConfig(doc, "front");
    expect(fx.root).toEqual(["e_vg", "e_g"]);
    expect(fx.elements.e_vg.children).toEqual(["e_a", "e_b"]);
    expect(effectiveConfig(doc, null).root).toEqual(["e_a", "e_b", "e_g"]);
    expect(doc.variants!.front.structure!.parents).toEqual({ e_a: "e_vg", e_b: "e_vg", e_vg: "root" });
    expect(structure(doc)).toEqual([]);
  });

  it("refuses members of different containers", () => {
    expect(() => run(base(), { type: "groupElements", ids: ["e_a", "e_c"], groupId: "e_x", variant: null })).toThrow(/Containers/);
  });

  it("ungroup keeps the world position of the children in every view", () => {
    let doc = run(base(), { type: "setProperty", element: "e_g", property: "x", value: 0, variant: "front" });
    const before = (scope: string | null, d: OverlayDocument) => worldBox(layout(effectiveConfig(d, scope)).get("e_c")!);
    const std = before(null, doc);
    const front = before("front", doc);
    doc = run(doc, { type: "ungroup", group: "e_g", variant: null });
    expect(doc.elements.e_g).toBeUndefined();
    expect(doc.children).toEqual(["e_a", "e_b", "e_c"]);
    const after = before(null, doc);
    const afterFront = before("front", doc);
    std.forEach((v, i) => expect(after[i]).toBeCloseTo(v, 3));
    front.forEach((v, i) => expect(afterFront[i]).toBeCloseTo(v, 3));
    expect(doc.elements.e_c.props!.rotation).toBe(90);
    expect(doc.variants!.front.elements!.e_c.props).toBeDefined();
    expect(structure(doc)).toEqual([]);
  });

  it("reparent with keepPosition and cycle protection", () => {
    const doc = run(base(), { type: "reparent", ids: ["e_a"], container: "e_g", keepPosition: true, variant: null });
    const box = worldBox(layout(effectiveConfig(doc, null)).get("e_a")!);
    expect(box[0]).toBeCloseTo(10, 3);
    expect(box[1]).toBeCloseTo(10, 3);
    expect(doc.elements.e_g.children).toEqual(["e_c", "e_a"]);
    expect(() => run(doc, { type: "reparent", ids: ["e_g"], container: "e_g", variant: null })).toThrow(/sich selbst/);
  });

  it("reorder in a variant writes an order entry, reset removes it", () => {
    let doc = run(base(), { type: "reorder", container: "root", order: ["e_g", "e_a", "e_b"], variant: "front" });
    expect(doc.variants!.front.structure!.order!.root).toEqual(["e_g", "e_a", "e_b"]);
    expect(effectiveConfig(doc, null).root).toEqual(["e_a", "e_b", "e_g"]);
    doc = run(doc, { type: "resetStructure", variant: "front", container: "root" });
    expect(doc.variants!.front).toEqual({});
    expect(() => run(doc, { type: "reorder", container: "root", order: ["e_a"], variant: null })).toThrow();
  });
});

describe("clips, workspace and variants", () => {
  const clip = { durationS: 1, trigger: { mode: "auto" as const }, tracks: [] };

  it("clip overrides in a variant replace fields; keyframes edit the effective track list", () => {
    let doc = run(base(), { type: "addClip", id: "c_1", clip, variant: null });
    doc = run(doc, { type: "setKeyframes", clip: "c_1", track: { element: "e_a", property: "opacity" }, keyframes: [{ t: 0, value: 1 }, { t: 1, value: 0 }], variant: null });
    expect(doc.clips!.c_1.tracks).toHaveLength(1);
    doc = run(doc, { type: "updateClip", id: "c_1", changes: { durationS: 2 }, variant: "front" });
    doc = run(doc, { type: "setKeyframes", clip: "c_1", track: { element: "e_a", property: "opacity" }, keyframes: null, variant: "front" });
    expect(doc.variants!.front.clips!.c_1).toEqual({ durationS: 2, tracks: [] });
    expect(doc.clips!.c_1.tracks).toHaveLength(1);
    doc = run(doc, { type: "updateClip", id: "c_1", changes: { durationS: undefined, tracks: undefined }, variant: "front" });
    expect(doc.variants!.front).toEqual({});
    expect(() => run(doc, { type: "updateClip", id: "c_1", changes: { trigger: undefined }, variant: null })).toThrow(/erforderlich/);
    doc = run(doc, { type: "updateClip", id: "c_1", changes: { durationS: 3 }, variant: "front" });
    doc = run(doc, { type: "removeClip", id: "c_1", variant: null });
    expect(doc.clips).toBeUndefined();
    expect(doc.variants!.front.clips).toBeUndefined();
    expect(structure(doc)).toEqual([]);
  });

  it("fitContent composes the root transform (D39), areaOnly keeps it", () => {
    let doc = run(base(), { type: "setWorkspace", width: 200, height: 200, mode: "fitContent", variant: null });
    expect(doc.workspace).toEqual({ width: 200, height: 200 });
    expect(doc.rootTransform).toEqual({ scale: 0.5, offsetX: 0, offsetY: 50 });
    doc = run(doc, { type: "setWorkspace", width: 100, height: 100, mode: "fitContent", variant: null });
    expect(doc.rootTransform).toEqual({ scale: 0.25, offsetX: 0, offsetY: 25 });
    doc = run(doc, { type: "setWorkspace", width: 300, height: 100, mode: "areaOnly", variant: "front" });
    // The variant's own workspace keeps the inherited root transform.
    expect(doc.variants!.front.rootTransform).toEqual({ scale: 0.25, offsetX: 0, offsetY: 25 });
    expect(effectiveConfig(doc, "front").rootTransform).toEqual(doc.rootTransform);
  });

  it("creates, disables, reassigns and removes variants", () => {
    let doc = run(base(), { type: "setVariant", streamId: "rear", settings: { disabled: true } });
    expect(doc.variants!.rear).toEqual({ disabled: true });
    expect(() => run(doc, { type: "reassignVariant", from: "rear", to: "front" })).toThrow(/bereits/);
    doc = run(doc, { type: "reassignVariant", from: "rear", to: "side" });
    expect(doc.variants!.side).toEqual({ disabled: true });
    expect(doc.variants!.rear).toBeUndefined();
    doc = run(doc, { type: "setVariant", streamId: "side", settings: { disabled: false } });
    expect(doc.variants!.side).toEqual({});
    doc = run(doc, { type: "removeVariant", streamId: "side" });
    expect(Object.keys(doc.variants!)).toEqual(["front"]);
  });

  it("works on the R2 reference document without new structure errors", () => {
    const r2 = readContractJson<OverlayDocument>("fixtures/documents/valid/reference-r2-typical.json");
    const ids = Object.keys(r2.elements).filter((id) => r2.children.includes(id));
    let doc = run(r2, { type: "groupElements", ids: ids.slice(0, 2), groupId: "e_tg", variant: null });
    doc = run(doc, { type: "ungroup", group: "e_tg", variant: null });
    doc = run(doc, { type: "deleteElements", ids: [ids[0]], variant: null });
    expect(structure(doc).filter((d) => d.category === "structure")).toEqual([]);
  });
});
