// AP10 – pure logic of the keyframe timeline: independent clips with their
// settings (duration, repeat, trigger, end state, deactivation), tracks,
// keyframes and design mode scrubbing (runtime/README.md §6, §7). Every change
// is an editor command; the timeline keeps no document state of its own.
import { kindDef, propDef, type PropDef } from "../../document/catalog";
import type { Clip, ClipSettings, Diagnostic, EffectiveClip, Keyframe, Literal, Track, Trigger } from "../../document/types";
import { sampleKeyframes, type Interpolation } from "../../runtime/values";
import type { EditorStore } from "../core/store";
import { newClipId } from "../core/tools";
import type { EditorCommand, Scope, TrackRef } from "../core/types";
import { applyMode, inspectProperty, propertyNames, type PropertyTarget } from "../inspector/model";

/** Keyframe times closer than this are the same time (strict order, schema). */
export const TIME_EPSILON = 1e-6;
export const MAX_DURATION_S = 3600;
export const MAX_REPEAT = 10000;

const roundTime = (t: number) => Math.round(t * 1e6) / 1e6;

export interface ClipInfo {
  id: string;
  clip: EffectiveClip;
  /** The clip comes from the standard while a variant is active. */
  inherited: boolean;
  /** Fields the active variant overrides. */
  overridden: string[];
  diagnostics: Diagnostic[];
}

const ordinal = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function listClips(store: EditorStore): ClipInfo[] {
  const config = store.effective();
  const scope = store.getState().activeVariant;
  const diagnostics = store.diagnostics();
  return Object.keys(config.clips).sort(ordinal).map((id) => {
    const clip = config.clips[id];
    return {
      id,
      clip,
      inherited: scope !== null && clip.origin === "standard",
      overridden: scope !== null ? clip.overridden : [],
      diagnostics: diagnostics.filter((d) => d.location.clip === id && (d.location.variant ?? null) === scope),
    };
  });
}

export function clipInfo(store: EditorStore, id: string): ClipInfo | undefined {
  return listClips(store).find((c) => c.id === id);
}

/** A new, empty auto clip (D12: tracks are added per property). */
export function newClipCommand(store: EditorStore, init: Partial<Clip> = {}, id = newClipId(store)): { id: string; command: EditorCommand } {
  const clip: Clip = { durationS: 1, trigger: { mode: "auto" }, tracks: [], ...init };
  return { id, command: { type: "addClip", id, clip } };
}

export function settingsCommand(id: string, changes: Partial<Record<keyof ClipSettings, unknown>>): EditorCommand {
  return { type: "updateClip", id, changes };
}

/** Variant: back to the standard's value of one clip field. */
export function resetFieldCommand(id: string, field: keyof ClipSettings, scope: Scope): EditorCommand | undefined {
  if (scope === null) return undefined;
  return { type: "updateClip", id, changes: { [field]: undefined }, variant: scope };
}

// --- Duration, repeat, trigger ---

export type DurationMode = "scale" | "trim";

/**
 * New clip duration. `scale` stretches all keyframe times proportionally;
 * `trim` keeps the times, drops keyframes behind the new end and puts the
 * value at the end as last keyframe, so the clip looks the same up to there.
 */
export function durationCommand(store: EditorStore, id: string, clip: EffectiveClip, durationS: number, mode: DurationMode): EditorCommand | undefined {
  if (!(durationS > 0) || durationS > MAX_DURATION_S || !Number.isFinite(durationS)) return undefined;
  const d = roundTime(durationS);
  const tracks = clip.tracks.map((track) => {
    if (mode === "scale") {
      const f = d / clip.durationS;
      return { ...track, keyframes: track.keyframes.map((k) => ({ ...k, t: roundTime(k.t * f) })) };
    }
    if (track.keyframes.every((k) => k.t <= d)) return track;
    const kept = track.keyframes.filter((k) => k.t < d - TIME_EPSILON);
    const end: Keyframe = { t: d, value: trackValueAt(store, track, d) as Literal };
    return { ...track, keyframes: [...kept, end] };
  });
  const changed = tracks.some((t, i) => t !== clip.tracks[i]);
  return settingsCommand(id, changed ? { durationS: d, tracks } : { durationS: d });
}

export function repeatCommand(id: string, repeat: number | "infinite"): EditorCommand | undefined {
  if (repeat !== "infinite" && !(Number.isInteger(repeat) && repeat >= 1 && repeat <= MAX_REPEAT)) return undefined;
  return settingsCommand(id, { repeat });
}

