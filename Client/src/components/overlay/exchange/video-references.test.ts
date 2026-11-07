// Picture-in-picture sources count as stream references and follow the stream mapping.
import { describe, expect, it } from "vitest";
import type { OverlayDocument } from "../document/types";
import { applyReferenceMapping, collectReferences } from "./references";

const doc = (): OverlayDocument => ({
  schemaVersion: 1,
  workspace: { width: 1280, height: 720 },
  elements: { e_v: { type: "videoStream", source: "rear" } },
  children: ["e_v"],
  variants: { front: { addedElements: { e_w: { type: "videoStream", source: "side" } }, structure: { parents: { e_w: "root" } } } },
});

describe("videoStream references", () => {
  it("lists variant keys and video sources together", () => {
    expect(collectReferences(doc()).streams).toEqual(["front", "rear", "side"]);
  });

  it("renames video sources in the standard and in variants", () => {
    const out = applyReferenceMapping(doc(), { streams: { rear: "backCam", side: "leftCam" } });
    expect(out.elements.e_v.source).toBe("backCam");
    expect(out.variants!.front.addedElements!.e_w.source).toBe("leftCam");
  });
});
