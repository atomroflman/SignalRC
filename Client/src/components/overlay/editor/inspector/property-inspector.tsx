"use client";
// AP10 – property inspector: every catalog property of the selected element
// (or SVG part) with origin (default / inherited / overridden), reset, the one
// controlling mode, simple channel bindings, formulas with live AP06 checks,
// smoothing, rates with wrap, and the LiDAR widget parameters. All changes go
// through editor commands of the EditorStore.
import React, { useMemo, useState } from "react";
import type { ControlMode } from "../../document/catalog";
import type { EffectiveElement, SignalDefinition } from "../../document/types";
import type { AnalysisEnv } from "../../expression";
import type { RendererSource } from "../../runtime/controller";
import type { Locale } from "../../runtime/types";
import { useEditorState } from "../canvas/hooks";
import type { EditorStore } from "../core/store";
import { analysisEnv, channelInfo, type ChannelDirectory } from "./channels";
import { ChannelPicker, FormulaField, LiveBadge, btn, input, useLiveValue } from "./formula-field";
import { checkFormula, simpleSource } from "./formula";
import { dynamicsMessages, type DynamicsMessages } from "./messages";
import {
  applyMode, exprCommand, inspectProperty, lidarChannels, lidarSourceCommand, mergeKey, parseLiteral, rateCommand, resetCommand, sections,
  smoothingCommand, staticCommand, valueTextSourceDefaults, wrapCommand, type PropertyRow,
} from "./model";

export interface PropertyInspectorProps {
  store: EditorStore;
  locale: Locale;
  /** Channels with unit/decimals (AP05, GET …/overlay/sources). */
  channels?: ChannelDirectory;
  /** Read-only live values for formula checks in design mode. */
  source?: RendererSource;
  /** Clip that receives the track when a property is switched to clip mode. */
  activeClip?: string;
  /** Called with the clip that drives a property (open it in the timeline). */
  onOpenClip?: (clip: string) => void;
}

interface RowContext {
  store: EditorStore;
  m: DynamicsMessages;
  locale: Locale;
  dir: ChannelDirectory;
  env: AnalysisEnv;
  signals: Record<string, SignalDefinition>;
  source?: RendererSource;
  el: EffectiveElement;
  activeClip?: string;
  onOpenClip?: (clip: string) => void;
}