/** Switches the trigger mode and keeps condition and options where they fit. */
export function triggerModeCommand(id: string, current: Trigger, mode: Trigger["mode"]): EditorCommand | undefined {
  if (current.mode === mode) return undefined;
  const condition = current.mode === "auto" ? "" : current.condition;
  const trigger: Trigger = mode === "auto" ? { mode } : mode === "whileTrue" ? { mode, condition } : { mode, condition };
  return settingsCommand(id, { trigger });
}

export function triggerCommand(id: string, trigger: Trigger): EditorCommand {
  return settingsCommand(id, { trigger });
}

export function conditionCommand(id: string, current: Trigger, condition: string): EditorCommand | undefined {
  if (current.mode === "auto") return undefined;
  return triggerCommand(id, { ...current, condition });
}

/** D23: behavior of a whileTrue clip when its condition becomes false. */
export function onDeactivateCommand(id: string, current: Trigger, value: "stop" | "finish"): EditorCommand | undefined {
  if (current.mode !== "whileTrue") return undefined;
  const { onDeactivate: _o, ...rest } = current;
  void _o;
  return triggerCommand(id, value === "stop" ? rest : { ...rest, onDeactivate: value });
}

/** D11: renewed edge while a pulse clip runs. */
export function retriggerCommand(id: string, current: Trigger, value: "restart" | "ignore"): EditorCommand | undefined {
  if (current.mode !== "pulse") return undefined;
  const { retrigger: _r, ...rest } = current;
  void _r;
  return triggerCommand(id, value === "restart" ? rest : { ...rest, retrigger: value });
}

// --- Tracks ---

export interface TrackRow {
  index: number;
  track: Track;
  ref: TrackRef;
  def?: PropDef;
  interpolation: Interpolation;
  diagnostics: Diagnostic[];
}

export function interpolationOf(def: PropDef | undefined): Interpolation {
  const i = def ? kindDef(def).interpolation : "step";
  return i === "linear" || i === "linearRgba" ? i : "step";
}

function defOf(store: EditorStore, ref: TrackRef): PropDef | undefined {
  const el = store.effective().elements[ref.element];
  return el ? propDef(el.type, ref.property, ref.part !== undefined) : undefined;
}

export function trackRows(store: EditorStore, info: ClipInfo): TrackRow[] {
  return info.clip.tracks.map((track, index) => {
    const ref: TrackRef = track.part !== undefined ? { element: track.element, part: track.part, property: track.property } : { element: track.element, property: track.property };
    const def = defOf(store, ref);
    return {
      index,
      track,
      ref,
      def,
      interpolation: interpolationOf(def),
      diagnostics: info.diagnostics.filter((d) => d.location.track === index),
    };
  });
}

/** Value of a track at local time τ (runtime §6, keyframe evaluation). */
export function trackValueAt(store: EditorStore, track: Track, tau: number): unknown {
  return sampleKeyframes(track.keyframes, tau, interpolationOf(defOf(store, track)));
}

export type CandidateState = "free" | "binding" | "rate" | "otherClip" | "thisClip";

export interface TrackCandidate extends PropertyTarget {
  /** Current driver; anything but "free"/"thisClip" is replaced when the track is added. */
  state: CandidateState;
  /** Clip that currently owns the property. */
  owner?: string;
}

/** Animatable properties of an element (and its parts) for a new track. */
export function trackCandidates(store: EditorStore, clip: string, element: string): TrackCandidate[] {
  const el = store.effective().elements[element];
  if (!el) return [];
  const targets: PropertyTarget[] = [
    ...propertyNames(el).map((property) => ({ element, property })),
    ...Object.keys(el.parts).flatMap((part) => propertyNames(el, part).map((property) => ({ element, part, property }))),
  ];
  const out: TrackCandidate[] = [];
  for (const target of targets) {
    const row = inspectProperty(store, target);
    if (!row || !row.modes.includes("clip")) continue;
    let state: CandidateState = "free";
    let owner: string | undefined;
    if (row.clips.includes(clip)) state = "thisClip";
    else if (row.binding) state = "binding";
    else if (row.rate) state = "rate";
    else if (row.clips.length > 0) { state = "otherClip"; owner = row.clips[0]; }
    out.push(owner ? { ...target, state, owner } : { ...target, state });
  }
  return out;
}

/**
 * Adds a track for a property to the clip as one undo step. A binding, rate or
 * track of another clip on the property is removed in the same step (D12).
 */
export function addTrack(store: EditorStore, clip: string, target: PropertyTarget, label = "Spur hinzufügen"): boolean {
  const row = inspectProperty(store, target);
  if (!row || row.clips.includes(clip)) return false;
  return applyMode(store, row, "clip", { clip }, label).ok;
}

