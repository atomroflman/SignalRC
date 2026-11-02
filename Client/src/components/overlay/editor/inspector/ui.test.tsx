// AP10 UI smoke tests (server rendering, no jsdom): inspector and timeline
// render the store state, formula diagnostics, live values and the playhead.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { OverlayDocument } from "../../document/types";
import { FakeValueSource } from "../../sources/testing/fake-value-source";
import { readContractJson } from "../../testing/fixtures";
import { EditorStore } from "../core/store";
import { OverlayEditor } from "../overlay-editor";
import { InMemoryOverlayServer } from "../testing/in-memory-persistence";
import { TimelinePanel } from "../timeline/timeline-panel";
import { scrubTo } from "../timeline/model";
import { parseSourcesResponse } from "./channels";
import { PropertyInspector } from "./property-inspector";

const variants = () => readContractJson<OverlayDocument>("fixtures/documents/valid/variants-clips-lidar.json");
const dir = parseSourcesResponse({
  telemetry: [
    { id: 1, channelName: "speed", dataType: "number", unit: "km/h", decimals: 1 },
    { id: 3, channelName: "lidarGrid", dataType: "lidarGrid", zoneLimitsMm: [500, 1000, 2000, 3000, 5000] },
    { id: 4, channelName: "batteryVoltage", dataType: "number", unit: "V", decimals: 2 },
    { id: 5, channelName: "odoSpeed", dataType: "number" },
  ],
  outputs: [{ id: 9, channelName: "steering" }],
});

describe("property inspector", () => {
  it("asks for a selection", () => {
    const store = new EditorStore({ carId: 1, document: variants() });
    expect(renderToStaticMarkup(<PropertyInspector store={store} locale="de" />)).toContain("Element auswählen");
  });

  it("shows modes, a simple channel binding with live value and the base value", () => {
    const store = new EditorStore({ carId: 1, document: variants() });
    store.select(["e_steer"]);
    const src = new FakeValueSource();
    src.set("out", "steering", { state: "valid", value: 0.5 });
    const html = renderToStaticMarkup(<PropertyInspector store={store} locale="de" channels={dir} source={src} />);
    expect(html).toContain("data-ovl-inspector=\"e_steer\"");
    expect(html).toMatch(/data-ovl-prop="value" data-ovl-mode="binding"/);
    expect(html).toContain("data-ovl-channel-picker");
    expect(html).toContain("data-ovl-simple-binding=\"out(&quot;steering&quot;)\"");
    expect(html).toContain("Live: 0,5 (gültig)");
    expect(html).toContain("Grundwert");
    expect(html).toMatch(/data-ovl-prop="orientation" data-ovl-mode="static"/);
  });

  it("shows formula diagnostics of AP06 and the rate editor", () => {
    const doc = variants();
    doc.elements.e_belt.props!.x = { base: 0, rate: { expr: "tel(\"odoSpeed\") *" } };
    const store = new EditorStore({ carId: 1, document: doc });
    store.select(["e_belt"]);
    const html = renderToStaticMarkup(<PropertyInspector store={store} locale="en" channels={dir} />);
    expect(html).toMatch(/data-ovl-prop="x" data-ovl-mode="rate"/);
    expect(html).toContain("data-ovl-diagnostic=\"OVL_EXPR_SYNTAX\"");
    expect(html).toContain("Wrap");
  });

  it("marks overrides in a variant and shows LiDAR source and widget parameters", () => {
    const store = new EditorStore({ carId: 1, document: variants() });
    store.setActiveVariant("front-wide");
    store.select(["e_lidar"]);
    const html = renderToStaticMarkup(<PropertyInspector store={store} locale="de" channels={dir} />);
    expect(html).toContain("data-ovl-lidar-source=\"lidarGrid\"");
    expect(html).toContain("Zonengrenzen der Quelle: 0.5 m / 1 m / 2 m / 3 m / 5 m");
    expect(html).toContain("data-ovl-section=\"widget\"");
    expect(html).toContain("Überschreibung zurücksetzen");
    for (const p of ["sectors", "nearDistanceM", "farDistanceM", "blinkNearHz", "blinkFarHz", "afterglowS", "nearColor", "sweepEnabled"]) {
      expect(html).toContain(`data-ovl-prop="${p}"`);
    }
  });

  it("valueText shows unit and decimals from the source", () => {
    const store = new EditorStore({
      carId: 1,
      document: {
        schemaVersion: 1, workspace: { width: 100, height: 100 }, children: ["e_v"],
        elements: { e_v: { type: "valueText", props: { value: { base: null, binding: { expr: "tel(\"speed\")" } } } } },
      },
    });
    store.select(["e_v"]);
    const html = renderToStaticMarkup(<PropertyInspector store={store} locale="de" channels={dir} />);
    expect(html).toContain("aus Quelle (km/h)");
    expect(html).toContain("aus Quelle (1)");
  });
});

describe("timeline", () => {
  it("shows clips, trigger, tracks, keyframes and the playhead", () => {
    const store = new EditorStore({ carId: 1, document: variants() });
    scrubTo(store, "c_low_battery", 0.5);
    const html = renderToStaticMarkup(<TimelinePanel store={store} locale="de" channels={dir} clip="c_low_battery" />);
    expect(html).toContain("data-ovl-clip=\"c_hint_pulse\"");
    expect(html).toContain("data-ovl-clip-editor=\"c_low_battery\"");
    expect(html).toContain("Solange Bedingung wahr");
    expect(html).toContain("Durchlauf beenden");
    expect(html).toContain("data-ovl-formula=\"condition\"");
    expect(html).toContain("data-ovl-keyframe=\"0.5\"");
    expect(html).toContain("data-ovl-playhead=\"0.5\"");
    expect(html).toContain("data-ovl-add-track");
  });

  it("pulse clips offer the retrigger option", () => {
    const store = new EditorStore({ carId: 1, document: variants() });
    const html = renderToStaticMarkup(<TimelinePanel store={store} locale="en" clip="c_hint_pulse" />);
    expect(html).toContain("Renewed pulse");
    expect(html).not.toContain("data-ovl-playhead");
  });

  it("the editor embeds inspector and timeline", () => {
    const server = new InMemoryOverlayServer(3);
    const html = renderToStaticMarkup(<OverlayEditor carId={3} persistence={server.client()} hasControl locale="de" channels={dir} />);
    expect(html).toContain("data-ovl-inspector");
    expect(html).toContain("data-ovl-timeline");
  });
});
