// UI smoke tests (server rendering, no jsdom): simulation panel, preview stage, editor with preview.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { effectiveConfig } from "../document";
import type { OverlayDocument } from "../document/types";
import { EditorStore } from "../editor/core/store";
import { InMemoryOverlayServer } from "../editor/testing/in-memory-persistence";
import { OverlayEditor } from "../editor/overlay-editor";
import { createRuntime } from "../runtime/runtime";
import { TestClock } from "../runtime/testing/test-clock";
import { readContractJson } from "../testing/fixtures";
import { OverlayEditorWithPreview } from "./editor-with-preview";
import { previewMessages } from "./messages";
import { OverlayPreview } from "./overlay-preview";
import { PreviewSession } from "./session";
import { SimulationPanel } from "./simulation-panel";

const r2 = () => readContractJson<OverlayDocument>("fixtures/documents/valid/reference-r2-typical.json");

describe("preview UI", () => {
  it("the panel lists the HUD's values with their simulation controls", () => {
    const config = effectiveConfig(r2(), null);
    const deps = createRuntime(config).dependencies();
    const session = new PreviewSession({ clock: new TestClock() });
    session.setOverride("tel", "odoSpeed", { generator: { kind: "sine", offset: 1, amplitude: 1, periodS: 2 }, quality: "unchecked" });
    session.setOverride("tel", "lidarGrid", { generator: { kind: "lidar", obstacles: [{ angleDeg: 0, widthDeg: 10, distanceMm: 600 }] } });
    session.setOverride("tel", "gone", { generator: { kind: "fixed", value: 1 } });
    const html = renderToStaticMarkup(<SimulationPanel session={session} m={previewMessages.de} dependencies={deps} />);
    expect(html).toContain('data-ovl-preview-mode="design"');
    expect(deps.length).toBeGreaterThan(5);
    for (const d of deps.filter((x) => x.kind !== "driver")) expect(html).toContain(`data-ovl-sim-channel="${d.kind}:${d.name}"`);
    // Overrides of values no longer used stay removable.
    expect(html).toContain('data-ovl-sim-channel="tel:gone"');
    expect(html).toContain("Sinus");
    expect(html).toContain("ungeprüft");
    expect(html).toContain('data-ovl-sim-obstacle="0"');
    expect(html).toContain("lösen keine Fahrzeugbefehle aus");
    session.dispose();
  });

  it("the preview stage renders the runtime in preview mode with a badge and an optional video layer", () => {
    const session = new PreviewSession({ clock: new TestClock() });
    session.enterPreview();
    const config = effectiveConfig(r2(), null);
    const plain = renderToStaticMarkup(<OverlayPreview session={session} config={config} locale="en" m={previewMessages.en} />);
    expect(plain).toContain('data-ovl-mode="preview"');
    expect(plain).toContain("Preview – local test values");
    const withVideo = renderToStaticMarkup(
      <OverlayPreview session={session} config={config} locale="de" m={previewMessages.de} videoLayer={(hud) => <div data-video="">{hud}</div>} />,
    );
    expect(withVideo).toMatch(/data-video="">.*data-ovl-mode="preview"/);
    // The workspace outline travels with the HUD into the video layer, in workspace units.
    expect(withVideo).toMatch(/data-video="">.*data-ovl-workspace-outline=""/);
    const { width, height } = config.workspace;
    expect(withVideo).toContain(`viewBox="0 0 ${width} ${height}"`);
    expect(withVideo).toContain(previewMessages.de.workspaceOutline);
    session.pause();
    expect(renderToStaticMarkup(<SimulationPanel session={session} m={previewMessages.de} dependencies={[]} />)).toContain("Abspielen");
    session.dispose();
  });

  it("the editor with preview renders without browser APIs and keeps the design surface by default", () => {
    const server = new InMemoryOverlayServer(3);
    const html = renderToStaticMarkup(<OverlayEditorWithPreview carId={3} persistence={server.client()} hasControl locale="de" />);
    expect(html).toContain('data-ovl-editor="3"');
    expect(html).toContain("data-ovl-design-canvas");
  });

  it("in preview the stage replaces the design surface (no drag-and-drop design)", () => {
    const server = new InMemoryOverlayServer(3);
    const html = renderToStaticMarkup(<OverlayEditor carId={3} persistence={server.client()} hasControl locale="de" stage={<div data-stage="" />} />);
    expect(html).toContain("data-stage");
    expect(html).not.toContain("data-ovl-design-canvas");
  });

  it("simulation settings are not document content", () => {
    const store = new EditorStore({ carId: 1, document: r2() });
    const before = JSON.stringify(store.getState().document);
    const session = new PreviewSession({ clock: new TestClock() });
    session.enterPreview();
    session.setSimulateAll(true);
    session.setOverride("tel", "odoSpeed", { generator: { kind: "fixed", value: 3 } });
    expect(JSON.stringify(store.getState().document)).toBe(before);
    expect(store.getState().history.canUndo).toBe(false);
    session.dispose();
  });
});
