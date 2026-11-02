// AP08 – the pure runtime: createRuntime(config).step(t, source) → FrameResult
// (Shared/Overlay/modules/README.md §1, runtime/README.md). No DOM, no timers;
// the caller supplies the time and the source values of every frame.
import { catalog, kindDef, propDef, type KindDef, type PropDef } from "../document/catalog";
import type { EffectiveClip, EffectiveConfig, EffectiveElement, PropertyValue } from "../document/types";
import { analyze, canonical, evaluate, localized } from "../expression";
import type { Analysis, Dependency, RuntimeValue, ValueSource } from "../expression";
import type { LidarGridValue } from "../sources/types";
import { clipOutput, initialClipState, stepClip, type ClipState } from "./clip";
import type {
  ChannelInfo, ClipFrame, ElementFrame, FrameResult, Locale, Marker, RuntimeDiagnostic, Scrub,
} from "./types";
import { COLOR, roundHalfAway, sampleKeyframes, wrapAngleDelta, wrapRange, type Interpolation } from "./values";
import {
  DEFAULT_SECTORS, LIDAR_SECTOR_COUNTS, LidarWidgetState, type LidarWidgetOptions,
} from "./widgets/lidar/lidar-widget";

/** What the runtime reads per frame: the expression port plus LiDAR grids. */
export interface RuntimeSource extends ValueSource {
  lidarGrid?(name: string): LidarGridValue;
}

export interface RuntimeOptions {
  locale?: Locale;
  /** Channel metadata: telemetry types for formulas, unit/decimals for valueText. */
  channels?: (name: string) => ChannelInfo | undefined;
}

export interface Runtime {
  /**
   * Ends the display session; the next step starts a fresh one (runtime §2).
   * `sessionStart` is when the session began (auto clips start then); without
   * it the session begins at the next frame.
   */
  reset(sessionStart?: number): void;
  step(t: number, source: RuntimeSource): FrameResult;
  /** Design mode: base values, optionally one clip scrubbed to τ (runtime §7). */
  baseFrame(scrub?: Scrub): FrameResult;
  /** All source references of displayed elements and active clips. */
  dependencies(): Dependency[];
  /** True when time alone changes the output (clips, rates, smoothing, LiDAR). */
  readonly continuous: boolean;
  /** Elements whose displayed values never change (no driver, no clip track). */
  staticElements(): Set<string>;
  setLocale(locale: Locale): void;
  /** Re-analyzes formulas whose channel types changed; true if any did. */
  refreshChannels(): boolean;
}

const MARKER_RANK: Record<Marker, number> = { paused: 1, unchecked: 2, invalid: 3 };

export function worstMarker(a: Marker | undefined, b: Marker | undefined): Marker | undefined {
  if (!a) return b;
  if (!b) return a;
  return MARKER_RANK[a] >= MARKER_RANK[b] ? a : b;
}

interface Driver {
  mode: "binding" | "rate";
  expr: string;
  expected: string;
  analysis: Analysis;
  signature: string;
  smoothing?: number;
  wrap?: { min: number; max: number };
}

interface Slot {
  name: string;
  def: PropDef;
  kind: KindDef;
  interpolation: Interpolation;
  base: unknown;
  driver?: Driver;
  clip?: string;
  value: unknown;
  marker?: Marker;
  hasValue: boolean;
  fresh: boolean;
  location: { element: string; part?: string; property: string };
}

interface SlotSet {
  slots: Slot[];
  byName: Record<string, Slot>;
}

interface ElementSlot extends SlotSet {
  id: string;
  el: EffectiveElement;
  parts: Record<string, SlotSet>;
  lidar?: LidarWidgetState;
  /** valueText: the source whose metadata fills "fromSource". */
  valueSource?: Dependency;
}

interface ClipSlot {
  id: string;
  clip: EffectiveClip;
  condition?: { expr: string; analysis: Analysis; signature: string };
  targets: (Slot | undefined)[];
  state: ClipState;
  marker?: Marker;
}

const isDynamic = (v: PropertyValue | undefined): boolean => v !== null && typeof v === "object";

const interpolationOf = (kind: KindDef): Interpolation =>
  kind.interpolation === "linearRgba" ? "linearRgba" : kind.interpolation === "linear" ? "linear" : "step";

