// AP10 – inspector logic: catalog rows, inheritance, one control mode per
// property, formula checks via AP06 and undoable commands.
import { describe, expect, it } from "vitest";
import { propDef } from "../../document/catalog";
import type { OverlayDocument } from "../../document/types";
import { FakeValueSource } from "../../sources/testing/fake-value-source";
import { readContractJson } from "../../testing/fixtures";
import { EditorStore } from "../core/store";
import { analysisEnv, bindableSources, channelDirectory, declareSignal, parseSourcesResponse, sourceCatalog, undeclaredFlowSignals } from "./channels";
import { checkFormula, liveValue, simpleSource, sourceExpr } from "./formula";
import {
  applyMode, baseLiteral, bindingCommand, exprCommand, inspectElement, inspectProperty, lidarChannels, modeCommands, parseLiteral,
  rateCommand, resetCommand, sections, smoothingCommand, staticCommand, valueTextSourceDefaults, wrapCommand,
} from "./model";

const variants = () => readContractJson<OverlayDocument>("fixtures/documents/valid/variants-clips-lidar.json");
const storeOf = (doc: OverlayDocument = variants()) => new EditorStore({ carId: 1, document: doc });
const structure = (s: EditorStore) => s.diagnostics().filter((d) => d.category === "structure" || d.code === "OVL_CLIP_PROPERTY_CONFLICT");

const dir = parseSourcesResponse({
  telemetry: [
    { id: 1, channelName: "speed", dataType: "number", unit: "km/h", decimals: 1 },
    { id: 2, channelName: "gear", dataType: "integer", unit: null, decimals: null },
    { id: 3, channelName: "lidarGrid", dataType: "lidarGrid" },
    { id: 4, channelName: "batteryVoltage", dataType: "number", unit: "V", decimals: 2 },
    { id: 5, channelName: "odoSpeed", dataType: "number", unit: "m/s" },
  ],
  outputs: [{ id: 9, channelName: "steering" }],
});