export function PropertyInspector(props: PropertyInspectorProps) {
  const { store, locale } = props;
  const m = dynamicsMessages[locale] ?? dynamicsMessages.de;
  const state = useEditorState(store);
  const config = store.effective();
  const dir = props.channels ?? {};
  const signals = state.document.signals;
  const env = useMemo(() => analysisEnv(dir, signals), [dir, signals]);
  const [partChoice, setPart] = useState<{ element: string; part: string | undefined }>({ element: "", part: undefined });

  const ids = state.selection.filter((id) => config.elements[id]);
  if (ids.length === 0) return <div className="text-xs text-zinc-500" data-ovl-inspector="">{m.noSelection}</div>;
  if (ids.length > 1) return <div className="text-xs text-zinc-400" data-ovl-inspector="">{m.multiSelection}</div>;
  const el = config.elements[ids[0]];
  const assetParts = Object.keys(store.geometryContext.assets?.[el.assetId ?? ""]?.metadata?.parts ?? {});
  const parts = [...new Set([...Object.keys(el.parts), ...assetParts])].sort();
  const part = partChoice.element === el.id && partChoice.part !== undefined && parts.includes(partChoice.part) ? partChoice.part : undefined;
  const ctx: RowContext = { store, m, locale, dir, env, signals: signals ?? {}, source: props.source, el, activeClip: props.activeClip, onOpenClip: props.onOpenClip };
  const scope = state.activeVariant;
  const inVariant = scope !== null && el.origin === "standard";
  const onInvalidOverridden = inVariant && state.document.variants?.[scope!]?.elements?.[el.id]?.onInvalid !== undefined;

  return (
    <div className="flex flex-col gap-2 text-xs" data-ovl-inspector={el.id} key={`${el.id}/${part ?? ""}`}>
      <div className="font-semibold text-zinc-400">{m.properties}</div>
      {el.type === "svgAsset" && parts.length > 0 && (
        <label className="flex items-center gap-1">
          <span className="text-zinc-400">{m.part}</span>
          <select className={input} value={part ?? ""} onChange={(e) => setPart({ element: el.id, part: e.target.value || undefined })}>
            <option value="">{m.element}</option>
            {parts.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
      )}
      {part === undefined && (
        <label className="flex items-center gap-1">
          <span className={onInvalidOverridden ? "text-amber-400" : "text-zinc-400"}>{m.onInvalid}</span>
          <select
            className={input}
            value={el.onInvalid}
            onChange={(e) => store.dispatch({ type: "setAttribute", element: el.id, name: "onInvalid", value: e.target.value === "hold" && !inVariant ? undefined : e.target.value })}
          >
            <option value="hold">{m.onInvalidValues.hold}</option>
            <option value="hide">{m.onInvalidValues.hide}</option>
          </select>
          {onInvalidOverridden && <button className={btn} title={m.reset} onClick={() => store.dispatch({ type: "resetOverride", element: el.id, attribute: "onInvalid", variant: scope! })}>↺</button>}
        </label>
      )}
      {el.type === "lidarWidget" && part === undefined && <LidarSource ctx={ctx} />}
      {sections(el, part).map((s) => (
        <div key={s.key} className="flex flex-col gap-1" data-ovl-section={s.key}>
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">{m.section[s.key]}</div>
          {s.names.map((name) => {
            const row = inspectProperty(store, { element: el.id, part, property: name });
            return row ? <PropertyRowView key={name} row={row} ctx={ctx} /> : null;
          })}
        </div>
      ))}
    </div>
  );
}

function LidarSource({ ctx }: { ctx: RowContext }) {
  const { el, m, dir, store } = ctx;
  const options = lidarChannels(dir);
  const info = el.source ? channelInfo(dir, el.source) : undefined;
  return (
    <div className="flex flex-col gap-0.5" data-ovl-lidar-source={el.source ?? ""}>
      <label className="flex items-center gap-1">
        <span className="text-zinc-400 shrink-0">{m.lidarSource}</span>
        <select className={input} value={el.source ?? ""} onChange={(e) => store.dispatch(lidarSourceCommand(el.id, e.target.value))}>
          <option value="">{m.lidarSourceNone}</option>
          {el.source && !options.some((o) => o.name === el.source) && <option value={el.source}>{el.source}</option>}
          {options.map((o) => <option key={o.name} value={o.name}>{o.name}</option>)}
        </select>
      </label>
      {info?.zoneLimitsMm && <span className="text-[11px] text-zinc-500">{m.lidarZones(info.zoneLimitsMm.map((v) => `${v / 1000} m`).join(" / "))}</span>}
      <span className="text-[11px] text-zinc-500">{m.lidarSourceHint}</span>
    </div>
  );
}

function originClass(row: PropertyRow) {
  if (row.overridden) return "text-amber-400";
  if (row.inherited) return "text-zinc-500";
  return row.origin === "default" ? "text-zinc-400" : "text-zinc-200";
}

function dispatchValue(ctx: RowContext, row: PropertyRow, text: string | boolean) {
  const parsed = parseLiteral(row.def, text);
  if (!parsed.ok) return false;
  ctx.store.dispatch(staticCommand(row, parsed.value), { mergeKey: mergeKey(row, "value") });
  return true;
}

function PropertyRowView({ row, ctx }: { row: PropertyRow; ctx: RowContext }) {
  const { store, m } = ctx;
  const scope = store.getState().activeVariant;
  const reset = resetCommand(row, scope);
  const setMode = (mode: ControlMode) => {
    const clip = ctx.activeClip !== undefined && store.effective().clips[ctx.activeClip] ? ctx.activeClip : undefined;
    const r = applyMode(store, row, mode, { clip }, `${row.property}: ${m.modes[mode]}`);
    if (r.ok && r.clip) ctx.onOpenClip?.(r.clip);
  };
  const title = row.overridden ? m.overridden : row.inherited ? m.inherited : row.origin === "default" ? m.isDefault : undefined;
  return (
    <div className="flex flex-col gap-0.5 border-b border-zinc-800/60 pb-1" data-ovl-prop={row.property} data-ovl-mode={row.mode}>
      <div className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-1">
        <span className={`truncate ${originClass(row)}`} title={title ? `${row.property} – ${title}` : row.property}>{row.property}</span>
        {row.modes.length > 1 ? (
          <select className={input} value={row.mode} title={m.mode} onChange={(e) => setMode(e.target.value as ControlMode)}>
            {row.modes.map((mode) => <option key={mode} value={mode}>{m.modes[mode]}</option>)}
          </select>
        ) : <StaticEditor row={row} ctx={ctx} />}
        {reset ? (
          <button className={btn} title={row.overridden ? m.reset : m.resetToDefault} onClick={() => store.dispatch(reset)}>↺</button>
        ) : <span />}
      </div>
      {row.modes.length > 1 && (
        <div className="pl-2 flex flex-col gap-0.5">
          {row.mode === "static" && <StaticEditor row={row} ctx={ctx} />}
          {row.mode === "binding" && <BindingEditor row={row} ctx={ctx} />}
          {row.mode === "rate" && <RateEditor row={row} ctx={ctx} />}
          {row.mode === "clip" && (
            <div className="flex items-center gap-1 text-[11px] text-sky-300">
              <span className="flex-1">{m.clipDriven(row.clips.map((c) => store.effective().clips[c]?.name ?? c).join(", "))}</span>
              {ctx.onOpenClip && <button className={btn} onClick={() => ctx.onOpenClip!(row.clips[0])}>{m.openClip}</button>}
            </div>
          )}
          {(row.mode === "binding" || row.mode === "rate" || row.mode === "clip") && (
            <label className="grid grid-cols-[5rem_1fr] items-center gap-1" title={m.baseHint}>
              <span className="text-zinc-500">{m.base}</span>
              <StaticEditor row={row} ctx={ctx} />
            </label>
          )}
        </div>
      )}
      {row.conflict && <span className="text-[11px] text-red-400">{m.conflict}</span>}
      {row.diagnostics.map((d, i) => (
        <span key={i} className={`text-[11px] ${d.severity === "error" ? "text-red-400" : "text-amber-400"}`} data-ovl-diagnostic={d.code}>{d.code}: {d.message}</span>
      ))}
    </div>
  );
}

function placeholderOf(row: PropertyRow, ctx: RowContext): string | undefined {
  const d = row.def.default;
  if (row.value !== undefined) return undefined;
  if (d === "fromSource") {
    const dep = valueSourceDependency(ctx);
    const defaults = valueTextSourceDefaults(ctx.el, ctx.dir, ctx.signals, dep);
    const v = row.property === "unit" ? defaults.unit : defaults.decimals;
    return ctx.m.fromSource(v === undefined || v === null ? "" : String(v));
  }
  if (d === "fromAsset") return ctx.m.fromAsset;
  if (d === "center") return ctx.m.center;
  return d === null || d === undefined ? undefined : String(d);
}

function valueSourceDependency(ctx: RowContext) {
  const v = ctx.el.props.value;
  const expr = typeof v === "object" && v !== null ? v.binding?.expr : undefined;
  // Same rule as the runtime: the first dependency of the value formula.
  return expr ? checkFormula(expr, ctx.env, "any").analysis.dependencies[0] : undefined;
}

/** Static value (or base) editor by kind. */
function StaticEditor({ row, ctx }: { row: PropertyRow; ctx: RowContext }) {
  const { m } = ctx;
  const [error, setError] = useState<string | undefined>();
  const kind = row.kind;
  const explicit = row.value !== undefined;
  const base = row.base;
  const key = `${row.element}/${row.part ?? ""}/${row.property}/${ctx.store.getState().version}`;
  if (kind.valueType === "boolean") {
    return <input type="checkbox" checked={base === true} onChange={(e) => dispatchValue(ctx, row, e.target.checked)} />;
  }
  if (row.def.values) {
    return (
      <select className={input} value={String(base)} onChange={(e) => dispatchValue(ctx, row, e.target.value)}>
        {row.def.values.map((v) => <option key={String(v)} value={String(v)}>{String(v)}</option>)}
      </select>
    );
  }
  const commit = (text: string) => {
    const parsed = parseLiteral(row.def, text);
    if (!parsed.ok) { setError(m.invalidInput[parsed.problem]); return; }
    setError(undefined);
    if (parsed.value === undefined && !explicit) return;
    ctx.store.dispatch(staticCommand(row, parsed.value), { mergeKey: mergeKey(row, "value") });
  };
  const isColor = kind.format === "color";
  const shown = explicit || (typeof base !== "string" || !["fromSource", "fromAsset", "center"].includes(base)) ? (base === null ? "" : String(base)) : "";
  return (
    <span className="flex items-center gap-1 min-w-0">
      {isColor && typeof base === "string" && /^#[0-9a-fA-F]{6}/.test(base) && (
        <input
          type="color"
          className="h-5 w-6 shrink-0 bg-transparent"
          value={base.slice(0, 7)}
          onChange={(e) => commit(e.target.value + (base.length === 9 ? base.slice(7) : ""))}
        />
      )}
      <input
        className={`${input} ${error ? "border-red-700" : ""}`}
        key={key}
        defaultValue={shown}
        placeholder={placeholderOf(row, ctx)}
        title={error}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") commit((e.target as HTMLInputElement).value); }}
        onBlur={(e) => commit(e.target.value)}
      />
    </span>
  );
}

