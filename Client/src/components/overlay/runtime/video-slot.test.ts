// Picture-in-picture (videoStream): video slots for the host and the SVG frame.
import { describe, expect, it } from "vitest";
import { effectiveConfig } from "../document";
import type { OverlayDocument, OverlayElement } from "../document/types";
import { FakeValueSource } from "../sources/testing/fake-value-source";
import { createRuntime } from "./runtime";
import { SceneBuilder } from "./scene";
import type { RenderMode } from "./types";
import { toMarkup } from "./vnode";

function render(elements: Record<string, OverlayElement>, opts: { mode?: RenderMode; doc?: Partial<OverlayDocument> } = {}) {
  const doc: OverlayDocument = {
    schemaVersion: 1,
    workspace: { width: 1280, height: 720 },
    elements,
    children: Object.keys(elements).filter((id) => !Object.values(elements).some((e) => e.children?.includes(id))),
    ...opts.doc,
  };
  const config = effectiveConfig(doc, null);
  const rt = createRuntime(config, {});
  const frame = opts.mode === "design" ? rt.baseFrame() : rt.step(0, new FakeValueSource());
  const scene = new SceneBuilder(config, { locale: "de", pxPerUnit: 1, idPrefix: "ovl-", assets: {}, mode: opts.mode ?? "live" }, rt.staticElements()).build(frame);
  return { scene, markup: toMarkup(scene.tree) };
}

describe("videoStream", () => {
  it("reports a slot with catalog defaults and its world matrix", () => {
    const { scene } = render({ e_v: { type: "videoStream", source: "rear", props: { x: 900, y: 40 } } });
    expect(scene.videos).toEqual([{
      element: "e_v", source: "rear", matrix: [1, 0, 0, 1, 900, 40],
      width: 320, height: 180, cornerRadius: 0, fit: "cover", background: "#000000", opacity: 1,
    }]);
  });

  it("includes group transforms, the root transform and the groups' opacity", () => {
    const { scene } = render({
      e_g: { type: "group", children: ["e_v"], props: { x: 100, pivotX: 0, pivotY: 0, opacity: 0.5 } },
      e_v: { type: "videoStream", source: "rear", props: { x: 10, width: 200, height: 100, opacity: 0.8, fit: "contain" } },
    }, { doc: { rootTransform: { scale: 2, offsetX: 5, offsetY: 0 } } });
    expect(scene.videos).toHaveLength(1);
    expect(scene.videos[0].matrix).toEqual([2, 0, 0, 2, 225, 0]);
    expect(scene.videos[0].opacity).toBeCloseTo(0.4);
    expect(scene.videos[0].fit).toBe("contain");
  });

  it("has no slot while it or a parent group is hidden", () => {
    expect(render({ e_v: { type: "videoStream", source: "rear", props: { visible: false } } }).scene.videos).toEqual([]);
    expect(render({
      e_g: { type: "group", children: ["e_v"], props: { visible: false } },
      e_v: { type: "videoStream", source: "rear" },
    }).scene.videos).toEqual([]);
  });

  it("draws only the frame live and a filled placeholder with the stream name in design mode", () => {
    const live = render({ e_v: { type: "videoStream", source: "rear", props: { strokeWidth: 3, cornerRadius: 6 } } }).markup;
    expect(live).toContain('<rect width="320" height="180" rx="6" fill="none" stroke="#ffffff" stroke-width="3"/>');
    expect(live).not.toContain("rear");
    const design = render({ e_v: { type: "videoStream", source: "rear" } }, { mode: "design" }).markup;
    expect(design).toContain('fill="#000000"');
    expect(design).toContain("▶ rear");
  });

  it("draws no frame without stroke", () => {
    const { markup } = render({ e_v: { type: "videoStream", source: "rear", props: { stroke: "none" } } });
    expect(markup).not.toContain("<rect");
  });
});