describe("rows from the catalog", () => {
  it("lists common and type properties; scaleY only without locked aspect", () => {
    const store = storeOf();
    const rect = inspectElement(store, "e_belt").map((r) => r.property);
    expect(rect).toEqual(["x", "y", "rotation", "scaleX", "scaleY", "pivotX", "pivotY", "opacity", "visible", "width", "height", "cornerRadius", "fill", "stroke", "strokeWidth"]);
    expect(inspectElement(store, "e_driver_hint").map((r) => r.property)).not.toContain("scaleY");
    const parts = inspectElement(store, "e_logo", "p_needle").map((r) => r.property);
    expect(parts).toContain("fill");
    expect(parts).not.toContain("width");
    const lidar = sections(store.effective().elements.e_lidar);
    expect(lidar.map((s) => s.key)).toEqual(["transform", "appearance", "widget"]);
    expect(lidar[2].names).toEqual(expect.arrayContaining(["sectors", "nearDistanceM", "blinkNearHz", "afterglowS", "nearColor", "sweepEnabled"]));
    expect(lidar[2].names).not.toContain("radius");
    expect(lidar[2].names[0]).toBe("display");
    expect(lidar[2].names).not.toContain("contourJoinMm");
    store.dispatch(staticCommand(inspectProperty(store, { element: "e_lidar", property: "display" })!, "contour"));
    const contour = sections(store.effective().elements.e_lidar)[2].names;
    expect(contour).toEqual(expect.arrayContaining(["display", "contourJoinMm", "contourWidth", "contourShadow", "contourShadowOpacity", "afterglowS"]));
    expect(contour).not.toContain("sectors");
    expect(parseLiteral(propDef("lidarWidget", "contourJoinMm")!, "5")).toEqual({ ok: false, problem: "range" });
    expect(inspectProperty(store, { element: "e_lidar", property: "display" })!.modes).toEqual(["static"]);
  });

  it("shows the controlling mode and the allowed modes", () => {
    const store = storeOf();
    expect(inspectProperty(store, { element: "e_belt", property: "x" })!.mode).toBe("rate");
    expect(inspectProperty(store, { element: "e_steer", property: "value" })!.mode).toBe("binding");
    const opacity = inspectProperty(store, { element: "e_warning", property: "opacity" })!;
    expect(opacity.mode).toBe("clip");
    expect(opacity.clips).toEqual(["c_low_battery"]);
    expect(inspectProperty(store, { element: "e_warning", property: "fontSize" })!.mode).toBe("static");
    expect(inspectProperty(store, { element: "e_lidar", property: "sectors" })!.modes).toEqual(["static"]);
    expect(inspectProperty(store, { element: "e_lidar", property: "nearColor" })!.modes).toEqual(["static"]);
    expect(inspectProperty(store, { element: "e_warning", property: "text" })!.modes).toEqual(["static", "binding", "clip"]);
    expect(inspectProperty(store, { element: "e_logo", part: "p_needle", property: "rotation" })!.mode).toBe("binding");
  });

  it("marks inherited and overridden values in a variant and resets them", () => {
    const store = storeOf();
    store.setActiveVariant("front-wide");
    const sectors = inspectProperty(store, { element: "e_lidar", property: "sectors" })!;
    expect(sectors).toMatchObject({ overridden: true, inherited: false, resettable: true, base: 8 });
    const radius = inspectProperty(store, { element: "e_lidar", property: "radius" })!;
    expect(radius).toMatchObject({ overridden: false, inherited: true, resettable: false, base: 120 });
    const reset = resetCommand(sectors, "front-wide")!;
    expect(reset.type).toBe("resetOverride");
    expect(store.dispatch(reset).ok).toBe(true);
    expect(inspectProperty(store, { element: "e_lidar", property: "sectors" })!.base).toBe(12);
    store.undo();
    expect(inspectProperty(store, { element: "e_lidar", property: "sectors" })!.base).toBe(8);
    // Properties of added elements reset to the catalog default.
    const label = inspectProperty(store, { element: "e_front_label", property: "fontSize" })!;
    expect(label).toMatchObject({ origin: "variant", inherited: false, overridden: false, resettable: true });
    expect(resetCommand(label, "front-wide")!.type).toBe("setProperty");
  });

  it("in the standard a reset returns to the catalog default", () => {
    const store = storeOf();
    const width = inspectProperty(store, { element: "e_belt", property: "width" })!;
    store.dispatch(resetCommand(width, null)!);
    expect(store.document.elements.e_belt.props!.width).toBeUndefined();
    expect(inspectProperty(store, { element: "e_belt", property: "width" })).toMatchObject({ origin: "default", base: 100, resettable: false });
  });

  it("edits in a variant become overrides of the inherited element", () => {
    const store = storeOf();
    store.setActiveVariant("front-wide");
    const row = inspectProperty(store, { element: "e_warning", property: "fontSize" })!;
    store.dispatch(bindingCommand(row, { expr: "tel(\"speed\")" }));
    expect(store.document.elements.e_warning.props!.fontSize).toBe(48);
    expect(store.document.variants!["front-wide"].elements!.e_warning.props!.fontSize).toEqual({ base: 48, binding: { expr: "tel(\"speed\")" } });
    expect(inspectProperty(store, { element: "e_warning", property: "fontSize" })).toMatchObject({ mode: "binding", overridden: true });
  });

  it("part values track their own origin", () => {
    const store = storeOf();
    const fill = inspectProperty(store, { element: "e_logo", part: "p_needle", property: "fill" })!;
    expect(fill).toMatchObject({ origin: "default", base: "fromAsset" });
    store.dispatch(staticCommand(fill, "#00ff00"));
    expect(store.document.elements.e_logo.parts!.p_needle.props!.fill).toBe("#00ff00");
    expect(inspectProperty(store, { element: "e_logo", part: "p_needle", property: "fill" })!.origin).toBe("standard");
  });
});

describe("svgAsset colours", () => {
  it("offers fill and stroke for the whole asset, defaulting to the asset's own colours", () => {
    const store = storeOf({ schemaVersion: 1, workspace: { width: 100, height: 100 }, elements: { e_svg: { type: "svgAsset", assetId: "sha256-0000000000000000000000000000000000000000000000000000000000000001" } }, children: ["e_svg"] });
    const el = store.effective().elements.e_svg;
    expect(sections(el).find((s) => s.key === "appearance")!.names).toEqual(expect.arrayContaining(["fill", "stroke"]));
    const row = inspectProperty(store, { element: "e_svg", property: "fill" })!;
    expect(row.mode).toBe("static");
    expect(row.value).toBeUndefined();
    expect(row.base).toBe("fromAsset");
    store.dispatch(staticCommand(row, "#ffaa00")!);
    expect(store.document.elements.e_svg.props?.fill).toBe("#ffaa00");
  });
});

