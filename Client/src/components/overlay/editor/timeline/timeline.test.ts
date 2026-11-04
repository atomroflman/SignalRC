// AP10 – timeline logic: clips, tracks, keyframes, triggers and scrubbing as
// undoable editor commands; scrubbing via the AP08 runtime.
import { describe, expect, it } from "vitest";
import { effectiveConfig } from "../../document/resolve";
import { expressionAnalyzer } from "../../expression";
import type { OverlayDocument } from "../../document/types";
import { createRuntime } from "../../runtime/runtime";
import { readContractJson } from "../../testing/fixtures";
import { EditorStore } from "../core/store";
import { inspectProperty } from "../inspector/model";
import {
  addTrack, clipInfo, conditionCommand, durationCommand, keyframesCommand, listClips, moveKeyframe, newClipCommand, onDeactivateCommand,
  pruneScrub, removeKeyframe, removeTrackCommand, repeatCommand, resetFieldCommand, retriggerCommand, rulerTicks, scrubTo, setKeyframeAt,
  setKeyframeEasing, setKeyframeValue, settingsCommand, snapTau, stopScrub, tauFromX, trackCandidates, trackRows, trackValueAt, triggerModeCommand,
} from "./model";

const variants = () => readContractJson<OverlayDocument>("fixtures/documents/valid/variants-clips-lidar.json");
const storeOf = () => new EditorStore({ carId: 1, document: variants() });
const errors = (s: EditorStore) => s.diagnostics().filter((d) => d.category === "structure" || d.code === "OVL_CLIP_PROPERTY_CONFLICT");

