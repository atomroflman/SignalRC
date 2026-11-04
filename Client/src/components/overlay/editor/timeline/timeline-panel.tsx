"use client";
// AP10 – keyframe timeline: independent clips with duration, repeat, end
// state, trigger (auto / whileTrue / pulse) and deactivation behavior, tracks
// with keyframes and easing, and design mode scrubbing of exactly one clip
// (runtime §7; the design canvas renders store.scrub via AP08 baseFrame).
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { ClipSettings, Keyframe, Trigger } from "../../document/types";
import type { RendererSource } from "../../runtime/controller";
import type { Locale } from "../../runtime/types";
import { useEditorState } from "../canvas/hooks";
import type { EditorStore } from "../core/store";
import type { TrackRef } from "../core/types";
import { analysisEnv, type ChannelDirectory } from "../inspector/channels";
import { FormulaField, btn, input } from "../inspector/formula-field";
import { dynamicsMessages, type DynamicsMessages } from "../inspector/messages";
import { parseLiteral } from "../inspector/model";
import { NumberField } from "../inspector/property-inspector";
import {
  addTrack, conditionCommand, durationCommand, keyframesCommand, listClips, moveKeyframe, newClipCommand, onDeactivateCommand,
  pruneScrub, removeKeyframe, removeTrackCommand, repeatCommand, resetFieldCommand, retriggerCommand, rulerTicks, scrubTo,
  setKeyframeAt, setKeyframeEasing, setKeyframeValue, settingsCommand, snapTau, stopScrub, tauFromX, trackCandidates, trackRows,
  trackValueAt, triggerModeCommand, type ClipInfo, type TrackRow,
} from "./model";

export interface TimelinePanelProps {
  store: EditorStore;
  locale: Locale;
  channels?: ChannelDirectory;
  /** Live values for the condition check (read-only). */
  source?: RendererSource;
  /** Selected clip (controlled); otherwise kept by the panel. */
  clip?: string;
  onSelectClip?: (clip: string | undefined) => void;
  className?: string;
}

interface KeyframeSel {
  track: number;
  t: number;
}

const EASINGS = ["linear", "easeIn", "easeOut", "easeInOut", "step"] as const;

const label = (store: EditorStore, ref: TrackRef) => {
  const el = store.effective().elements[ref.element];
  return `${el?.name ?? ref.element}${ref.part ? `/${ref.part}` : ""}.${ref.property}`;
};

const display = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "number" ? String(Math.round(v * 1e4) / 1e4) : String(v));

export function TimelinePanel(props: TimelinePanelProps) {
  const { store, locale } = props;
  const m = dynamicsMessages[locale] ?? dynamicsMessages.de;
  const state = useEditorState(store);
  const [own, setOwn] = useState<string | undefined>();
  const clips = listClips(store);
  const selectedId = props.clip ?? own;
  const info = clips.find((c) => c.id === selectedId);
  const select = (id: string | undefined) => { setOwn(id); props.onSelectClip?.(id); };

  useEffect(() => { pruneScrub(store); }, [store, state.version, state.activeVariant]);

  const create = () => {
    const { id, command } = newClipCommand(store);
    if (store.dispatch(command, { label: m.newClip }).ok) select(id);
  };

  return (
    <div className={`flex flex-col gap-2 text-xs ${props.className ?? ""}`} data-ovl-timeline={info?.id ?? ""}>
      <div className="flex flex-wrap items-center gap-1">
        <span className="font-semibold text-zinc-400 mr-1">{m.timeline}</span>
        {clips.length === 0 && <span className="text-zinc-500">{m.noClips}</span>}
        {clips.map((c) => (
          <button
            key={c.id}
            className={`${btn} ${c.id === info?.id ? "bg-sky-900/70 border-sky-700" : ""} ${c.clip.disabled ? "opacity-50" : ""}`}
            title={c.inherited ? m.inheritedClip : undefined}
            data-ovl-clip={c.id}
            onClick={() => select(c.id === info?.id ? undefined : c.id)}
          >
            {c.clip.name ?? c.id}
            {c.overridden.length > 0 && <span className="ml-1 text-amber-400">●</span>}
            {c.diagnostics.some((d) => d.severity === "error") && <span className="ml-1 text-red-400">!</span>}
          </button>
        ))}
        <button className={btn} onClick={create}>+ {m.newClip}</button>
        {state.scrub && <button className={btn} onClick={() => stopScrub(store)}>{m.baseValues}</button>}
      </div>
      {info && <ClipEditor key={info.id} {...props} info={info} m={m} onDeleted={() => select(undefined)} />}
    </div>
  );
}

