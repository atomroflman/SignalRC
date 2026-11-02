import { describe, expect, it } from "vitest";
import { validate } from "../document/validate";
import type { OverlayDocument } from "../document/types";
import { EditorStore } from "../editor/core/store";
import { startDocument } from "../editor/testing/in-memory-persistence";
import { EditorAssetLoader, editorResolveContext, previewStream, viewBoxMetadata } from "./editor-assets";
import { insertAssetElement } from "./svg-import-dialog";

const ID = `sha256-${"a".repeat(64)}`;
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect data-part="bg" width="200" height="100" fill="#000000"/><path data-part="p_needle" d="M100 100L100 10" stroke="#ffffff"/></svg>';
const META = { width: 200, height: 100, parts: { bg: { tag: "rect", bbox: [0, 0, 200, 100] as [number, number, number, number] }, p_needle: { tag: "path", bbox: [100, 10, 0, 90] as [number, number, number, number] } } };

const withAsset = (): OverlayDocument => ({ ...startDocument(), elements: { e_s: { type: "svgAsset", assetId: ID, props: { x: 0 } } }, children: ["e_s"] });
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("asset metadata for the editor", () => {
  it("derives size and part ids from the normalized output", () => {
    const m = viewBoxMetadata(SVG)!;
    expect(m.width).toBe(200);
    expect(m.height).toBe(100);
    expect(Object.keys(m.parts)).toEqual(["bg", "p_needle"]);
    expect(viewBoxMetadata("<svg>")).toBeUndefined();
  });

  it("resolve context knows sources, streams and assets; part references validate", () => {
    const ctx = editorResolveContext(
      { telemetry: [{ name: "heading", dataType: "Number" }], outputs: ["steer"], streams: [{ streamId: "front" }] },
      { [ID]: { svg: SVG, metadata: META } },
    );
    expect(ctx.sources).toEqual({ telemetry: { heading: "Number" }, outputs: ["steer"] });
    expect(ctx.streams).toEqual(["front"]);
    expect(ctx.assets?.[ID]).toMatchObject({ width: 200, height: 100 });
    const doc: OverlayDocument = { ...withAsset(), elements: { e_s: { type: "svgAsset", assetId: ID, props: {}, parts: { p_needle: { props: { rotation: 10 } } } } } };
    expect(validate(doc, ctx).filter((d) => d.category === "structure")).toEqual([]);
    const unknownPart: OverlayDocument = { ...doc, elements: { e_s: { ...doc.elements.e_s, parts: { nope: { props: {} } } } } };
    expect(validate(unknownPart, ctx).some((d) => d.code === "OVL_REF_UNKNOWN_PART")).toBe(true);
  });

  it("without vehicle data only assets and the analyzer are given", () => {
    const ctx = editorResolveContext(null, {});
    expect(ctx.sources).toBeUndefined();
    expect(ctx.streams).toBeUndefined();
    expect(ctx.expressions).toBeDefined();
  });
});

describe("EditorAssetLoader", () => {
  it("loads each referenced asset once and takes the server metadata from the idempotent upload", async () => {
    const calls: string[] = [];
    const loader = new EditorAssetLoader({
      getAsset: async (id) => { calls.push(`get ${id}`); return SVG; },
      upload: async (svg) => { calls.push("upload"); return { assetId: ID, metadata: META, svg, report: [] }; },
    });
    let changes = 0;
    loader.subscribe(() => changes++);
    await Promise.all([loader.ensure(withAsset()), loader.ensure(withAsset())]);
    await loader.ensure(withAsset());
    expect(calls).toEqual([`get ${ID}`, "upload"]);
    expect(loader.current[ID]).toEqual({ svg: SVG, metadata: META });
    expect(changes).toBe(1);
  });

  it("keeps the text when the upload is not possible (no control)", async () => {
    const loader = new EditorAssetLoader({ getAsset: async () => SVG, upload: () => Promise.reject(new Error("no control")) });
    await loader.ensure(withAsset());
    expect(loader.current[ID]).toEqual({ svg: SVG });
    // A later known metadata replaces the text-only entry.
    loader.add({ [ID]: { svg: SVG, metadata: META } });
    expect(loader.current[ID].metadata).toEqual(META);
  });

  it("remembers failures until retried", async () => {
    let fail = true;
    const loader = new EditorAssetLoader({ getAsset: async () => { if (fail) throw new Error("404"); return SVG; } });
    await loader.ensure(withAsset());
    expect(loader.failedIds).toEqual([ID]);
    fail = false;
    await loader.ensure(withAsset());
    expect(loader.current[ID]).toBeUndefined();
    loader.retryFailed();
    await loader.ensure(withAsset());
    expect(loader.current[ID]).toEqual({ svg: SVG });
  });

  it("ignores results after dispose", async () => {
    let resolve!: (s: string) => void;
    const loader = new EditorAssetLoader({ getAsset: () => new Promise((r) => { resolve = r; }) });
    const p = loader.ensure(withAsset());
    loader.dispose();
    resolve(SVG);
    await p;
    await tick();
    expect(loader.current[ID]).toBeUndefined();
  });
});

describe("SVG import inserts the asset element as one undo step", () => {
  it("places it centered and selects it", () => {
    const store = new EditorStore({ carId: 1, document: startDocument() });
    const id = insertAssetElement(store, { assetId: ID, metadata: { ...META, assetId: ID } })!;
    const el = store.document.elements[id];
    expect(el).toMatchObject({ type: "svgAsset", assetId: ID, props: { x: 860, y: 490 } });
    expect(store.getState().selection).toEqual([id]);
    store.undo();
    expect(store.document.elements[id]).toBeUndefined();
  });
});

describe("preview stream", () => {
  const streams = [
    { serverId: 1, streamId: "front", enabled: true },
    { serverId: 2, streamId: "rear", enabled: true },
    { serverId: 3, streamId: "off", enabled: false },
  ];
  it("prefers the active variant's stream, then the last selected, then the first enabled", () => {
    expect(previewStream(streams, "rear")?.serverId).toBe(2);
    expect(previewStream(streams, "off", 1)?.serverId).toBe(1);
    expect(previewStream(streams, null, 2)?.serverId).toBe(2);
    expect(previewStream(streams, null)?.serverId).toBe(1);
    expect(previewStream([], null)).toBeUndefined();
  });
});