function BindingEditor({ row, ctx }: { row: PropertyRow; ctx: RowContext }) {
  const { m, store } = ctx;
  const expr = row.binding?.expr ?? "";
  const [formula, setFormula] = useState(() => expr !== "" && !simpleSource(expr));
  const commit = (next: string) => {
    const cmd = exprCommand(row, next);
    if (cmd) store.dispatch(cmd, { mergeKey: mergeKey(row, "expr") });
  };
  const tau = row.binding?.smoothing?.timeConstantS;
  const hasChannels = !!ctx.dir.telemetry || !!ctx.dir.outputs || Object.keys(ctx.signals).length > 0;
  const showFormula = formula || !hasChannels;
  return (
    <div className="flex flex-col gap-0.5">
      {!showFormula && (
        <div className="flex items-center gap-1">
          <ChannelPicker expr={expr} expected={row.def.kind} dir={ctx.dir} signals={ctx.signals} m={m} onPick={commit} />
          <button className={btn} title={m.editFormula} onClick={() => setFormula(true)}>ƒ</button>
        </div>
      )}
      {showFormula && (
        <div className="flex flex-col gap-0.5">
          <FormulaField value={expr} expected={row.def.kind} env={ctx.env} source={ctx.source} locale={ctx.locale} def={row.def} m={m} onCommit={commit} testId={row.property} />
          {hasChannels && <button className={`${btn} self-start`} onClick={() => setFormula(false)}>{m.simpleBinding}</button>}
        </div>
      )}
      {!showFormula && expr !== "" && (
        <FormulaPreview row={row} ctx={ctx} expr={expr} />
      )}
      <label className="flex items-center gap-1" title={row.def.kind === "angle" ? m.angleShortest : undefined}>
        <input
          type="checkbox"
          checked={tau !== undefined}
          onChange={(e) => { const c = smoothingCommand(row, e.target.checked ? 0.25 : undefined); if (c) store.dispatch(c); }}
        />
        <span>{m.smoothing}</span>
        {tau !== undefined && (
          <NumberField value={tau} onCommit={(v) => { const c = smoothingCommand(row, v); if (c) store.dispatch(c, { mergeKey: mergeKey(row, "smoothing") }); }} title={m.timeConstant} />
        )}
      </label>
    </div>
  );
}