describe("one controlling mode", () => {
  it("binding replaces a clip track in one undo step without a conflict", () => {
    const store = storeOf();
    const row = inspectProperty(store, { element: "e_warning", property: "opacity" })!;
    const before = store.getState().history.size;
    expect(applyMode(store, row, "binding", { expr: "if(tel(\"batteryVoltage\") < 10.5, 1, 0)" }).ok).toBe(true);
    expect(store.getState().history.size).toBe(before + 1);
    expect(store.document.clips!.c_low_battery.tracks).toHaveLength(0);
    expect(store.document.elements.e_warning.props!.opacity).toEqual({ base: 0, binding: { expr: "if(tel(\"batteryVoltage\") < 10.5, 1, 0)" } });
    expect(structure(store)).toEqual([]);
    store.undo();
    expect(store.document.clips!.c_low_battery.tracks).toHaveLength(1);
    expect(store.document.elements.e_warning.props!.opacity).toBe(0);
  });

  it("clip mode removes the binding first and adds a track with the base value", () => {
    const store = storeOf();
    const row = inspectProperty(store, { element: "e_steer", property: "value" })!;
    const change = applyMode(store, row, "clip", { clip: "c_hint_pulse" });
    expect(change).toMatchObject({ ok: true, clip: "c_hint_pulse" });
    expect(store.document.elements.e_steer.props!.value).toBe(0);
    expect(store.document.clips!.c_hint_pulse.tracks.at(-1)).toEqual({ element: "e_steer", property: "value", keyframes: [{ t: 0, value: 0 }] });
    expect(structure(store)).toEqual([]);
  });

  it("in a variant the switch only changes the variant and leaves no effective conflict", () => {
    const store = storeOf();
    store.setActiveVariant("front-wide");
    const row = inspectProperty(store, { element: "e_warning", property: "opacity" })!;
    expect(applyMode(store, row, "binding", { expr: "1" }).ok).toBe(true);
    expect(store.document.clips!.c_low_battery.tracks).toHaveLength(1);
    expect(store.document.elements.e_warning.props!.opacity).toBe(0);
    const v = store.document.variants!["front-wide"];
    expect(v.clips!.c_low_battery.tracks).toEqual([]);
    expect(v.elements!.e_warning.props!.opacity).toEqual({ base: 0, binding: { expr: "1" } });
    expect(store.diagnostics().filter((d) => d.code === "OVL_CLIP_PROPERTY_CONFLICT" || d.category === "structure")).toEqual([]);
    expect(inspectProperty(store, { element: "e_warning", property: "opacity" })).toMatchObject({ mode: "binding", clips: [], overridden: true });
  });

  it("clip mode without a clip creates one", () => {
    const store = storeOf();
    const row = inspectProperty(store, { element: "e_belt", property: "fill" })!;
    const change = applyMode(store, row, "clip", { newClipId: "c_new", newClipDurationS: 2 });
    expect(change.clip).toBe("c_new");
    expect(store.document.clips!.c_new).toEqual({
      durationS: 2, trigger: { mode: "auto" }, tracks: [{ element: "e_belt", property: "fill", keyframes: [{ t: 0, value: "#808080" }] }],
    });
    expect(store.getState().history.undoLabel).toBe("fill: clip");
  });

  it("rate keeps the expression of a binding and static keeps the base", () => {
    const store = storeOf();
    let row = inspectProperty(store, { element: "e_steer", property: "value" })!;
    applyMode(store, row, "rate");
    expect(store.document.elements.e_steer.props!.value).toEqual({ base: 0, rate: { expr: "out(\"steering\")" } });
    row = inspectProperty(store, { element: "e_steer", property: "value" })!;
    applyMode(store, row, "static");
    expect(store.document.elements.e_steer.props!.value).toBe(0);
  });

  it("modes outside the catalog are not offered", () => {
    const store = storeOf();
    const sectors = inspectProperty(store, { element: "e_lidar", property: "sectors" })!;
    expect(modeCommands(store, sectors, "binding").commands).toEqual([]);
    const min = inspectProperty(store, { element: "e_steer", property: "min" })!;
    expect(min.modes).toEqual(["static", "binding"]);
    expect(modeCommands(store, min, "clip").commands).toEqual([]);
  });

  it("several drivers are shown as conflict and resolved by choosing one mode", () => {
    const doc = variants();
    doc.clips!.c_hint_pulse.tracks.push({ element: "e_warning", property: "opacity", keyframes: [{ t: 0, value: 1 }] });
    const store = new EditorStore({ carId: 1, document: doc, guardStructure: false });
    const row = inspectProperty(store, { element: "e_warning", property: "opacity" })!;
    expect(row.conflict).toBe(true);
    expect(row.diagnostics.map((d) => d.code)).toContain("OVL_CLIP_PROPERTY_CONFLICT");
    applyMode(store, row, "clip", { clip: "c_low_battery" });
    const after = inspectProperty(store, { element: "e_warning", property: "opacity" })!;
    expect(after).toMatchObject({ conflict: false, clips: ["c_low_battery"], diagnostics: [] });
  });

  it("binding options: expression, smoothing, wrap", () => {
    const store = storeOf();
    let row = inspectProperty(store, { element: "e_logo", part: "p_needle", property: "rotation" })!;
    store.dispatch(smoothingCommand(row, 0.3)!);
    row = inspectProperty(store, { element: "e_logo", part: "p_needle", property: "rotation" })!;
    store.dispatch(exprCommand(row, "sig(\"steeringRaw\")")!);
    expect(store.document.elements.e_logo.parts!.p_needle.props!.rotation).toEqual({ base: 0, binding: { expr: "sig(\"steeringRaw\")", smoothing: { timeConstantS: 0.3 } } });
    row = inspectProperty(store, { element: "e_logo", part: "p_needle", property: "rotation" })!;
    store.dispatch(smoothingCommand(row, undefined)!);
    expect(store.document.elements.e_logo.parts!.p_needle.props!.rotation).toEqual({ base: 0, binding: { expr: "sig(\"steeringRaw\")" } });
    let belt = inspectProperty(store, { element: "e_belt", property: "x" })!;
    store.dispatch(wrapCommand(belt, undefined)!);
    belt = inspectProperty(store, { element: "e_belt", property: "x" })!;
    expect(belt.rate).toEqual({ expr: "tel(\"odoSpeed\") * 200" });
    // An invalid wrap is refused by the store (OVL_PROP_INVALID_WRAP).
    expect(store.dispatch(wrapCommand(belt, { min: 5, max: 5 })!).ok).toBe(false);
    expect(store.dispatch(rateCommand(belt, { expr: "-1" })).ok).toBe(true);
    // Smoothing outside (0, 60] is a schema error and refused.
    const needle = inspectProperty(store, { element: "e_logo", part: "p_needle", property: "rotation" })!;
    expect(store.dispatch(smoothingCommand(needle, 0)!).ok).toBe(false);
    expect(store.getState().lastError?.code).toBe("OVL_SCHEMA_INVALID");
  });

  it("static input keeps a driver and sets only its base", () => {
    const store = storeOf();
    const row = inspectProperty(store, { element: "e_steer", property: "value" })!;
    store.dispatch(staticCommand(row, 0.5));
    expect(store.document.elements.e_steer.props!.value).toEqual({ base: 0.5, binding: { expr: "out(\"steering\")" } });
  });
});

