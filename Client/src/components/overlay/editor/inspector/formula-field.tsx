"use client";
// AP10 – formula input with live AP06 diagnostics and live value, plus the
// channel picker of simple bindings. Shared by inspector and timeline.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { setDiagnostics } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { PropDef } from "../../document/catalog";
import type { SignalDefinition } from "../../document/types";
import type { AnalysisEnv, ExprDiagnostic, ValueSource } from "../../expression";
import type { RendererSource } from "../../runtime/controller";
import type { Locale } from "../../runtime/types";
import type { OverlaySourceProvider } from "../../sources/types";
import { bindableSources, type ChannelDirectory } from "./channels";
import { checkFormula, liveValue, simpleSource, sourceExpr, type FormulaCheck, type LiveValue } from "./formula";
import { formulaDiagnostics, formulaExtensions, formulaSources, type FormulaContext } from "./formula-language";
import type { DynamicsMessages } from "./messages";

export const btn = "px-1.5 py-0.5 rounded text-[11px] border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 disabled:opacity-40";
export const input = "w-full min-w-0 bg-zinc-800 text-zinc-100 border border-zinc-700 rounded px-1 py-0.5 text-xs";

const isProvider = (s: RendererSource | undefined): s is OverlaySourceProvider =>
  !!s && typeof (s as OverlaySourceProvider).require === "function";
const subscribable = (s: RendererSource | undefined): s is RendererSource & { subscribe(l: () => void): () => void } =>
  !!s && typeof (s as { subscribe?: unknown }).subscribe === "function";

let consumerCounter = 0;

/**
 * Live value of a checked formula. Requests the formula's sources from an
 * AP05 provider while shown (demand, D25) and re-evaluates at most 4×/s.
 */
export function useLiveValue(check: FormulaCheck, source: RendererSource | undefined, locale: Locale, def?: PropDef): LiveValue {
  const [tick, setTick] = useState(0);
  const id = useRef<string>("");
  if (!id.current) id.current = `ovl-inspector-${++consumerCounter}`;
  const deps = check.diagnostic ? [] : check.analysis.dependencies;
  const depsKey = deps.map((d) => `${d.kind}:${d.name}`).join("|");
  useEffect(() => {
    if (!source) return;
    const req = isProvider(source) && deps.length > 0 ? source.require(id.current, deps) : undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribable(source)
      ? source.subscribe(() => {
        if (timer === undefined) timer = setTimeout(() => { timer = undefined; setTick((t) => t + 1); }, 250);
      })
      : undefined;
    return () => {
      req?.release();
      unsubscribe?.();
      if (timer !== undefined) clearTimeout(timer);
    };
    // deps are captured through depsKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, depsKey]);
  return useMemo(() => liveValue(check, source as ValueSource | undefined, locale, def), [check, source, locale, def, tick]);
}

export function LiveBadge({ live, m }: { live: LiveValue; m: DynamicsMessages }) {
  if (live.state === "none") return null;
  const color = live.state === "valid" ? "text-emerald-400" : live.state === "unchecked" ? "text-yellow-400" : "text-zinc-500";
  return (
    <span className={`text-[11px] ${color}`} data-ovl-live={live.state} title={live.diagnostic}>
      {m.live}: {live.text ?? "—"} ({m.liveState[live.state]}{live.paused ? `, ${m.paused}` : ""}){live.diagnostic ? ` ${live.diagnostic}` : ""}
    </span>
  );
}

export interface FormulaFieldProps {
  value: string;
  /** Expected result kind: property kind, "bool" (condition) or "number" (rate). */
  expected: string;
  env: AnalysisEnv;
  /** Units and decimals for completion and hover; names come from `env` alone without it. */
  dir?: ChannelDirectory;
  signals?: Record<string, SignalDefinition>;
  source?: RendererSource;
  locale: Locale;
  def?: PropDef;
  m: DynamicsMessages;
  onCommit(expr: string): void;
  testId?: string;
}

/**
 * Formula text with a live check of what is being typed (AP06 analysis, one
 * diagnostic with offset). Committed on blur/Enter; drafts may stay invalid
 * (publish errors are allowed in the draft).
 */
export function FormulaField(props: FormulaFieldProps) {
  const { value, expected, env, m } = props;
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const check = useMemo(() => checkFormula(draft, env, expected), [draft, env, expected]);
  const live = useLiveValue(check, props.source, props.locale, props.def);
  const sources = useMemo(() => formulaSources(env, props.dir, props.signals), [env, props.dir, props.signals]);
  const d = check.diagnostic;
  return (
    <div className="flex flex-col gap-0.5" data-ovl-formula={props.testId ?? ""}>
      <FormulaInput
        value={draft}
        diagnostic={d}
        context={{ expected, locale: props.locale, sources }}
        onChange={setDraft}
        onCommit={(text) => { if (text !== value) props.onCommit(text); }}
        onRevert={() => setDraft(value)}
      />
      {d ? (
        <span className={`text-[11px] ${d.category === "structure" ? "text-red-400" : "text-amber-400"}`} data-ovl-diagnostic={d.code}>
          {d.code} · {m.offset(d.offset)}: {d.message}
        </span>
      ) : <LiveBadge live={live} m={m} />}
    </div>
  );
}

interface FormulaInputProps {
  value: string;
  diagnostic?: ExprDiagnostic;
  context: FormulaContext;
  onChange(text: string): void;
  onCommit(text: string): void;
  onRevert(): void;
}

/** CodeMirror with the formula language; created after mount, so server rendering shows the frame only. */
function FormulaInput(props: FormulaInputProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const latest = useRef(props);
  latest.current = props;
  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: latest.current.value,
        extensions: formulaExtensions({
          context: () => latest.current.context,
          onChange: (text) => latest.current.onChange(text),
          onCommit: (text) => latest.current.onCommit(text),
          onRevert: () => latest.current.onRevert(),
        }),
      }),
    });
    view.current = v;
    return () => { v.destroy(); view.current = null; };
  }, []);
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== props.value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: props.value } });
  }, [props.value]);
  useEffect(() => {
    const v = view.current;
    if (v) v.dispatch(setDiagnostics(v.state, formulaDiagnostics(v.state.doc.toString(), props.diagnostic)));
  }, [props.value, props.diagnostic]);
  const border = props.diagnostic ? "border-red-700" : "border-zinc-700 focus-within:border-zinc-500";
  return <div ref={host} className={`min-w-0 rounded border overflow-hidden ${border}`} data-ovl-formula-input />;
}

