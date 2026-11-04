// UI smoke tests (server rendering, no jsdom) of the editor page parts and the
// central registration of the module texts.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { messagesByLocale } from "@/i18n/translations";
import { editorMessages } from "../editor/canvas/messages";
import { EditorStore } from "../editor/core/store";
import { dynamicsMessages } from "../editor/inspector/messages";
import { SaveController } from "../editor/persistence/autosave";
import { InMemoryOverlayServer, startDocument } from "../editor/testing/in-memory-persistence";
import { MemoryBackupStore } from "../editor/testing/memory-backup-store";
import { exchangeMessages } from "../exchange/messages";
import { previewMessages } from "../preview/messages";
import { templateMessages } from "../templates/messages";
import { integrationMessages } from "./messages";
import { PublishPanel } from "./publish-panel";
import { SvgImportDialog } from "./svg-import-dialog";
import { VideoFrameMark } from "./editor-page";

function keysDeep(o: unknown, prefix = ""): string[] {
  if (!o || typeof o !== "object") return [prefix];
  return Object.entries(o).flatMap(([k, v]) => keysDeep(v, prefix ? `${prefix}.${k}` : k)).sort();
}

describe("central texts (messages.overlay)", () => {
  it("contains the texts of editor, inspector, preview, exchange and templates", () => {
    for (const locale of ["de", "en"] as const) {
      const o = messagesByLocale[locale].overlay;
      expect(o.editor).toBe(editorMessages[locale]);
      expect(o.dynamics).toBe(dynamicsMessages[locale]);
      expect(o.preview).toBe(previewMessages[locale]);
      expect(o.exchange).toBe(exchangeMessages[locale]);
      expect(o.templates).toBe(templateMessages[locale]);
      expect(o.editorPage).toBe(integrationMessages[locale].editorPage);
      expect(o.publish).toBe(integrationMessages[locale].publish);
    }
  });

  it("has the same editor page keys in both languages", () => {
    for (const k of ["editorPage", "publish", "svgImport"] as const) {
      expect(keysDeep(integrationMessages.en[k])).toEqual(keysDeep(integrationMessages.de[k]));
    }
  });
});

describe("editor page parts", () => {
  it("renders publish and history controls", async () => {
    const server = new InMemoryOverlayServer(1);
    const persistence = server.client();
    const store = new EditorStore({ carId: 1, document: startDocument() });
    const save = new SaveController({ store, persistence, backups: new MemoryBackupStore() });
    await save.open();
    const html = renderToStaticMarkup(
      <PublishPanel carId={1} store={store} save={save} persistence={persistence} locale="de" m={integrationMessages.de.publish} />,
    );
    expect(html).toContain("data-ovl-publish");
    expect(html).toContain("Veröffentlichen");
    expect(html).toContain("Versionsverlauf");
    save.dispose();
  });

  it("explains a disabled publish button by the control reason (D73)", async () => {
    const server = new InMemoryOverlayServer(1);
    const persistence = server.client();
    const store = new EditorStore({ carId: 1, document: startDocument() });
    const save = new SaveController({ store, persistence, backups: new MemoryBackupStore(), hasControl: false });
    await save.open();
    for (const reason of ["offline", "notDriver"] as const) {
      const html = renderToStaticMarkup(
        <PublishPanel carId={1} store={store} save={save} persistence={persistence} locale="de" m={integrationMessages.de.publish} reason={reason} />,
      );
      expect(html).toContain(`data-ovl-no-control="${reason}"`);
      expect(html).toContain(integrationMessages.de.publish.noControlHint[reason]);
    }
    save.dispose();
  });

  it("marks the displayed video frame with its received size and the workspace size", () => {
    const workspace = { width: 1920, height: 1080 };
    const frame = { left: 0, top: 40, width: 800, height: 450 };
    const playing = renderToStaticMarkup(
      <VideoFrameMark geometry={{ box: { width: 800, height: 530 }, media: { width: 1280, height: 720 }, frame }} workspace={workspace} m={integrationMessages.de.editorPage} />,
    );
    expect(playing).toContain("data-ovl-video-frame");
    expect(playing).toContain('data-ovl-video-size="1280x720"');
    expect(playing).toContain("Video 1280×720 · Arbeitsfläche 1920×1080");
    const none = renderToStaticMarkup(
      <VideoFrameMark geometry={{ box: { width: 800, height: 530 }, media: { width: 0, height: 0 }, frame: null }} workspace={workspace} m={integrationMessages.en.editorPage} />,
    );
    expect(none).not.toContain("data-ovl-video-frame");
    expect(none).toContain("No video picture · Workspace 1920×1080");
  });

  it("disables the SVG import without control", () => {
    const store = new EditorStore({ carId: 1, document: startDocument() });
    const html = renderToStaticMarkup(
      <SvgImportDialog store={store} carId={1} locale="en" m={integrationMessages.en.svgImport} canImport={false} onAsset={() => {}} />,
    );
    expect(html).toContain("disabled");
    expect(html).toContain(integrationMessages.en.svgImport.noControl);
  });
});