export function removeTrackCommand(clip: string, ref: TrackRef): EditorCommand {
  return { type: "setKeyframes", clip, track: ref, keyframes: null };
}

export function keyframesCommand(clip: string, ref: TrackRef, keyframes: Keyframe[] | null): EditorCommand {
  return { type: "setKeyframes", clip, track: ref, keyframes };
}

// --- Keyframes (pure list operations; null = remove the track) ---

/** Sets the value at τ: replaces a keyframe at the same time or inserts one. */
export function setKeyframeAt(keyframes: Keyframe[], tau: number, value: Literal): { keyframes: Keyframe[]; index: number } {
  const t = roundTime(tau);
  const existing = keyframes.findIndex((k) => Math.abs(k.t - t) < TIME_EPSILON);
  if (existing >= 0) {
    const next = keyframes.map((k, i) => (i === existing ? { ...k, value } : k));
    return { keyframes: next, index: existing };
  }
  const next = [...keyframes, { t, value }].sort((a, b) => a.t - b.t);
  return { keyframes: next, index: next.findIndex((k) => k.t === t) };
}

/** Moves a keyframe within [0, durationS]; undefined if another keyframe has that time. */
export function moveKeyframe(keyframes: Keyframe[], index: number, t: number, durationS: number): { keyframes: Keyframe[]; index: number } | undefined {
  const k = keyframes[index];
  if (!k) return undefined;
  const nt = roundTime(Math.min(Math.max(t, 0), durationS));
  if (keyframes.some((o, i) => i !== index && Math.abs(o.t - nt) < TIME_EPSILON)) return undefined;
  const moved = { ...k, t: nt };
  const next = keyframes.map((o, i) => (i === index ? moved : o)).sort((a, b) => a.t - b.t);
  return { keyframes: next, index: next.indexOf(moved) };
}

export function removeKeyframe(keyframes: Keyframe[], index: number): Keyframe[] | null {
  const next = keyframes.filter((_, i) => i !== index);
  return next.length === 0 ? null : next;
}

export function setKeyframeValue(keyframes: Keyframe[], index: number, value: Literal): Keyframe[] {
  return keyframes.map((k, i) => (i === index ? { ...k, value } : k));
}

/** Easing of the segment from this keyframe to the next; "linear" is the default and not stored. */
export function setKeyframeEasing(keyframes: Keyframe[], index: number, easing: Keyframe["easing"]): Keyframe[] {
  return keyframes.map((k, i) => {
    if (i !== index) return k;
    const { easing: _e, ...rest } = k;
    void _e;
    return easing === undefined || easing === "linear" ? rest : { ...rest, easing };
  });
}

// --- Scrubbing (runtime §7) ---

/** Snaps τ to a keyframe time within `snapS`. */
export function snapTau(tau: number, times: number[], snapS: number): number {
  let best = tau;
  let dist = snapS;
  for (const t of times) {
    const d = Math.abs(t - tau);
    if (d <= dist) { best = t; dist = d; }
  }
  return best;
}

/** Local time for a pointer position on a timeline of `widthPx` showing [0, durationS]. */
export function tauFromX(x: number, widthPx: number, durationS: number): number {
  if (!(widthPx > 0)) return 0;
  return roundTime(Math.min(Math.max(x / widthPx, 0), 1) * durationS);
}

/** Scrubs exactly one clip to τ (clamped to the clip); the canvas shows its track values. */
export function scrubTo(store: EditorStore, clip: string, tau: number) {
  const c = store.effective().clips[clip];
  if (!c) return;
  store.setScrub({ clipId: clip, tau: roundTime(Math.min(Math.max(tau, 0), c.durationS)) });
}

export function stopScrub(store: EditorStore) {
  if (store.getState().scrub) store.setScrub(undefined);
}

/** Drops a scrub whose clip no longer exists in the active view (after undo, variant switch). */
export function pruneScrub(store: EditorStore) {
  const s = store.getState().scrub;
  if (s && !store.effective().clips[s.clipId]) store.setScrub(undefined);
}

/** Ruler steps: a "nice" interval with at least `minPx` between ticks. */
export function rulerTicks(durationS: number, widthPx: number, minPx = 48): number[] {
  if (!(durationS > 0) || !(widthPx > 0)) return [0];
  const steps = [0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200];
  const step = steps.find((s) => (s / durationS) * widthPx >= minPx) ?? durationS;
  const out: number[] = [];
  for (let t = 0; t <= durationS + TIME_EPSILON; t += step) out.push(roundTime(t));
  return out;
}