describe("values", () => {
  it("parses inspector input by kind", () => {
    const opacity = propDef("rect", "opacity")!;
    expect(parseLiteral(opacity, "0,5")).toEqual({ ok: true, value: 0.5 });
    expect(parseLiteral(opacity, "2")).toEqual({ ok: false, problem: "range" });
    expect(parseLiteral(opacity, "")).toEqual({ ok: true, value: undefined });
    expect(parseLiteral(propDef("rect", "fill")!, "#ff0000")).toEqual({ ok: true, value: "#ff0000" });
    expect(parseLiteral(propDef("rect", "fill")!, "red")).toEqual({ ok: false, problem: "type" });
    expect(parseLiteral(propDef("lidarWidget", "sectors")!, "7")).toEqual({ ok: false, problem: "range" });
    expect(parseLiteral(propDef("valueText", "decimals")!, "1.5")).toEqual({ ok: false, problem: "type" });
    expect(parseLiteral(propDef("valueText", "value")!, "12")).toEqual({ ok: true, value: 12 });
    expect(parseLiteral(propDef("valueText", "value")!, "abc")).toEqual({ ok: true, value: "abc" });
    expect(parseLiteral(propDef("rect", "visible")!, false)).toEqual({ ok: true, value: false });
  });

  it("bases are always valid literals", () => {
    expect(baseLiteral(propDef("svgAsset", "fill", true)!)).toBe("#ffffff");
    expect(baseLiteral(propDef("svgAsset", "strokeWidth", true)!)).toBe(0);
    expect(baseLiteral(propDef("text", "fontSize")!)).toBe(24);
    expect(baseLiteral(propDef("rect", "opacity")!, 0.2)).toBe(0.2);
    expect(baseLiteral(propDef("valueText", "value")!)).toBe(null);
  });
});

