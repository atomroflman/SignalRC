// AP12 – templates are valid documents (AP01), render without diagnostics
// (AP08) and are inserted through editor commands as one undo step.
import { describe, expect, it } from "vitest";
import { effectiveConfig } from "../document/resolve";
import type { OverlayDocument } from "../document/types";
import { validate } from "../document/validate";
import { EditorStore } from "../editor/core/store";
import { analyze } from "../expression";
import { targetContext } from "../exchange/import";
import { createRuntime } from "../runtime/runtime";
import { SceneBuilder } from "../runtime/scene";
import { FakeValueSource } from "../sources/testing/fake-value-source";
import { convertedRef, formatNumber, suggestConversion } from "./conversions";
import { checkMapping, insertTemplate, instantiate, type ChannelOption } from "./instantiate";
import { TEMPLATES, templateById } from "./library";
import type { TemplateDefinition, TemplateMapping } from "./types";

const channels: ChannelOption[] = [
  { name: "yaw", dataType: "Number", unit: "rad" },
  { name: "pitch", dataType: "Number", unit: "°" },
  { name: "roll", dataType: "Number", unit: "°" },
  { name: "speedL", dataType: "Number", unit: "km/h" },
  { name: "speedR", dataType: "Integer", unit: "m/s" },
  { name: "front distance", dataType: "Number", unit: "cm" },
  { name: "lidar", dataType: "LidarGrid" },
  { name: "label", dataType: "String" },
];
const vehicle = { telemetry: channels.map((c) => ({ name: c.name, dataType: c.dataType, unit: c.unit })), outputs: [], streams: [] };

const SLOT_CHANNELS: Record<string, string> = {
  heading: "yaw", pitch: "pitch", roll: "roll", left: "speedL", right: "speedR", distance: "front distance", grid: "lidar",
};

function mappingFor(def: TemplateDefinition, params?: TemplateMapping["params"]): TemplateMapping {
  const slots: TemplateMapping["slots"] = {};
  for (const s of def.slots) {
    const channel = SLOT_CHANNELS[s.id];
    slots[s.id] = { channel, conversion: suggestConversion(s, channels.find((c) => c.name === channel)?.unit) };
  }
  return { slots, params };
}

function docWith(def: TemplateDefinition, mapping = mappingFor(def)): OverlayDocument {
  const inst = instantiate(def, mapping, { at: { x: 40, y: 30 } });
  return { schemaVersion: 1, workspace: { width: 1280, height: 720 }, elements: inst.elements, children: [inst.root], clips: inst.clips };
}