export interface ChannelPickerProps {
  expr: string;
  expected: string;
  dir: ChannelDirectory;
  signals?: Record<string, SignalDefinition>;
  m: DynamicsMessages;
  onPick(expr: string): void;
  /** Declares a flow signal in the document before it is picked; without it flow signals are not offered. */
  onDeclareSignal?(name: string): void;
}

/** Simple binding without a hand-written formula: pick a source, get `tel("…")`. */
export function ChannelPicker({ expr, expected, dir, signals, m, onPick, onDeclareSignal }: ChannelPickerProps) {
  const options = bindableSources(dir, signals, expected).filter((o) => !o.undeclared || onDeclareSignal);
  const current = simpleSource(expr);
  const key = current ? `${current.kind}:${current.name}` : "";
  const group = (kind: "tel" | "out" | "sig", label: string, undeclared = false) => {
    const list = options.filter((o) => o.kind === kind && !!o.undeclared === undeclared);
    if (list.length === 0) return null;
    return (
      <optgroup label={label}>
        {list.map((o) => (
          <option key={`${o.kind}:${o.name}`} value={`${undeclared ? "flow" : o.kind}:${o.name}`}>
            {o.name}{o.unit ? ` [${o.unit}]` : ""}{o.decimals !== undefined && o.decimals !== null ? ` · ${o.decimals}` : ""}
          </option>
        ))}
      </optgroup>
    );
  };
  return (
    <select
      className={input}
      value={key}
      data-ovl-channel-picker
      onChange={(e) => {
        const v = e.target.value;
        const i = v.indexOf(":");
        if (i <= 0) return;
        const kind = v.slice(0, i);
        const name = v.slice(i + 1);
        // A flow signal is declared in the document first, then bound like any signal.
        if (kind === "flow") onDeclareSignal?.(name);
        onPick(sourceExpr(kind === "flow" ? "sig" : kind as "tel" | "out" | "sig", name));
      }}
    >
      <option value="">{options.length ? m.pickChannel : m.noChannels}</option>
      {current && !options.some((o) => `${o.kind}:${o.name}` === key) && <option value={key}>{current.name}</option>}
      {group("tel", m.telemetry)}
      {group("out", m.outputs)}
      {group("sig", m.signals)}
      {onDeclareSignal && group("sig", m.flowSignals, true)}
    </select>
  );
}