export function createRuntime(config: EffectiveConfig, options: RuntimeOptions = {}): Runtime {
  let locale: Locale = options.locale ?? "de";
  const channels = options.channels ?? (() => undefined);
  const signals = Object.keys(config.signals ?? {});
  const staticDiagnostics: RuntimeDiagnostic[] = [];
  const elements: ElementSlot[] = [];
  const byId: Record<string, ElementSlot> = Object.create(null);
  const clips: ClipSlot[] = [];

  // --- Compilation ---

  const telDeps = (a: Analysis) => a.dependencies.filter((d) => d.kind === "tel").map((d) => d.name);
  const signatureOf = (names: string[]) => names.map((n) => `${n}:${channels(n)?.dataType ?? "?"}`).join(",");

  const analyzeFormula = (expr: string, expected: string): { analysis: Analysis; signature: string } => {
    const first = analyze(expr, { signals }, expected);
    const names = telDeps(first);
    if (names.length === 0 || first.diagnostics.length > 0) return { analysis: first, signature: "" };
    const telemetry: Record<string, NonNullable<ChannelInfo["dataType"]>> = Object.create(null);
    for (const n of names) {
      const info = channels(n);
      if (info) telemetry[n] = info.dataType;
    }
    return { analysis: analyze(expr, { telemetry, signals }, expected), signature: signatureOf(names) };
  };

  const formulaDiagnostic = (a: Analysis, location: RuntimeDiagnostic["location"]) => {
    for (const d of a.diagnostics) {
      staticDiagnostics.push({ code: d.code, severity: "error", location: { ...location, offset: d.offset }, message: d.message });
    }
  };

  const makeSlot = (def: PropDef, name: string, raw: PropertyValue | undefined, location: Slot["location"]): Slot => {
    const kind = kindDef(def);
    const base = raw === undefined ? def.default : isDynamic(raw) ? (raw as { base: unknown }).base : raw;
    const slot: Slot = {
      name, def, kind, interpolation: interpolationOf(kind), base,
      value: base, hasValue: false, fresh: false, location,
    };
    if (isDynamic(raw)) {
      const dyn = raw as { binding?: { expr: string; smoothing?: { timeConstantS: number } }; rate?: { expr: string; wrap?: { min: number; max: number } } };
      if (dyn.binding) {
        const { analysis, signature } = analyzeFormula(dyn.binding.expr, def.kind);
        slot.driver = { mode: "binding", expr: dyn.binding.expr, expected: def.kind, analysis, signature };
        const tau = dyn.binding.smoothing?.timeConstantS;
        if (tau !== undefined && tau > 0) slot.driver.smoothing = tau;
      } else if (dyn.rate) {
        const { analysis, signature } = analyzeFormula(dyn.rate.expr, "number");
        slot.driver = { mode: "rate", expr: dyn.rate.expr, expected: "number", analysis, signature };
        if (dyn.rate.wrap && dyn.rate.wrap.max > dyn.rate.wrap.min) slot.driver.wrap = dyn.rate.wrap;
      }
      if (slot.driver) formulaDiagnostic(slot.driver.analysis, location);
    }
    return slot;
  };

  const slotSet = (slots: Slot[]): SlotSet => {
    const byName: Record<string, Slot> = Object.create(null);
    for (const s of slots) byName[s.name] = s;
    return { slots, byName };
  };

  const partSlots = (el: EffectiveElement, partId: string): SlotSet => {
    const typeDef = catalog.types.svgAsset;
    const props = el.parts[partId]?.props ?? {};
    const lockAspect = el.parts[partId]?.lockAspect ?? false;
    const slots: Slot[] = [];
    for (const name of typeDef.partProps ?? []) {
      if (name === "scaleY" && lockAspect) continue;
      const def = propDef("svgAsset", name, true)!;
      slots.push(makeSlot(def, name, props[name], { element: el.id, part: partId, property: name }));
    }
    return slotSet(slots);
  };

  const compileElement = (id: string) => {
    const el = config.elements[id];
    if (!el || el.effectiveDisabled) return;
    const typeDef = catalog.types[el.type];
    const names = [...Object.keys(catalog.common), ...Object.keys(typeDef?.props ?? {})];
    const slots: Slot[] = [];
    for (const name of names) {
      if (name === "scaleY" && el.lockAspect) continue;
      const def = propDef(el.type, name)!;
      slots.push(makeSlot(def, name, el.props[name], { element: id, property: name }));
    }
    const slot: ElementSlot = { id, el, ...slotSet(slots), parts: Object.create(null) };
    for (const partId of Object.keys(el.parts ?? {})) slot.parts[partId] = partSlots(el, partId);
    if (el.type === "lidarWidget") slot.lidar = new LidarWidgetState();
    if (el.type === "valueText") slot.valueSource = slot.byName.value?.driver?.analysis.dependencies[0];
    elements.push(slot);
    byId[id] = slot;
    for (const child of el.children ?? []) compileElement(child);
  };
  for (const id of config.root) compileElement(id);

  for (const id of Object.keys(config.clips ?? {}).sort()) {
    const clip = config.clips[id];
    if (clip.disabled) continue;
    const targets = clip.tracks.map((track, index) => {
      const owner = byId[track.element];
      if (!owner) return undefined;
      let set: SlotSet = owner;
      if (track.part !== undefined) set = owner.parts[track.part] ??= partSlots(owner.el, track.part);
      const target = set.byName[track.property];
      if (!target || target.driver || target.clip !== undefined) {
        if (target) {
          staticDiagnostics.push({
            code: "OVL_CLIP_PROPERTY_CONFLICT", severity: "error",
            location: { clip: id, track: index, element: track.element, property: track.property, ...(track.part ? { part: track.part } : {}) },
            message: "Eigenschaft wird bereits gesteuert; Spur wird nicht angewendet",
          });
        }
        return undefined;
      }
      target.clip = id;
      return target;
    });
    if (targets.every((t) => !t)) continue;
    const slot: ClipSlot = { id, clip, targets, state: initialClipState() };
    if (clip.trigger.mode !== "auto") {
      const { analysis, signature } = analyzeFormula(clip.trigger.condition, "bool");
      slot.condition = { expr: clip.trigger.condition, analysis, signature };
      for (const d of analysis.diagnostics) {
        staticDiagnostics.push({ code: d.code, severity: "error", location: { clip: id, field: "trigger.condition", offset: d.offset }, message: d.message });
      }
    }
    clips.push(slot);
  }

  const allSlots = (): Slot[] => elements.flatMap((e) => [...e.slots, ...Object.values(e.parts).flatMap((p) => p.slots)]);
  const driven = allSlots().filter((s) => s.driver);
  const continuous = clips.length > 0
    || driven.some((s) => s.driver!.mode === "rate" || s.driver!.smoothing !== undefined)
    || elements.some((e) => e.lidar);

  // --- Session state ---

  let lastT: number | undefined;
  let sessionStart: number | undefined;

  const reset = (start?: number) => {
    lastT = undefined;
    sessionStart = start;
    for (const s of allSlots()) {
      s.value = s.base;
      s.marker = undefined;
      s.hasValue = false;
      s.fresh = false;
    }
    for (const c of clips) {
      c.state = initialClipState();
      c.marker = undefined;
    }
    for (const e of elements) e.lidar?.reset();
  };

  // --- Value conversion ---

  const coerce = (slot: Slot, v: unknown): { ok: true; value: unknown } | { ok: false } => {
    const kind = slot.kind;
    switch (kind.valueType) {
      case "number": {
        if (typeof v !== "number" || !Number.isFinite(v)) return { ok: false };
        let x = (slot.def.integer ?? kind.integer) ? roundHalfAway(v) : v;
        const min = slot.def.min ?? kind.min;
        const max = slot.def.max ?? kind.max;
        if (kind.clamp) x = Math.min(max ?? x, Math.max(min ?? x, x));
        else if ((min !== undefined && x < min) || (max !== undefined && x > max)) return { ok: false };
        return { ok: true, value: x };
      }
      case "boolean":
        return typeof v === "boolean" ? { ok: true, value: v } : { ok: false };
      case "string": {
        if (!Array.isArray(v)) return { ok: false };
        if (kind.format === "color") {
          const c = canonical(v);
          return COLOR.test(c) ? { ok: true, value: c } : { ok: false };
        }
        const text = localized(v, locale);
        return kind.maxLength !== undefined && text.length > kind.maxLength ? { ok: false } : { ok: true, value: text };
      }
      case "any":
        return v === undefined ? { ok: false } : { ok: true, value: v };
    }
  };

  // --- Frame ---

  let diagnostics: RuntimeDiagnostic[] = [];
  const runtimeDiagnostic = (code: string, location: RuntimeDiagnostic["location"], message: string) => {
    diagnostics.push({ code, severity: "warning", location, message });
  };

  const evalDriver = (analysis: Analysis, source: RuntimeSource, location: RuntimeDiagnostic["location"]): RuntimeValue => {
    const rv = evaluate(analysis, source);
    if (rv.diagnostic && analysis.diagnostics.length === 0) runtimeDiagnostic(rv.diagnostic, location, "Formel liefert keinen gültigen Wert");
    return rv;
  };

  const qualityMarker = (rv: RuntimeValue): Marker | undefined =>
    rv.state === "invalid" ? "invalid" : rv.state === "unchecked" ? "unchecked" : rv.paused ? "paused" : undefined;

  const stepRate = (s: Slot, rv: RuntimeValue, dt: number) => {
    const d = s.driver!;
    if (rv.state === "valid" && typeof rv.value === "number") {
      if (s.fresh) {
        s.value = s.base;
        s.fresh = false;
      } else {
        let v = Number(s.value) + rv.value * Math.min(dt, 0.25);
        if (d.wrap) v = wrapRange(v, d.wrap.min, d.wrap.max);
        if (s.kind.clamp) v = Math.min(s.kind.max ?? v, Math.max(s.kind.min ?? v, v));
        s.value = v;
      }
      s.marker = rv.paused ? "paused" : undefined;
    } else {
      s.marker = rv.state === "unchecked" ? "unchecked" : "invalid";
      s.fresh = true;
    }
  };

  const stepBinding = (s: Slot, rv: RuntimeValue, dt: number) => {
    const d = s.driver!;
    if (rv.state !== "invalid") {
      const c = coerce(s, rv.value);
      if (c.ok) {
        let x = c.value;
        const smooth = d.smoothing !== undefined && s.kind.valueType === "number" && !(s.def.integer ?? s.kind.integer);
        if (smooth && s.hasValue && !s.fresh && typeof s.value === "number" && typeof x === "number") {
          const y = s.value;
          const delta = s.def.kind === "angle" ? wrapAngleDelta(x - y) : x - y;
          x = y + delta * (1 - Math.exp(-dt / d.smoothing!));
        }
        s.value = x;
        s.hasValue = true;
        s.fresh = false;
        s.marker = qualityMarker(rv);
        return;
      }
      runtimeDiagnostic("OVL_RUNTIME_INVALID_VALUE", s.location, "Formelwert ist für diese Eigenschaft nicht darstellbar");
    }
    // Invalid: hold the last valid value, or show the base value (runtime §3).
    s.marker = "invalid";
    s.fresh = true;
    if (!s.hasValue) s.value = s.base;
  };

  const lidarOptions = (e: ElementSlot): LidarWidgetOptions => {
    const v = (n: string) => e.byName[n]?.value;
    let sectors = Number(v("sectors"));
    if (!(LIDAR_SECTOR_COUNTS as readonly number[]).includes(sectors)) {
      runtimeDiagnostic("OVL_PROP_OUT_OF_RANGE", { element: e.id, property: "sectors" }, "Sektorenanzahl nicht erlaubt");
      sectors = DEFAULT_SECTORS;
    }
    return {
      sectors,
      nearDistanceM: Number(v("nearDistanceM")),
      farDistanceM: Number(v("farDistanceM")),
      nearColor: String(v("nearColor")),
      midColor: String(v("midColor")),
      farColor: String(v("farColor")),
      idleColor: String(v("idleColor")),
      blinkNearHz: Number(v("blinkNearHz")),
      blinkFarHz: Number(v("blinkFarHz")),
      minPulseOpacity: Number(v("minPulseOpacity")),
      afterglowS: Number(v("afterglowS")),
      sweepEnabled: v("sweepEnabled") === true,
      sweepPeriodS: Number(v("sweepPeriodS")),
    };
  };

  const valueTextDefaults = (e: ElementSlot, props: Record<string, unknown>) => {
    const src = e.valueSource;
    let unit: string | undefined;
    let decimals: number | undefined;
    if (src?.kind === "tel") {
      const info = channels(src.name);
      unit = info?.unit ?? undefined;
      decimals = info?.decimals ?? (info?.dataType === "Integer" ? 0 : undefined);
    } else if (src?.kind === "sig") {
      unit = config.signals?.[src.name]?.unit;
      decimals = config.signals?.[src.name]?.decimals;
    }
    if (props.unit === "fromSource") props.unit = unit ?? "";
    if (props.decimals === "fromSource") props.decimals = decimals;
  };

  const assemble = (t: number, live: boolean, source?: RuntimeSource): FrameResult => {
    const out: Record<string, ElementFrame> = Object.create(null);
    for (const e of elements) {
      try {
        const frame = elementFrame(e);
        if (e.lidar) {
          const o = lidarOptions(e);
          const grid = live && e.el.source && source?.lidarGrid ? source.lidarGrid(e.el.source) : undefined;
          if (live) {
            const r = e.lidar.step(t, grid ?? { state: "invalid" }, o);
            frame.lidar = r.frame;
            frame.marker = worstMarker(frame.marker, r.marker);
          } else {
            frame.lidar = e.lidar.idle(o);
          }
        }
        if (e.el.type === "valueText") {
          valueTextDefaults(e, frame.props);
          frame.noValue = frame.markers.value === "invalid" || frame.props.value === null || frame.props.value === undefined;
        }
        if ((e.el.type === "linearGauge" || e.el.type === "radialGauge") && !(Number(frame.props.max) > Number(frame.props.min))) {
          runtimeDiagnostic("OVL_RUNTIME_INVALID_GRAPHIC", { element: e.id, property: "max" }, "Anzeige: max muss größer als min sein");
          frame.marker = "invalid";
        }
        if (!live) frame.marker = undefined;
        frame.hidden = live && e.el.onInvalid === "hide" && frame.marker === "invalid";
        out[e.id] = frame;
      } catch (err) {
        runtimeDiagnostic("OVL_RUNTIME_ELEMENT_ERROR", { element: e.id }, String(err instanceof Error ? err.message : err));
      }
    }
    const clipFrames: Record<string, ClipFrame> = Object.create(null);
    for (const c of clips) {
      const f: ClipFrame = { phase: c.state.phase };
      const o = clipOutput(c.state, c.clip, t);
      if (o.output === "tau") f.tau = o.tau;
      if (c.marker) f.marker = c.marker;
      clipFrames[c.id] = f;
    }
    return { t, elements: out, clips: clipFrames, diagnostics: [...staticDiagnostics, ...diagnostics] };
  };

  const elementFrame = (e: ElementSlot): ElementFrame => {
    const frame: ElementFrame = { props: {}, markers: {}, parts: {}, hidden: false };
    let marker: Marker | undefined;
    for (const s of e.slots) {
      frame.props[s.name] = s.value;
      if (s.marker) {
        frame.markers[s.name] = s.marker;
        marker = worstMarker(marker, s.marker);
      }
    }
    if (e.el.lockAspect) frame.props.scaleY = frame.props.scaleX;
    for (const [partId, set] of Object.entries(e.parts)) {
      const part = { props: {} as Record<string, unknown>, markers: {} as Record<string, Marker> };
      for (const s of set.slots) {
        part.props[s.name] = s.value;
        if (s.marker) {
          part.markers[s.name] = s.marker;
          marker = worstMarker(marker, s.marker);
        }
      }
      if (!set.byName.scaleY) part.props.scaleY = part.props.scaleX;
      frame.parts[partId] = part;
    }
    if (marker) frame.marker = marker;
    return frame;
  };

  const applyTracks = (c: ClipSlot, t: number, scrubTau?: number) => {
    const o = scrubTau === undefined ? clipOutput(c.state, c.clip, t) : { output: "tau" as const, tau: scrubTau };
    c.clip.tracks.forEach((track, i) => {
      const s = c.targets[i];
      if (!s) return;
      if (o.output === "tau") s.value = sampleKeyframes(track.keyframes, o.tau, s.interpolation) ?? s.base;
      else if (o.output === "base") s.value = s.base;
      s.marker = c.marker;
    });
  };

  const step = (t: number, source: RuntimeSource): FrameResult => {
    diagnostics = [];
    const first = lastT === undefined;
    const dt = first || t < lastT! ? 0 : t - lastT!;
    lastT = t;
    // 1./2. sources are read lazily; clip conditions and states.
    for (const c of clips) {
      let cond: RuntimeValue | undefined;
      if (c.condition) cond = evalDriver(c.condition.analysis, source, { clip: c.id, field: "trigger.condition" });
      c.state = stepClip(c.state, c.clip, t, first, cond, sessionStart);
      c.marker = cond ? qualityMarker(cond) : undefined;
      if (cond && cond.state === "valid" && typeof cond.value !== "boolean") c.marker = "invalid";
    }
    // 3. rates, 4. bindings with smoothing.
    for (const mode of ["rate", "binding"] as const) {
      for (const s of driven) {
        if (s.driver!.mode !== mode) continue;
        const rv = evalDriver(s.driver!.analysis, source, s.location);
        if (mode === "rate") stepRate(s, rv, dt);
        else stepBinding(s, rv, dt);
      }
    }
    // 5. clip tracks.
    for (const c of clips) applyTracks(c, t);
    return assemble(t, true, source);
  };

  const baseFrame = (scrub?: Scrub): FrameResult => {
    diagnostics = [];
    reset();
    for (const c of clips) {
      if (c.id !== scrub?.clipId) continue;
      const tau = Math.min(Math.max(scrub.tau, 0), c.clip.durationS);
      applyTracks(c, 0, tau);
    }
    const frame = assemble(0, false);
    reset();
    return frame;
  };

  const dependencies = (): Dependency[] => {
    const seen = new Set<string>();
    const out: Dependency[] = [];
    const add = (d: Dependency) => {
      const key = `${d.kind}:${d.name}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(d);
    };
    for (const s of driven) s.driver!.analysis.dependencies.forEach(add);
    for (const c of clips) c.condition?.analysis.dependencies.forEach(add);
    for (const e of elements) if (e.lidar && e.el.source) add({ kind: "tel", name: e.el.source });
    return out;
  };

  const refreshChannels = (): boolean => {
    let changed = false;
    const redo = (f: { expr: string; analysis: Analysis; signature: string }, expected: string) => {
      const names = telDeps(f.analysis);
      if (names.length === 0 || signatureOf(names) === f.signature) return;
      const next = analyzeFormula(f.expr, expected);
      f.analysis = next.analysis;
      f.signature = next.signature;
      changed = true;
    };
    for (const s of driven) redo(s.driver!, s.driver!.expected);
    for (const c of clips) if (c.condition) redo(c.condition, "bool");
    for (const e of elements) if (e.el.type === "valueText") e.valueSource = e.byName.value?.driver?.analysis.dependencies[0];
    if (changed) {
      // Static formula diagnostics are recomputed from the new analyses.
      staticDiagnostics.splice(0, staticDiagnostics.length,
        ...staticDiagnostics.filter((d) => d.code === "OVL_CLIP_PROPERTY_CONFLICT"));
      for (const s of driven) formulaDiagnostic(s.driver!.analysis, s.location);
      for (const c of clips) {
        for (const d of c.condition?.analysis.diagnostics ?? []) {
          staticDiagnostics.push({ code: d.code, severity: "error", location: { clip: c.id, field: "trigger.condition", offset: d.offset }, message: d.message });
        }
      }
    }
    return changed;
  };

  reset();
  return {
    reset,
    step,
    baseFrame,
    dependencies,
    continuous,
    staticElements: () => new Set(elements
      .filter((e) => e.el.type !== "lidarWidget" && e.el.type !== "valueText"
        && ![...e.slots, ...Object.values(e.parts).flatMap((p) => p.slots)].some((s) => s.driver || s.clip !== undefined))
      .map((e) => e.id)),
    setLocale: (l) => { locale = l; },
    refreshChannels,
  };
}
