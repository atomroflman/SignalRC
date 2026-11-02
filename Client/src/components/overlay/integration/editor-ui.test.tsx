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

  it("disables the SVG import without control", () => {
    const store = new EditorStore({ carId: 1, document: startDocument() });
    const html = renderToStaticMarkup(
      <SvgImportDialog store={store} carId={1} locale="en" m={integrationMessages.en.svgImport} canImport={false} onAsset={() => {}} />,
    );
    expect(html).toContain("disabled");
    expect(html).toContain(integrationMessages.en.svgImport.noControl);
  });
});