describe("clips", () => {
  it("lists effective clips with inheritance in a variant", () => {
    const store = storeOf();
    expect(listClips(store).map((c) => c.id)).toEqual(["c_hint_pulse", "c_low_battery"]);
    store.setActiveVariant("front-wide");
    const low = clipInfo(store, "c_low_battery")!;
    expect(low).toMatchObject({ inherited: true, overridden: ["trigger"] });
    expect(low.clip.trigger).toMatchObject({ condition: "tel(\"batteryVoltage\") < 11" });
    store.dispatch(resetFieldCommand("c_low_battery", "trigger", "front-wide")!);
    expect(clipInfo(store, "c_low_battery")!.overridden).toEqual([]);
    store.undo();
    expect(clipInfo(store, "c_low_battery")!.overridden).toEqual(["trigger"]);
  });

  it("creates clips, edits settings and removes them, all undoable", () => {
    const store = storeOf();
    const { id, command } = newClipCommand(store, { name: "Neu" }, "c_new");
    store.dispatch(command);
    expect(store.document.clips!.c_new).toEqual({ durationS: 1, trigger: { mode: "auto" }, tracks: [], name: "Neu" });
    store.dispatch(repeatCommand(id, "infinite")!);
    store.dispatch(settingsCommand(id, { endState: "hold" }));
    store.dispatch(settingsCommand(id, { disabled: true }));
    expect(store.document.clips!.c_new).toMatchObject({ repeat: "infinite", endState: "hold", disabled: true });
    expect(repeatCommand(id, 0)).toBeUndefined();
    expect(repeatCommand(id, 1.5)).toBeUndefined();
    store.dispatch({ type: "removeClip", id });
    expect(store.document.clips!.c_new).toBeUndefined();
    for (let i = 0; i < 5; i++) store.undo();
    expect(store.document.clips!.c_new).toBeUndefined();
    store.redo();
    expect(store.document.clips!.c_new.repeat).toBeUndefined();
  });

  it("switches triggers and keeps the condition; deactivation and retrigger options", () => {
    const store = storeOf();
    const low = () => store.document.clips!.c_low_battery.trigger;
    store.dispatch(triggerModeCommand("c_low_battery", low(), "pulse")!);
    expect(low()).toEqual({ mode: "pulse", condition: "tel(\"batteryVoltage\") < 10.5" });
    store.dispatch(retriggerCommand("c_low_battery", low(), "ignore")!);
    expect(low()).toMatchObject({ retrigger: "ignore" });
    store.dispatch(retriggerCommand("c_low_battery", low(), "restart")!);
    expect(low()).not.toHaveProperty("retrigger");
    store.dispatch(triggerModeCommand("c_low_battery", low(), "whileTrue")!);
    store.dispatch(onDeactivateCommand("c_low_battery", low(), "finish")!);
    expect(low()).toEqual({ mode: "whileTrue", condition: "tel(\"batteryVoltage\") < 10.5", onDeactivate: "finish" });
    store.dispatch(conditionCommand("c_low_battery", low(), "valid(tel(\"batteryVoltage\"))")!);
    expect(low()).toMatchObject({ condition: "valid(tel(\"batteryVoltage\"))" });
    store.dispatch(triggerModeCommand("c_low_battery", low(), "auto")!);
    expect(low()).toEqual({ mode: "auto" });
    expect(onDeactivateCommand("c_low_battery", low(), "stop")).toBeUndefined();
    expect(conditionCommand("c_low_battery", low(), "true")).toBeUndefined();
    // An empty condition is a publish error only; the draft keeps it.
    store.dispatch(triggerModeCommand("c_low_battery", low(), "whileTrue")!);
    expect(low()).toEqual({ mode: "whileTrue", condition: "" });
    store.setResolveContext({ expressions: expressionAnalyzer });
    expect(store.diagnostics().find((d) => d.location.clip === "c_low_battery" && d.code === "OVL_EXPR_EMPTY")).toMatchObject({ category: "publish", location: { field: "trigger.condition" } });
  });

  it("changes the duration by scaling or trimming keyframes", () => {
    const store = storeOf();
    const info = clipInfo(store, "c_low_battery")!;
    store.dispatch(durationCommand(store, info.id, info.clip, 2, "scale")!);
    expect(store.document.clips!.c_low_battery.tracks[0].keyframes.map((k) => k.t)).toEqual([0, 1, 2]);
    store.undo();
    const again = clipInfo(store, "c_low_battery")!;
    store.dispatch(durationCommand(store, again.id, again.clip, 0.75, "trim")!);
    const kf = store.document.clips!.c_low_battery.tracks[0].keyframes;
    expect(kf.map((k) => k.t)).toEqual([0, 0.5, 0.75]);
    expect(kf[2].value).toBeCloseTo(0.5, 1);
    expect(store.document.clips!.c_low_battery.durationS).toBe(0.75);
    expect(errors(store)).toEqual([]);
    expect(durationCommand(store, again.id, again.clip, 0, "scale")).toBeUndefined();
    expect(durationCommand(store, again.id, again.clip, 4000, "scale")).toBeUndefined();
    // Making a clip longer never touches keyframes in trim mode.
    const now = clipInfo(store, "c_low_battery")!;
    expect(durationCommand(store, now.id, now.clip, 3, "trim")).toEqual({ type: "updateClip", id: "c_low_battery", changes: { durationS: 3 } });
  });
});