function ClipEditor({ store, info, m, channels, source, locale, onDeleted }: TimelinePanelProps & { info: ClipInfo; m: DynamicsMessages; onDeleted(): void }) {
  const state = store.getState();
  const scope = state.activeVariant;
  const { clip, id } = info;
  const [scale, setScale] = useState(true);
  const env = useMemo(() => analysisEnv(channels ?? {}, state.document.signals), [channels, state.document.signals]);
  const trigger = clip.trigger;
  const dispatch = (cmd: Parameters<EditorStore["dispatch"]>[0] | undefined, mergeKey?: string) => { if (cmd) store.dispatch(cmd, mergeKey ? { mergeKey: `${id}/${mergeKey}` } : {}); };
  const field = (name: keyof ClipSettings, children: React.ReactNode) => {
    const overridden = info.overridden.includes(name);
    const reset = overridden ? resetFieldCommand(id, name, scope) : undefined;
    return (
      <span className="flex items-center gap-1">
        {children}
        {reset && <button className={btn} title={m.reset} onClick={() => dispatch(reset)}>↺</button>}
      </span>
    );
  };
  const remove = () => {
    if (info.inherited) dispatch(settingsCommand(id, { disabled: true }));
    else if (store.dispatch({ type: "removeClip", id }).ok) onDeleted();
  };

  return (
    <div className="flex flex-col gap-2" data-ovl-clip-editor={id}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {field("name", (
          <label className="flex items-center gap-1">{m.clipName}
            <input className={`${input} w-32`} key={`${id}-name-${state.version}`} defaultValue={clip.name ?? ""} placeholder={id}
              onKeyDown={(e) => e.stopPropagation()}
              onBlur={(e) => { const v = e.target.value.trim(); if (v !== (clip.name ?? "")) dispatch(settingsCommand(id, { name: v || undefined })); }} />
          </label>
        ))}
        {field("durationS", (
          <label className="flex items-center gap-1">{m.duration}
            <NumberField value={clip.durationS} onCommit={(v) => dispatch(durationCommand(store, id, clip, v, scale ? "scale" : "trim"))} />
            <input type="checkbox" checked={scale} onChange={(e) => setScale(e.target.checked)} title={m.scaleKeyframes} />
            <span className="text-zinc-500">{m.scaleKeyframes}</span>
          </label>
        ))}
        {field("repeat", (
          <label className="flex items-center gap-1">{m.repeat}
            {clip.repeat !== "infinite" && <NumberField value={clip.repeat ?? 1} onCommit={(v) => dispatch(repeatCommand(id, v))} />}
            <input type="checkbox" checked={clip.repeat === "infinite"} onChange={(e) => dispatch(repeatCommand(id, e.target.checked ? "infinite" : 1))} />
            <span className="text-zinc-500">{m.infinite}</span>
          </label>
        ))}
        {field("endState", (
          <label className="flex items-center gap-1">{m.endState}
            <select className={`${input} w-32`} value={clip.endState ?? "base"} onChange={(e) => dispatch(settingsCommand(id, { endState: e.target.value }))}>
              <option value="base">{m.endStates.base}</option>
              <option value="hold">{m.endStates.hold}</option>
            </select>
          </label>
        ))}
        {field("disabled", (
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={!!clip.disabled} onChange={(e) => dispatch(settingsCommand(id, { disabled: e.target.checked ? true : info.inherited ? false : undefined }))} />
            {m.disableClip}
          </label>
        ))}
        {!info.inherited && <button className={btn} onClick={remove}>{m.deleteClip}</button>}
      </div>
      {field("trigger", (
        <div className="flex flex-wrap items-start gap-x-3 gap-y-1 w-full">
          <label className="flex items-center gap-1">{m.trigger}
            <select className={`${input} w-48`} value={trigger.mode} onChange={(e) => dispatch(triggerModeCommand(id, trigger, e.target.value as Trigger["mode"]))}>
              {(["auto", "whileTrue", "pulse"] as const).map((t) => <option key={t} value={t}>{m.triggers[t]}</option>)}
            </select>
          </label>
          {trigger.mode !== "auto" && (
            <label className="flex flex-1 min-w-[14rem] items-start gap-1">{m.condition}
              <div className="flex-1">
                <FormulaField value={trigger.condition} expected="bool" env={env} dir={channels} signals={state.document.signals} source={source} locale={locale} m={m} testId="condition"
                  onCommit={(expr) => dispatch(conditionCommand(id, trigger, expr), "condition")} />
              </div>
            </label>
          )}
          {trigger.mode === "whileTrue" && (
            <label className="flex items-center gap-1">{m.onDeactivate}
              <select className={`${input} w-36`} value={trigger.onDeactivate ?? "stop"} onChange={(e) => dispatch(onDeactivateCommand(id, trigger, e.target.value as "stop" | "finish"))}>
                <option value="stop">{m.onDeactivateValues.stop}</option>
                <option value="finish">{m.onDeactivateValues.finish}</option>
              </select>
            </label>
          )}
          {trigger.mode === "pulse" && (
            <label className="flex items-center gap-1">{m.retrigger}
              <select className={`${input} w-32`} value={trigger.retrigger ?? "restart"} onChange={(e) => dispatch(retriggerCommand(id, trigger, e.target.value as "restart" | "ignore"))}>
                <option value="restart">{m.retriggerValues.restart}</option>
                <option value="ignore">{m.retriggerValues.ignore}</option>
              </select>
            </label>
          )}
        </div>
      ))}
      {info.diagnostics.filter((d) => d.location.track === undefined).map((d, i) => (
        <span key={i} className={`text-[11px] ${d.severity === "error" ? "text-red-400" : "text-amber-400"}`} data-ovl-diagnostic={d.code}>{d.code}: {d.message}</span>
      ))}
      <Tracks store={store} info={info} m={m} />
    </div>
  );
}