describe("formulas via AP06", () => {
  const env = analysisEnv(dir, { steeringRaw: { label: "x" } });

  it("simple bindings are plain source references", () => {
    expect(simpleSource("tel(\"speed\")")).toEqual({ kind: "tel", name: "speed" });
    expect(simpleSource(" out( \"steering\" ) ")).toEqual({ kind: "out", name: "steering" });
    expect(simpleSource("tel(\"speed\") * 2")).toBeUndefined();
    expect(simpleSource("tel(\"\")")).toBeUndefined();
    const odd = "a\"b\\c";
    expect(simpleSource(sourceExpr("tel", odd))).toEqual({ kind: "tel", name: odd });
    expect(checkFormula(sourceExpr("tel", "speed"), env, "number").diagnostic).toBeUndefined();
  });

  it("reports the one diagnostic with code and offset", () => {
    expect(checkFormula("tel(\"nope\") + 1", env, "number").diagnostic).toMatchObject({ code: "OVL_REF_UNKNOWN_SOURCE", offset: 0 });
    expect(checkFormula("1 +", env, "number").diagnostic).toMatchObject({ code: "OVL_EXPR_SYNTAX", offset: 3 });
    expect(checkFormula("tel(\"speed\")", env, "bool").diagnostic?.code).toBe("OVL_EXPR_RESULT_TYPE");
    expect(checkFormula("tel(\"lidarGrid\")", env, "any").diagnostic?.code).toBe("OVL_EXPR_TYPE");
    expect(checkFormula("", env, "number").diagnostic?.code).toBe("OVL_EXPR_EMPTY");
    // Without a known channel list telemetry is not checked.
    expect(checkFormula("tel(\"nope\")", analysisEnv({}, undefined), "number").diagnostic).toBeUndefined();
  });

  it("evaluates live against the source, also in design mode", () => {
    const src = new FakeValueSource();
    src.set("tel", "speed", { state: "valid", value: "12.5" });
    const check = checkFormula("tel(\"speed\") * 2", env, "number");
    expect(liveValue(check, src, "de")).toEqual({ state: "valid", paused: false, text: "25" });
    expect(liveValue(checkFormula("tel(\"speed\") / 10", env, "number"), src, "de").text).toBe("1,25");
    expect(liveValue(checkFormula("tel(\"speed\") / 0", env, "number"), src, "en")).toMatchObject({ state: "invalid", diagnostic: "OVL_EXPR_DIV_ZERO" });
    expect(liveValue(checkFormula("tel(\"gear\")", env, "number"), src, "en").state).toBe("invalid");
    src.set("tel", "gear", { state: "unchecked", value: "3" });
    expect(liveValue(checkFormula("tel(\"gear\")", env, "number"), src, "en")).toMatchObject({ state: "unchecked", text: "3" });
    expect(liveValue(checkFormula("1 +", env, "number"), src, "en").state).toBe("none");
    const color = propDef("rect", "fill")!;
    expect(liveValue(checkFormula("\"red\"", env, "color"), src, "en", color).diagnostic).toBe("OVL_RUNTIME_INVALID_VALUE");
    expect(liveValue(checkFormula("if(tel(\"speed\") > 10, \"#ff0000\", \"#00ff00\")", env, "color"), src, "en", color)).toMatchObject({ text: "#ff0000" });
    expect(liveValue(checkFormula("3", env, "opacity"), src, "en", propDef("rect", "opacity")!)).toMatchObject({ text: "1" });
  });

  it("valueText takes unit and decimals of its source", () => {
    const store = storeOf();
    const el = { ...store.effective().elements.e_warning, type: "valueText" as const };
    expect(valueTextSourceDefaults(el, dir, {}, { kind: "tel", name: "speed" })).toEqual({ unit: "km/h", decimals: 1 });
    expect(valueTextSourceDefaults(el, dir, {}, { kind: "tel", name: "gear" })).toEqual({ unit: undefined, decimals: 0 });
    expect(valueTextSourceDefaults(el, dir, { s: { label: "S", unit: "%", decimals: 0 } }, { kind: "sig", name: "s" })).toEqual({ unit: "%", decimals: 0 });
  });
});