describe("tracks and keyframes", () => {
  it("offers animatable properties with their current driver", () => {
    const store = storeOf();
    const steer = trackCandidates(store, "c_hint_pulse", "e_steer");
    expect(steer.find((c) => c.property === "value")!.state).toBe("binding");
    expect(steer.find((c) => c.property === "orientation")).toBeUndefined();
    expect(steer.find((c) => c.property === "min")).toBeUndefined();
    const warning = trackCandidates(store, "c_hint_pulse", "e_warning");
    expect(warning.find((c) => c.property === "opacity")).toMatchObject({ state: "otherClip", owner: "c_low_battery" });
    expect(trackCandidates(store, "c_low_battery", "e_warning").find((c) => c.property === "opacity")!.state).toBe("thisClip");
    const logo = trackCandidates(store, "c_hint_pulse", "e_logo");
    expect(logo.find((c) => c.part === "p_needle" && c.property === "rotation")!.state).toBe("binding");
    expect(trackCandidates(store, "c_hint_pulse", "e_lidar").map((c) => c.property)).not.toContain("sectors");
  });

  it("adding a track takes the property over from another clip in one step (D12)", () => {
    const store = storeOf();
    const size = store.getState().history.size;
    expect(addTrack(store, "c_hint_pulse", { element: "e_warning", property: "opacity" })).toBe(true);
    expect(store.getState().history.size).toBe(size + 1);
    expect(store.document.clips!.c_low_battery.tracks).toEqual([]);
    expect(store.document.clips!.c_hint_pulse.tracks.at(-1)).toEqual({ element: "e_warning", property: "opacity", keyframes: [{ t: 0, value: 0 }] });
    expect(errors(store)).toEqual([]);
    expect(addTrack(store, "c_hint_pulse", { element: "e_warning", property: "opacity" })).toBe(false);
    store.undo();
    expect(store.document.clips!.c_low_battery.tracks).toHaveLength(1);
  });

  it("keyframe list operations keep a strict order inside the clip", () => {
    const kf = [{ t: 0, value: 0 }, { t: 0.5, value: 1 }, { t: 1, value: 0 }];
    expect(setKeyframeAt(kf, 0.25, 0.5)).toEqual({ keyframes: [kf[0], { t: 0.25, value: 0.5 }, kf[1], kf[2]], index: 1 });
    expect(setKeyframeAt(kf, 0.5, 0.7).keyframes[1]).toEqual({ t: 0.5, value: 0.7 });
    expect(moveKeyframe(kf, 1, 0.9, 1)).toEqual({ keyframes: [kf[0], { t: 0.9, value: 1 }, kf[2]], index: 1 });
    expect(moveKeyframe(kf, 0, 0.75, 1)).toEqual({ keyframes: [kf[1], { t: 0.75, value: 0 }, kf[2]], index: 1 });
    expect(moveKeyframe(kf, 1, 1, 1)).toBeUndefined();
    expect(moveKeyframe(kf, 1, 7, 2)!.keyframes.at(-1)).toEqual({ t: 2, value: 1 });
    expect(removeKeyframe(kf, 1)).toEqual([kf[0], kf[2]]);
    expect(removeKeyframe([kf[0]], 0)).toBeNull();
    expect(setKeyframeValue(kf, 2, 1)[2]).toEqual({ t: 1, value: 1 });
    const eased = setKeyframeEasing(kf, 0, "easeOut");
    expect(eased[0]).toEqual({ t: 0, value: 0, easing: "easeOut" });
    expect(setKeyframeEasing(eased, 0, "linear")[0]).toEqual({ t: 0, value: 0 });
  });

  it("keyframe commands are undoable and checked by the store", () => {
    const store = storeOf();
    const info = clipInfo(store, "c_low_battery")!;
    const row = trackRows(store, info)[0];
    expect(row).toMatchObject({ index: 0, interpolation: "linear", ref: { element: "e_warning", property: "opacity" } });
    const { keyframes } = setKeyframeAt(row.track.keyframes, 0.25, 0.8);
    store.dispatch(keyframesCommand(info.id, row.ref, keyframes));
    expect(store.document.clips!.c_low_battery.tracks[0].keyframes).toHaveLength(4);
    // Behind the end, out of range or of the wrong type: refused.
    expect(store.dispatch(keyframesCommand(info.id, row.ref, [{ t: 2, value: 0 }])).ok).toBe(false);
    expect(store.dispatch(keyframesCommand(info.id, row.ref, [{ t: 0, value: "x" }])).ok).toBe(false);
    store.dispatch(removeTrackCommand(info.id, row.ref));
    expect(store.document.clips!.c_low_battery.tracks).toEqual([]);
    expect(inspectProperty(store, { element: "e_warning", property: "opacity" })!.mode).toBe("static");
    store.undo();
    store.undo();
    expect(store.document.clips!.c_low_battery.tracks[0].keyframes).toHaveLength(3);
  });

  it("samples track values like the runtime, colors per RGBA channel", () => {
    const store = storeOf();
    const track = store.document.clips!.c_low_battery.tracks[0];
    expect(trackValueAt(store, track, 0.5)).toBe(1);
    expect(trackValueAt(store, track, 5)).toBe(0);
    const color = { element: "e_belt", property: "fill", keyframes: [{ t: 0, value: "#000000" }, { t: 1, value: "#ff0000" }] };
    expect(trackValueAt(store, color, 0.5)).toBe("#800000ff");
    const text = { element: "e_warning", property: "text", keyframes: [{ t: 0, value: "A" }, { t: 1, value: "B" }] };
    expect(trackValueAt(store, text, 0.9)).toBe("A");
  });

  it("edits in a variant override the inherited clip's tracks only", () => {
    const store = storeOf();
    store.setActiveVariant("front-wide");
    const info = clipInfo(store, "c_hint_pulse")!;
    const row = trackRows(store, info)[0];
    store.dispatch(keyframesCommand(info.id, row.ref, setKeyframeValue(row.track.keyframes, 1, 2)));
    expect(store.document.clips!.c_hint_pulse.tracks[0].keyframes[1].value).toBe(1.3);
    expect(store.document.variants!["front-wide"].clips!.c_hint_pulse.tracks![0].keyframes[1].value).toBe(2);
    expect(clipInfo(store, "c_hint_pulse")!.overridden).toEqual(["tracks"]);
  });
});

