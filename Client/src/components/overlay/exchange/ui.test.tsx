// UI smoke tests (server rendering, no jsdom) of the exchange and template components.
import { createHash } from "node:crypto";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { OverlayDocument } from "../document/types";
import { EditorStore } from "../editor/core/store";
import { TemplateInserter } from "../templates/template-inserter";
import { readContractJson } from "../testing/fixtures";
import { prepareImport, type AssetUploader } from "./import";
import { exchangeMessages } from "./messages";
import type { OverlayPackage, VehicleSources } from "./package";
import { ImportDialog, PackageExchange } from "./package-exchange";

const f = () => readContractJson<{ package: OverlayPackage; target: VehicleSources }>("fixtures/exchange/roundtrip.json");
const empty = (): OverlayDocument => ({ schemaVersion: 1, workspace: { width: 640, height: 360 }, elements: {}, children: [] });
const upload: AssetUploader = async (svg) => {
  const id = `sha256-${createHash("sha256").update(svg).digest("hex")}`;
  const parts: Record<string, { tag: string; bbox: [number, number, number, number] }> = {};
  for (const m of svg.matchAll(/<(\w+) data-part="([^"]+)"/g)) parts[m[2]] = { tag: m[1], bbox: [0, 0, 1, 1] };
  return { kind: "accepted", result: { assetId: id, svg, metadata: { assetId: id, width: 10, height: 10, parts }, report: [] } };
};

describe("exchange UI", () => {
  it("renders export and import actions", () => {
    const store = new EditorStore({ carId: 1, document: empty() });
    const html = renderToStaticMarkup(
      <PackageExchange store={store} carId={1} locale="de" vehicle={f().target} getAsset={async () => ""} upload={upload} canImport={false} />,
    );
    expect(html).toContain("data-ovl-exchange");
    expect(html).toContain("Paket exportieren");
    expect(html).toContain(exchangeMessages.de.noControl);
  });

  it("the import dialog shows mapping, unresolved references and blocking problems", async () => {
    const fx = f();
    const prepared = await prepareImport(fx.package, upload);
    if (!prepared.ok) throw new Error("prepare");
    const html = renderToStaticMarkup(
      <ImportDialog prepared={prepared.import} vehicle={fx.target} locale="de" m={exchangeMessages.de} onCancel={() => {}} onConfirm={() => {}} />,
    );
    expect(html).toContain("data-ovl-import-dialog");
    for (const from of ["speed", "scan", "legacy", "steer", "cam1"]) expect(html).toContain(`data-ovl-map-from="${from}"`);
    // Unmapped: foreign channels are listed and block publishing.
    expect(html).toContain("Telemetriekanal „speed“ gibt es auf diesem Fahrzeug nicht");
    expect(html).toMatch(/data-ovl-import-blocking="\d+"/);
    expect(html).toContain("Tempo (e_speed)");
    expect(html).toContain("Entwurf ersetzen");
    // The LiDAR grid row only offers grid channels.
    const scanRow = html.slice(html.indexOf('data-ovl-map-from="scan"'), html.indexOf("</select>", html.indexOf('data-ovl-map-from="scan"')));
    expect(scanRow).toContain("lidarGrid");
    expect(scanRow).not.toContain("odoSpeed");
  });
});

describe("template UI", () => {
  const channels = [{ name: "yaw", dataType: "Number", unit: "rad" }, { name: "scan", dataType: "LidarGrid" }];

  it("lists the templates", () => {
    const store = new EditorStore({ carId: 1, document: empty() });
    const html = renderToStaticMarkup(<TemplateInserter store={store} locale="de" channels={channels} />);
    for (const id of ["compass", "attitude", "trackRun", "distanceWarning", "lidarGrid"]) expect(html).toContain(`data-ovl-template="${id}"`);
  });

  it("preselects an unambiguous channel with its conversion and shows the preview", () => {
    const store = new EditorStore({ carId: 1, document: empty() });
    const html = renderToStaticMarkup(<TemplateInserter store={store} locale="de" channels={channels} initialTemplate="compass" />);
    expect(html).toContain('data-ovl-slot="heading"');
    expect(html).toMatch(/<option value="yaw" selected="">/);
    expect(html).toMatch(/<option value="rad" selected="">/);
    expect(html).toContain("Vorschau (Grundwerte, keine Messwerte)");
    expect(html).not.toMatch(/data-ovl-template-insert="" disabled/);
  });

  it("without a fitting channel nothing can be inserted", () => {
    const store = new EditorStore({ carId: 1, document: empty() });
    const html = renderToStaticMarkup(<TemplateInserter store={store} locale="en" channels={[]} initialTemplate="distanceWarning" />);
    expect(html).toContain("No fitting channel on this vehicle");
    expect(html).toMatch(/disabled=""[^>]*data-ovl-template-insert/);
  });
});