describe("channel directory", () => {
  it("parses the source catalog and feeds the validation", () => {
    expect(dir.telemetry!.map((c) => c.name)).toEqual(["batteryVoltage", "gear", "lidarGrid", "odoSpeed", "speed"]);
    expect(dir.outputs).toEqual(["steering"]);
    expect(lidarChannels(dir).map((c) => c.name)).toEqual(["lidarGrid"]);
    expect(sourceCatalog(dir)!.telemetry.speed).toBe("Number");
    const fromCatalog = channelDirectory({ sources: { telemetry: { b: "Boolean", a: "Number" }, outputs: ["o"] } });
    expect(fromCatalog.telemetry!.map((c) => c.name)).toEqual(["a", "b"]);
    expect(channelDirectory({}).telemetry).toBeUndefined();
    const sig = { steeringRaw: { label: "L", unit: "%" } };
    expect(bindableSources(dir, sig, "length").map((s) => `${s.kind}:${s.name}`)).toEqual(["tel:batteryVoltage", "tel:gear", "tel:odoSpeed", "tel:speed", "out:steering", "sig:steeringRaw"]);
    expect(bindableSources(dir, sig, "bool")).toEqual([]);
    expect(bindableSources(dir, sig, "any").map((s) => s.name)).not.toContain("lidarGrid");
  });

  it("offers undeclared flow signals after the declared ones and declares them on demand", () => {
    const sig = { steeringRaw: { label: "L", unit: "%" } };
    const withFlow = { ...dir, flowSignals: ["throttle", "steeringRaw", "bad-name", "throttle"] };
    expect(undeclaredFlowSignals(withFlow, sig)).toEqual(["throttle"]);
    const sigs = bindableSources(withFlow, sig, "number").filter((s) => s.kind === "sig");
    expect(sigs).toEqual([
      { kind: "sig", name: "steeringRaw", unit: "%", decimals: undefined },
      { kind: "sig", name: "throttle", undeclared: true },
    ]);
    expect(bindableSources(withFlow, sig, "bool")).toEqual([]);
    expect(declareSignal(sig, "throttle")).toEqual({ steeringRaw: { label: "L", unit: "%" }, throttle: { label: "throttle" } });
    expect(declareSignal(sig, "steeringRaw")).toBe(sig);
    expect(declareSignal(undefined, "x")).toEqual({ x: { label: "x" } });
  });

  it("a declared flow signal is valid in formulas and undoable", () => {
    const store = storeOf();
    const before = store.document.signals;
    store.dispatch({ type: "setSignals", signals: declareSignal(before, "throttle") });
    expect(store.document.signals?.throttle).toEqual({ label: "throttle" });
    expect(checkFormula('sig("throttle")', analysisEnv(dir, store.document.signals), "number").diagnostic).toBeUndefined();
    store.undo();
    expect(store.document.signals).toEqual(before);
  });
});