function Tracks({ store, info, m }: { store: EditorStore; info: ClipInfo; m: DynamicsMessages }) {
  const state = store.getState();
  const rows = trackRows(store, info);
  const d = info.clip.durationS;
  const [sel, setSel] = useState<KeyframeSel | undefined>();
  const drag = useRef<{ kind: "scrub" } | { kind: "key"; row: TrackRow; index: number; start: Keyframe[]; moved: boolean } | null>(null);
  const tau = state.scrub?.clipId === info.id ? state.scrub.tau : undefined;
  const ticks = rulerTicks(d, 480);
  const times = rows.flatMap((r) => r.track.keyframes.map((k) => k.t));

  const tauAt = (e: React.PointerEvent, el: HTMLElement) => {
    const box = el.getBoundingClientRect();
    return tauFromX(e.clientX - box.left, box.width, d);
  };
  const lane = (e: React.PointerEvent) => (e.currentTarget as HTMLElement).closest("[data-ovl-lane]") as HTMLElement ?? (e.currentTarget as HTMLElement);

  const onLaneDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { kind: "scrub" };
    scrubTo(store, info.id, snapTau(tauAt(e, lane(e)), times, d / 100));
  };
  const onKeyDown = (e: React.PointerEvent, row: TrackRow, index: number) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    // Focus the track area so that Escape cancels the drag.
    ((e.currentTarget as HTMLElement).closest("[data-ovl-tracks]") as HTMLElement | null)?.focus();
    setSel({ track: row.index, t: row.track.keyframes[index].t });
    store.beginTransaction(m.keyframe);
    drag.current = { kind: "key", row, index, start: row.track.keyframes, moved: false };
  };
  const onMove = (e: React.PointerEvent) => {
    const g = drag.current;
    if (!g) return;
    const t = tauAt(e, lane(e));
    if (g.kind === "scrub") { scrubTo(store, info.id, snapTau(t, times, d / 100)); return; }
    const moved = moveKeyframe(g.start, g.index, t, d);
    if (!moved) return;
    g.moved = true;
    store.dispatch(keyframesCommand(info.id, g.row.ref, moved.keyframes));
    setSel({ track: g.row.index, t: moved.keyframes[moved.index].t });
  };
  const onUp = () => {
    const g = drag.current;
    drag.current = null;
    if (g?.kind === "key") store.commitTransaction();
  };
  const onEscape = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && drag.current?.kind === "key") { drag.current = null; store.cancelTransaction(); }
  };

  const addAtPlayhead = (row: TrackRow) => {
    const at = tau ?? 0;
    const value = trackValueAt(store, row.track, at) as Keyframe["value"];
    const next = setKeyframeAt(row.track.keyframes, at, value);
    if (store.dispatch(keyframesCommand(info.id, row.ref, next.keyframes), { label: m.addKeyframe }).ok) setSel({ track: row.index, t: next.keyframes[next.index].t });
  };

  const selRow = sel ? rows.find((r) => r.index === sel.track) : undefined;
  const selIndex = selRow ? selRow.track.keyframes.findIndex((k) => Math.abs(k.t - sel!.t) < 1e-6) : -1;
  const pct = (t: number) => `${(Math.min(Math.max(t / d, 0), 1) * 100).toFixed(3)}%`;

  return (
    <div className="flex flex-col gap-1 outline-none" onKeyDown={onEscape} tabIndex={-1} data-ovl-tracks>
      <div className="grid grid-cols-[12rem_1fr_auto] items-end gap-1">
        <span className="text-zinc-400 font-semibold">{m.tracks}</span>
        <div className="relative h-5 border-b border-zinc-700 cursor-ew-resize select-none touch-none" data-ovl-lane="ruler"
          onPointerDown={onLaneDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          {ticks.map((t) => (
            <span key={t} className="absolute bottom-0 text-[10px] text-zinc-500 -translate-x-1/2" style={{ left: pct(t) }}>{t}</span>
          ))}
          {tau !== undefined && <span className="absolute top-0 bottom-0 w-px bg-red-500" style={{ left: pct(tau) }} data-ovl-playhead={tau} />}
        </div>
        <span className="text-[11px] text-zinc-400 w-16 text-right">{tau !== undefined ? `${m.scrub} ${tau}s` : ""}</span>
      </div>
      {rows.length === 0 && <span className="text-zinc-500">{m.noTracks}</span>}
      {rows.map((row) => (
        <div key={`${row.ref.element}/${row.ref.part ?? ""}/${row.ref.property}`} className="grid grid-cols-[12rem_1fr_auto] items-center gap-1" data-ovl-track={row.index}>
          <span className={`truncate ${row.diagnostics.length ? "text-red-400" : "text-zinc-300"}`} title={row.diagnostics.map((x) => `${x.code}: ${x.message}`).join("\n") || undefined}>
            {label(store, row.ref)}
          </span>
          <div className="relative h-5 rounded bg-zinc-800/70 cursor-ew-resize select-none touch-none" data-ovl-lane={row.index}
            onPointerDown={onLaneDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
            {row.track.keyframes.map((k, i) => {
              const active = sel?.track === row.index && Math.abs(sel.t - k.t) < 1e-6;
              return (
                <span
                  key={`${k.t}-${i}`}
                  className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border ${active ? "bg-amber-400 border-amber-200" : "bg-sky-500 border-sky-300"} cursor-grab`}
                  style={{ left: pct(k.t) }}
                  title={`${k.t}s: ${display(k.value)}${k.easing ? ` (${m.easings[k.easing]})` : ""}`}
                  data-ovl-keyframe={k.t}
                  onPointerDown={(e) => onKeyDown(e, row, i)}
                />
              );
            })}
            {tau !== undefined && <span className="absolute top-0 bottom-0 w-px bg-red-500 pointer-events-none" style={{ left: pct(tau) }} />}
          </div>
          <span className="flex gap-1">
            <button className={btn} title={m.addKeyframe} onClick={() => addAtPlayhead(row)}>◆+</button>
            <button className={btn} title={m.removeTrack} onClick={() => store.dispatch(removeTrackCommand(info.id, row.ref))}>✕</button>
          </span>
        </div>
      ))}
      {selRow && selIndex >= 0 && (
        <KeyframeEditor store={store} info={info} row={selRow} index={selIndex} m={m} onSelect={setSel} />
      )}
      <AddTrack store={store} info={info} m={m} />
    </div>
  );
}

function KeyframeEditor({ store, info, row, index, m, onSelect }: { store: EditorStore; info: ClipInfo; row: TrackRow; index: number; m: DynamicsMessages; onSelect(s: KeyframeSel | undefined): void }) {
  const k = row.track.keyframes[index];
  const [error, setError] = useState<string | undefined>();
  const set = (keyframes: Keyframe[] | null) => store.dispatch(keyframesCommand(info.id, row.ref, keyframes), { mergeKey: `${info.id}/${row.index}/kf` });
  const commitValue = (text: string | boolean) => {
    if (!row.def) return;
    const parsed = parseLiteral(row.def, text);
    if (!parsed.ok || parsed.value === undefined) { setError(m.invalidInput[parsed.ok ? "type" : parsed.problem]); return; }
    setError(undefined);
    set(setKeyframeValue(row.track.keyframes, index, parsed.value));
  };
  const isBool = row.def && typeof k.value === "boolean";
  return (
    <div className="flex flex-wrap items-center gap-2 rounded border border-zinc-800 p-1" data-ovl-keyframe-editor={`${row.index}:${k.t}`}>
      <span className="text-zinc-400">{m.keyframe} · {label(store, row.ref)}</span>
      <label className="flex items-center gap-1">{m.time}
        <NumberField value={k.t} onCommit={(t) => {
          const moved = moveKeyframe(row.track.keyframes, index, t, info.clip.durationS);
          if (moved && set(moved.keyframes).ok) onSelect({ track: row.index, t: moved.keyframes[moved.index].t });
        }} />
      </label>
      <label className="flex items-center gap-1">{m.value}
        {isBool ? (
          <input type="checkbox" checked={k.value === true} onChange={(e) => commitValue(e.target.checked)} />
        ) : row.def?.values ? (
          <select className={`${input} w-28`} value={String(k.value)} onChange={(e) => commitValue(e.target.value)}>
            {row.def.values.map((v) => <option key={String(v)} value={String(v)}>{String(v)}</option>)}
          </select>
        ) : (
          <input className={`${input} w-28 ${error ? "border-red-700" : ""}`} key={`${row.index}-${k.t}-${display(k.value)}`} defaultValue={display(k.value)} title={error}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") commitValue((e.target as HTMLInputElement).value); }}
            onBlur={(e) => { if (e.target.value !== display(k.value)) commitValue(e.target.value); }} />
        )}
      </label>
      {row.interpolation !== "step" && index < row.track.keyframes.length - 1 && (
        <label className="flex items-center gap-1">{m.easing}
          <select className={`${input} w-40`} value={k.easing ?? "linear"} onChange={(e) => set(setKeyframeEasing(row.track.keyframes, index, e.target.value as Keyframe["easing"]))}>
            {EASINGS.map((x) => <option key={x} value={x}>{m.easings[x]}</option>)}
          </select>
        </label>
      )}
      <button className={btn} onClick={() => { set(removeKeyframe(row.track.keyframes, index)); onSelect(undefined); }}>{m.deleteKeyframe}</button>
    </div>
  );
}

function AddTrack({ store, info, m }: { store: EditorStore; info: ClipInfo; m: DynamicsMessages }) {
  const state = store.getState();
  const config = store.effective();
  const [element, setElement] = useState<string>("");
  const [target, setTarget] = useState<string>("");
  const el = element || state.selection.find((id) => config.elements[id]) || "";
  const candidates = el ? trackCandidates(store, info.id, el).filter((c) => c.state !== "thisClip") : [];
  const keyOf = (c: { part?: string; property: string }) => `${c.part ?? ""}:${c.property}`;
  const chosen = candidates.find((c) => keyOf(c) === target) ?? candidates[0];
  const elements = Object.keys(config.elements).sort();
  return (
    <div className="flex flex-wrap items-center gap-1" data-ovl-add-track>
      <span className="text-zinc-400">{m.addTrack}</span>
      <select className={`${input} w-40`} value={el} onChange={(e) => { setElement(e.target.value); setTarget(""); }}>
        <option value="">{m.element} …</option>
        {elements.map((id) => <option key={id} value={id}>{config.elements[id].name ?? id}</option>)}
      </select>
      <select className={`${input} w-48`} value={chosen ? keyOf(chosen) : ""} onChange={(e) => setTarget(e.target.value)} disabled={!candidates.length} title={m.addTrackFor}>
        {candidates.map((c) => (
          <option key={keyOf(c)} value={keyOf(c)}>
            {c.part ? `${c.part}.` : ""}{c.property}{c.state !== "free" ? ` – ${m.replaces[c.state as "binding" | "rate" | "otherClip"]}` : ""}
          </option>
        ))}
      </select>
      <button className={btn} disabled={!chosen} onClick={() => chosen && addTrack(store, info.id, chosen, m.addTrack)}>+</button>
    </div>
  );
}
