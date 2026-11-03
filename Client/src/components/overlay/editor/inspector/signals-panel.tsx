"use client";
// HUD signals of the document (D36): declare, edit and remove the sources of
// sig("…"). Signals of the driver's HUD-Signal flow nodes (D37) can be taken
// over with one click. All changes go through the setSignals editor command.
import React, { useState } from "react";
import { SIGNAL_NAME } from "../../document/schema";
import type { SignalDefinition } from "../../document/types";
import type { Locale } from "../../runtime/types";
import { useEditorState } from "../canvas/hooks";
import type { EditorStore } from "../core/store";
import { declareSignal, undeclaredFlowSignals, type ChannelDirectory } from "./channels";
import { btn, input } from "./formula-field";
import { dynamicsMessages } from "./messages";

export interface SignalsPanelProps {
  store: EditorStore;
  locale: Locale;
  channels?: ChannelDirectory;
}

export function SignalsPanel({ store, locale, channels }: SignalsPanelProps) {
  const m = dynamicsMessages[locale] ?? dynamicsMessages.de;
  const state = useEditorState(store);
  const signals = state.document.signals ?? {};
  const [name, setName] = useState("");

  const set = (next: Record<string, SignalDefinition>) => store.dispatch({ type: "setSignals", signals: next });
  const update = (key: string, patch: Partial<SignalDefinition>) => {
    const def: SignalDefinition = { ...signals[key], ...patch };
    if (!def.label) def.label = key;
    if (!def.unit) delete def.unit;
    if (def.decimals === undefined) delete def.decimals;
    set({ ...signals, [key]: def });
  };
  const remove = (key: string) => {
    const { [key]: _removed, ...rest } = signals;
    set(rest);
  };

  const trimmed = name.trim();
  const nameError = trimmed === "" ? undefined : !SIGNAL_NAME.test(trimmed) ? m.signalNameInvalid : signals[trimmed] ? m.signalExists : undefined;
  const add = () => {
    if (trimmed === "" || nameError) return;
    set(declareSignal(signals, trimmed));
    setName("");
  };

  // Flow signals are only known when the host loaded the flow.
  const flowKnown = channels?.flowSignals !== undefined;
  const flowNames = new Set(channels?.flowSignals ?? []);
  const fromFlow = channels ? undeclaredFlowSignals(channels, signals) : [];
  const keys = Object.keys(signals).sort();

  return (
    <div className="flex flex-col gap-2 text-xs" data-ovl-signals="">
      <div className="text-[11px] text-zinc-400">{m.signalPanelHint}</div>

      {keys.map((key) => {
        const def = signals[key];
        return (
          <div key={key} className="flex flex-col gap-1 rounded border border-zinc-800 p-1.5" data-ovl-signal={key}>
            <div className="flex items-center gap-1">
              <span className="font-mono text-zinc-100 truncate flex-1" title={key}>sig(&quot;{key}&quot;)</span>
              <button className={btn} title={m.removeSignal} onClick={() => remove(key)}>✕</button>
            </div>
            {flowKnown && (
              <span className={`text-[11px] ${flowNames.has(key) ? "text-zinc-400" : "text-amber-400"}`}>
                {flowNames.has(key) ? m.signalInFlow : m.signalNotInFlow}
              </span>
            )}
            <label className="flex items-center gap-1">
              <span className="w-24 shrink-0 text-zinc-400">{m.signalLabel}</span>
              <TextField value={def.label} maxLength={100} onCommit={(v) => update(key, { label: v.trim() })} />
            </label>
            <label className="flex items-center gap-1">
              <span className="w-24 shrink-0 text-zinc-400">{m.signalUnit}</span>
              <TextField value={def.unit ?? ""} maxLength={32} onCommit={(v) => update(key, { unit: v.trim() || undefined })} />
            </label>
            <label className="flex items-center gap-1">
              <span className="w-24 shrink-0 text-zinc-400">{m.signalDecimals}</span>
              <select
                className={input}
                value={def.decimals === undefined ? "" : String(def.decimals)}
                onChange={(e) => update(key, { decimals: e.target.value === "" ? undefined : Number(e.target.value) })}
              >
                <option value="">–</option>
                {[0, 1, 2, 3, 4, 5, 6].map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
          </div>
        );
      })}

      {fromFlow.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-zinc-400">{m.addFromFlow}</span>
          <div className="flex flex-wrap gap-1">
            {fromFlow.map((n) => (
              <button key={n} className={`${btn} font-mono`} data-ovl-flow-signal={n} onClick={() => set(declareSignal(signals, n))}>+ {n}</button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-1">
          <input
            className={`${input} font-mono`}
            value={name}
            placeholder={m.signalName}
            maxLength={64}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") add(); }}
          />
          <button className={btn} disabled={trimmed === "" || !!nameError} onClick={add}>{m.addSignal}</button>
        </div>
        {nameError && <span className="text-[11px] text-amber-400">{nameError}</span>}
      </div>
    </div>
  );
}

function TextField({ value, maxLength, onCommit }: { value: string; maxLength: number; onCommit(v: string): void }) {
  const commit = (text: string) => { if (text !== value) onCommit(text); };
  return (
    <input
      className={input}
      key={value}
      defaultValue={value}
      maxLength={maxLength}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") commit((e.target as HTMLInputElement).value); }}
      onBlur={(e) => commit(e.target.value)}
    />
  );
}