describe("scrubbing in design mode", () => {
  it("sets τ of exactly one clip, clamped, and the runtime shows its track values", () => {
    const store = storeOf();
    scrubTo(store, "c_low_battery", 0.5);
    expect(store.getState().scrub).toEqual({ clipId: "c_low_battery", tau: 0.5 });
    scrubTo(store, "c_low_battery", 9);
    expect(store.getState().scrub!.tau).toBe(1);
    scrubTo(store, "c_unknown", 0.2);
    expect(store.getState().scrub!.clipId).toBe("c_low_battery");
    // Scrubbing is editor state: no undo step, no document change.
    expect(store.getState().history.size).toBe(0);
    scrubTo(store, "c_low_battery", 0.5);
    const rt = createRuntime(effectiveConfig(store.document, null));
    const frame = rt.baseFrame(store.getState().scrub);
    expect(frame.elements.e_warning.props.opacity).toBe(1);
    expect(frame.elements.e_driver_hint.props.scaleX).toBe(1);
    expect(rt.baseFrame().elements.e_warning.props.opacity).toBe(0);
    stopScrub(store);
    expect(store.getState().scrub).toBeUndefined();
  });

  it("drops the scrub when its clip disappears", () => {
    const store = storeOf();
    scrubTo(store, "c_hint_pulse", 0.1);
    store.dispatch({ type: "removeClip", id: "c_hint_pulse" });
    pruneScrub(store);
    expect(store.getState().scrub).toBeUndefined();
  });

  it("maps pointer positions, snaps to keyframes and builds a ruler", () => {
    expect(tauFromX(50, 200, 2)).toBe(0.5);
    expect(tauFromX(-5, 200, 2)).toBe(0);
    expect(tauFromX(500, 200, 2)).toBe(2);
    expect(snapTau(0.48, [0, 0.5, 1], 0.03)).toBe(0.5);
    expect(snapTau(0.4, [0, 0.5, 1], 0.03)).toBe(0.4);
    expect(rulerTicks(1, 400)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(rulerTicks(10, 300)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(rulerTicks(0, 300)).toEqual([0]);
  });
});
