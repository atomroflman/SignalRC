// UI smoke test (server rendering, no jsdom) and the editor actions behind the buttons.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { OverlayDocument } from "../../document/types";
import { readContractJson } from "../../testing/fixtures";
import { EditorStore } from "../core/store";
import { OverlayEditor } from "../overlay-editor";
import { SaveController } from "../persistence/autosave";
import { InMemoryOverlayServer } from "../testing/in-memory-persistence";
import { align, duplicateSelection, groupSelection, insertElement, planDelete, ungroupSelection, disableInVariant } from "./actions";
import { DesignCanvas } from "./design-canvas";
import { editorMessages } from "./messages";
import { LayersPanel, TransformPanel } from "./panels";
import { SaveStatus } from "./save-ui";
import { VariantBar } from "./variant-bar";

const r2 = () => readContractJson<OverlayDocument>("fixtures/documents/valid/reference-r2-typical.json");
const variants = () => readContractJson<OverlayDocument>("fixtures/documents/valid/variants-clips-lidar.json");

describe("server-rendered UI", () => {
  it("renders the whole editor without browser APIs", () => {
    const server = new InMemoryOverlayServer(3);
    const html = renderToStaticMarkup(<OverlayEditor carId={3} persistence={server.client()} hasControl locale="de" streams={[{ streamId: "front" }]} />);
    expect(html).toContain("data-ovl-editor=\"3\"");
    expect(html).toContain("data-ovl-design-canvas");
    expect(html).toContain("Standard");
  });

  it("panels show layers, inheritance markers and the transform of the selection", () => {
    const doc = variants();
    const store = new EditorStore({ carId: 1, document: doc });
    const stream = Object.keys(doc.variants ?? {})[0];
    store.setActiveVariant(stream);
    const first = store.effective().root[0];
    store.select([first]);
    const m = editorMessages.de;
    const layers = renderToStaticMarkup(<LayersPanel store={store} m={m} />);
    for (const id of store.effective().root) expect(layers).toContain(`data-ovl-layer="${id}"`);
    expect(renderToStaticMarkup(<TransformPanel store={store} m={m} />)).toContain(`data-ovl-transform="${first}"`);
    expect(renderToStaticMarkup(<VariantBar store={store} m={m} streams={[{ streamId: stream }]} />)).toContain(stream);
    expect(renderToStaticMarkup(<DesignCanvas store={store} locale="en" />)).toContain("data-ovl-mode=\"design\"");
  });

  it("save status shows the contract states", async () => {
    const server = new InMemoryOverlayServer(1);
    const store = new EditorStore({ carId: 1, document: r2() });
    const save = new SaveController({ store, persistence: server.client() });
    await save.open();
    expect(renderToStaticMarkup(<SaveStatus save={save} m={editorMessages.de} carId={1} />)).toContain("gespeichert");
    save.setControl(false);
    expect(renderToStaticMarkup(<SaveStatus save={save} m={editorMessages.de} carId={1} />)).toContain("nur lokal");
    save.dispose();
  });
});

describe("actions", () => {
  it("delete asks for confirmation only when variants or clips are affected", () => {
    const store = new EditorStore({ carId: 1, document: variants() });
    const doc = store.document;
    const affected = Object.keys(doc.elements).find((id) => Object.values(doc.variants ?? {}).some((v) => v.elements?.[id]));
    expect(affected).toBeDefined();
    store.select([affected!]);
    expect(planDelete(store).kind).toBe("confirm");
    const plain = new EditorStore({ carId: 1, document: { schemaVersion: 1, workspace: { width: 10, height: 10 }, elements: { e_a: { type: "rect" } }, children: ["e_a"] } });
    plain.select(["e_a"]);
    expect(planDelete(plain).kind).toBe("direct");
  });

  it("in a variant inherited elements are disabled instead of deleted", () => {
    const store = new EditorStore({ carId: 1, document: { schemaVersion: 1, workspace: { width: 10, height: 10 }, elements: { e_a: { type: "rect" } }, children: ["e_a"], variants: { s: {} } } });
    store.setActiveVariant("s");
    store.select(["e_a"]);
    const plan = planDelete(store);
    expect(plan).toEqual({ kind: "inherited", ids: ["e_a"] });
    disableInVariant(store, ["e_a"]);
    expect(store.document.variants!.s.elements!.e_a.disabled).toBe(true);
    expect(store.document.elements.e_a.disabled).toBeUndefined();
  });

  it("insert, group, ungroup, duplicate and align work as single undo steps", () => {
    const store = new EditorStore({ carId: 1, document: { schemaVersion: 1, workspace: { width: 400, height: 200 }, elements: {}, children: [] } });
    insertElement(store, "rect");
    insertElement(store, "text");
    const [a, b] = store.document.children;
    store.dispatch({ type: "setProperty", element: b, property: "x", value: 300 });
    store.select([a, b]);
    align(store, "left");
    expect(store.getState().history.undoLabel).toBe("Ausrichten");
    groupSelection(store);
    const g = store.getState().selection[0];
    expect(store.document.elements[g].type).toBe("group");
    duplicateSelection(store);
    expect(store.document.children).toHaveLength(2);
    store.select([g]);
    ungroupSelection(store);
    expect(store.document.elements[g]).toBeUndefined();
    expect(store.getState().selection.sort()).toEqual([a, b].sort());
    const steps = store.getState().history.size;
    expect(steps).toBe(7);
    for (let i = 0; i < steps; i++) store.undo();
    expect(store.document.children).toEqual([]);
  });
});
