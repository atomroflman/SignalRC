import { describe, expect, it } from "vitest";
import { deleteElements, deletionImpact } from "./deletion";
import type { OverlayDocument } from "./types";
import { validate } from "./validate";

const doc: OverlayDocument = {
  schemaVersion: 1,
  workspace: { width: 100, height: 100 },
  elements: {
    e_g: { type: "group", children: ["e_a", "e_b"] },
    e_a: { type: "rect" },
    e_b: { type: "rect" },
    e_c: { type: "rect" },
  },
  children: ["e_g", "e_c"],
  clips: {
    c_1: { durationS: 1, trigger: { mode: "auto" }, tracks: [
      { element: "e_a", property: "x", keyframes: [{ t: 0, value: 0 }] },
      { element: "e_c", property: "x", keyframes: [{ t: 0, value: 0 }] },
    ] },
  },
  variants: {
    cam: {
      elements: { e_a: { props: { x: 5 } }, e_c: { props: { x: 6 } } },
      addedElements: { e_v: { type: "group", children: ["e_w"] }, e_w: { type: "rect" }, e_keep: { type: "rect" } },
      structure: { parents: { e_v: "e_g", e_c: "e_g", e_keep: "root" }, order: { e_g: ["e_c", "e_a"], root: ["e_keep", "e_g"] } },
      addedClips: { c_v: { durationS: 1, trigger: { mode: "auto" }, tracks: [{ element: "e_w", property: "x", keyframes: [{ t: 0, value: 0 }] }] } },
    },
    other: { elements: { e_c: { disabled: true } } },
  },
};

describe("deletion of a standard group", () => {
  it("lists the elements, variant adjustments and clip tracks it removes", () => {
    expect(deletionImpact(doc, ["e_g"])).toEqual({
      elements: ["e_a", "e_b", "e_g"],
      clips: [{ clip: "c_1", tracks: [0] }],
      variants: [{
        streamId: "cam",
        overrides: ["e_a"],
        addedElements: ["e_v", "e_w"],
        structureEntries: ["e_c", "e_v"],
        clips: [{ clip: "c_v", tracks: [0] }],
      }],
    });
  });

  it("removes them and leaves a valid document", () => {
    const next = deleteElements(doc, ["e_g"]);
    expect(Object.keys(next.elements).sort()).toEqual(["e_c"]);
    expect(next.children).toEqual(["e_c"]);
    expect(next.clips!.c_1.tracks.map((t) => t.element)).toEqual(["e_c"]);
    const cam = next.variants!.cam;
    expect(Object.keys(cam.addedElements!)).toEqual(["e_keep"]);
    expect(cam.elements).toEqual({ e_c: { props: { x: 6 } } });
    expect(cam.structure).toEqual({ parents: { e_keep: "root" }, order: { root: ["e_keep"] } });
    expect(cam.addedClips!.c_v.tracks).toEqual([]);
    expect(validate(next)).toEqual([]);
    expect(doc.elements.e_g).toBeDefined();
  });

  it("ignores unknown ids", () => {
    expect(deletionImpact(doc, ["e_nope"])).toEqual({ elements: [], clips: [], variants: [] });
  });
});