describe("templates", () => {
  it("offers the five starting templates of the product plan", () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual(["compass", "attitude", "trackRun", "distanceWarning", "lidarGrid"]);
  });

  for (const def of TEMPLATES) {
    describe(def.id, () => {
      it("is a valid document without any diagnostic on a fitting vehicle", () => {
        const doc = docWith(def);
        expect(validate(doc, targetContext(vehicle, {}))).toEqual([]);
      });

      it("renders without runtime diagnostics, in design mode and live", () => {
        const doc = docWith(def);
        const config = effectiveConfig(doc, null);
        const info = (n: string) => {
          const c = channels.find((x) => x.name === n);
          return c ? { dataType: c.dataType as "Number", unit: c.unit } : undefined;
        };
        const runtime = createRuntime(config, { channels: info });
        const scene = new SceneBuilder(config, { locale: "de", pxPerUnit: 1, idPrefix: "ovl-", assets: {} }, runtime.staticElements());
        const design = runtime.baseFrame();
        expect(design.diagnostics).toEqual([]);
        expect(scene.build(design).diagnostics).toEqual([]);

        const source = new FakeValueSource();
        for (const c of channels) if (c.dataType !== "LidarGrid") source.set("tel", c.name, { state: "valid", value: "12.5" });
        runtime.reset(0);
        for (const t of [0, 0.1, 0.5, 1]) {
          const frame = runtime.step(t, source);
          expect(frame.diagnostics).toEqual([]);
          expect(scene.build(frame).diagnostics).toEqual([]);
        }
      });

      it("uses only mapped channels, no invented values", () => {
        const doc = docWith(def);
        const deps = new Set<string>();
        const formulas = JSON.stringify(doc).match(/"(expr|condition)":"((?:[^"\\]|\\.)*)"/g) ?? [];
        for (const f of formulas) {
          const expr = JSON.parse(`{${f}}`) as Record<string, string>;
          for (const d of analyze(Object.values(expr)[0], { signals: [] }).dependencies) deps.add(`${d.kind}:${d.name}`);
        }
        for (const el of Object.values(doc.elements)) if (el.source) deps.add(`tel:${el.source}`);
        const expected = new Set(def.slots.map((s) => `tel:${SLOT_CHANNELS[s.id]}`));
        expect(deps).toEqual(expected);
      });
    });
  }

  it("applies the explicit conversion in the formulas", () => {
    expect(convertedRef("yaw", { factor: 180 / Math.PI, offset: 0 })).toBe('(tel("yaw") * 57.29577951)');
    expect(convertedRef('a"b', { factor: 1, offset: -2 })).toBe('(tel("a\\"b") - 2)');
    expect(convertedRef("x", { factor: -1, offset: 0 })).toBe('(tel("x") * -1)');
    expect(analyze(convertedRef("x", { factor: -1, offset: 0.5 }), { signals: [] }).diagnostics).toEqual([]);
    expect(formatNumber(1 / 3.6)).toBe("0.2777777778");
    const compass = templateById("compass")!;
    const doc = docWith(compass);
    const rose = Object.values(doc.elements).find((e) => e.name === "Rose")!;
    expect(rose.props!.rotation).toMatchObject({ binding: { expr: '-(tel("yaw") * 57.29577951)' } });
  });

  it("refuses incomplete or unfitting mappings", () => {
    const def = templateById("lidarGrid")!;
    expect(checkMapping(def, { slots: {} }, channels)).toEqual([{ code: "TPL_SLOT_UNASSIGNED", slot: "grid" }]);
    expect(checkMapping(def, { slots: { grid: { channel: "yaw" } } }, channels)[0].code).toBe("TPL_CHANNEL_TYPE");
    expect(checkMapping(def, { slots: { grid: { channel: "gone" } } }, channels)[0].code).toBe("TPL_CHANNEL_UNKNOWN");
    expect(checkMapping(def, { slots: { grid: { channel: "lidar" } }, params: { sectors: 7 } }, channels)[0].code).toBe("TPL_PARAM_INVALID");
    const compass = templateById("compass")!;
    expect(checkMapping(compass, { slots: { heading: { channel: "label" } } }, channels)[0].code).toBe("TPL_CHANNEL_TYPE");
    expect(checkMapping(compass, { slots: { heading: { channel: "yaw", conversion: { factor: 0, offset: 0 } } } }, channels)[0].code).toBe("TPL_CONVERSION_INVALID");
  });

  it("LiDAR sweep is optional", () => {
    const def = templateById("lidarGrid")!;
    const plain = Object.values(docWith(def).elements).find((e) => e.type === "lidarWidget")!;
    const sweep = Object.values(docWith(def, mappingFor(def, { sweep: true, sectors: 12 })).elements).find((e) => e.type === "lidarWidget")!;
    expect(plain.props).toMatchObject({ sweepEnabled: false, sectors: 8 });
    expect(sweep.props).toMatchObject({ sweepEnabled: true, sectors: 12 });
  });
});

describe("inserting through editor commands", () => {
  const empty = (): OverlayDocument => ({ schemaVersion: 1, workspace: { width: 1280, height: 720 }, elements: {}, children: [], variants: { front: {} } });

  it("is one undo step, stays editable and works in a variant", () => {
    const store = new EditorStore({ carId: 1, document: empty() });
    const def = templateById("distanceWarning")!;
    const r = insertTemplate(store, def, mappingFor(def), channels);
    expect(r.ok).toBe(true);
    const doc = store.document;
    expect(doc.children).toEqual([r.root]);
    expect(Object.keys(doc.clips ?? {})).toHaveLength(1);
    expect(store.getState().selection).toEqual([r.root]);
    expect(store.getState().history.size).toBe(1);
    expect(doc.elements[r.root!].props).toMatchObject({ x: Math.round((1280 - 260) / 2), y: Math.round((720 - 110) / 2) });

    // Regular editing afterwards.
    expect(store.dispatch({ type: "setProperty", element: r.root!, property: "x", value: 5 }).ok).toBe(true);
    store.undo();
    store.undo();
    expect(store.document).toEqual(empty());

    store.setActiveVariant("front");
    const again = insertTemplate(store, def, mappingFor(def), channels);
    expect(again.ok).toBe(true);
    const v = store.document.variants!.front;
    expect(Object.keys(v.addedElements ?? {})).toContain(again.root);
    expect(Object.keys(v.addedClips ?? {})).toHaveLength(1);
    expect(store.document.children).toEqual([]);
  });

  it("inserts the same template twice with distinct ids", () => {
    const store = new EditorStore({ carId: 1, document: empty() });
    const def = templateById("trackRun")!;
    expect(insertTemplate(store, def, mappingFor(def), channels).ok).toBe(true);
    expect(insertTemplate(store, def, mappingFor(def), channels).ok).toBe(true);
    expect(store.document.children).toHaveLength(2);
    expect(validate(store.document).filter((d) => d.category !== "warning")).toEqual([]);
  });

  it("does not change the draft when the mapping is incomplete", () => {
    const store = new EditorStore({ carId: 1, document: empty() });
    const r = insertTemplate(store, templateById("compass")!, { slots: {} }, channels);
    expect(r.ok).toBe(false);
    expect(store.document).toEqual(empty());
    expect(store.getState().history.size).toBe(0);
  });
});