/** Check and live value of a simple binding (the formula itself is not shown). */
function FormulaPreview({ row, ctx, expr }: { row: PropertyRow; ctx: RowContext; expr: string }) {
  const check = useMemo(() => checkFormula(expr, ctx.env, row.def.kind), [expr, ctx.env, row.def.kind]);
  const live = useLiveValue(check, ctx.source, ctx.locale, row.def);
  const d = check.diagnostic;
  return (
    <div data-ovl-simple-binding={expr}>
      {d ? <span className="text-[11px] text-amber-400" data-ovl-diagnostic={d.code}>{d.code}: {d.message}</span> : <LiveBadge live={live} m={ctx.m} />}
    </div>
  );
}

function RateEditor({ row, ctx }: { row: PropertyRow; ctx: RowContext }) {
  const { m, store } = ctx;
  const rate = row.rate!;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] text-zinc-500">{m.rateHint}</span>
      <FormulaField
        value={rate.expr}
        expected="number"
        env={ctx.env}
        source={ctx.source}
        locale={ctx.locale}
        m={m}
        onCommit={(next) => store.dispatch(rateCommand(row, { ...rate, expr: next }), { mergeKey: mergeKey(row, "expr") })}
        testId={row.property}
      />
      <label className="flex items-center gap-1">
        <input
          type="checkbox"
          checked={!!rate.wrap}
          onChange={(e) => {
            const c = wrapCommand(row, e.target.checked ? (row.def.kind === "angle" ? { min: 0, max: 360 } : { min: 0, max: 100 }) : undefined);
            if (c) store.dispatch(c);
          }}
        />
        <span>{m.wrap}</span>
        {rate.wrap && (
          <>
            <NumberField value={rate.wrap.min} title={m.min} onCommit={(v) => { const c = wrapCommand(row, { ...rate.wrap!, min: v }); if (c) store.dispatch(c, { mergeKey: mergeKey(row, "wrap") }); }} />
            <NumberField value={rate.wrap.max} title={m.max} onCommit={(v) => { const c = wrapCommand(row, { ...rate.wrap!, max: v }); if (c) store.dispatch(c, { mergeKey: mergeKey(row, "wrap") }); }} />
          </>
        )}
      </label>
    </div>
  );
}

export function NumberField({ value, onCommit, title, className }: { value: number; onCommit(v: number): void; title?: string; className?: string }) {
  const commit = (text: string) => {
    const v = Number(text.replace(",", "."));
    if (Number.isFinite(v) && v !== value) onCommit(v);
  };
  return (
    <input
      className={`${input} ${className ?? "w-16"}`}
      key={value}
      defaultValue={String(value)}
      title={title}
      placeholder={title}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") commit((e.target as HTMLInputElement).value); }}
      onBlur={(e) => commit(e.target.value)}
    />
  );
}
