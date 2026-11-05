import React, { useMemo, useRef } from "react";
import { useI18n } from "@/i18n/provider";
import type { TelemetryDataType } from "@/components/overlay/expression/analyze";
import { compile, newId, PALETTE } from "./series";
import type { HistoryChannel, PanelDef, SeriesDef } from "./types";

const inputClass = "bg-zinc-800 text-zinc-100 border border-zinc-700 rounded px-2 py-1 text-xs";
const btnGhost = "px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-xs border border-zinc-700";

interface Props {
  panel: PanelDef;
  channels: HistoryChannel[];
  telemetry: Record<string, TelemetryDataType>;
  onChange: (panel: PanelDef) => void;
  onRemove: () => void;
}

/** Edits the title, height and formula lines of one chart. */
export default function PanelEditor({ panel, channels, telemetry, onChange, onRemove }: Props) {
  const t = useI18n().messages.telemetryHistory;
  const update = (patch: Partial<PanelDef>) => onChange({ ...panel, ...patch });
  const updateSeries = (id: string, patch: Partial<SeriesDef>) =>
    update({ series: panel.series.map(s => (s.id === id ? { ...s, ...patch } : s)) });

  const addSeries = () => update({
    series: [...panel.series, {
      id: newId("s"),
      label: `${t.formula} ${panel.series.length + 1}`,
      expr: channels[0] ? `tel("${channels[0].name}")` : "0",
      color: PALETTE[panel.series.length % PALETTE.length],
    }],
  });

  return (
    <div className="border border-dashed border-zinc-700 rounded p-2 mb-2 space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-zinc-400">{t.panelTitle}
          <input className={inputClass + " w-64"} value={panel.title} onChange={e => update({ title: e.target.value })} />
        </label>
        <label className="flex items-center gap-1 text-zinc-400">{t.height}
          <input type="number" min={120} max={800} step={20} className={inputClass + " w-20"} value={panel.height ?? 220}
            onChange={e => update({ height: Math.max(120, Math.min(800, Number(e.target.value) || 220)) })} />
        </label>
        <button className={btnGhost + " ml-auto text-red-300"} onClick={onRemove}>{t.removePanel}</button>
      </div>
      {panel.series.map(s => (
        <SeriesRow key={s.id} series={s} channels={channels} telemetry={telemetry}
          onChange={patch => updateSeries(s.id, patch)}
          onRemove={() => update({ series: panel.series.filter(x => x.id !== s.id) })} />
      ))}
      <div className="flex items-center gap-2">
        <button className={btnGhost} onClick={addSeries}>+ {t.addSeries}</button>
        <span className="text-zinc-500">{t.formulaHint}</span>
      </div>
    </div>
  );
}

function SeriesRow({ series, channels, telemetry, onChange, onRemove }: {
  series: SeriesDef;
  channels: HistoryChannel[];
  telemetry: Record<string, TelemetryDataType>;
  onChange: (patch: Partial<SeriesDef>) => void;
  onRemove: () => void;
}) {
  const t = useI18n().messages.telemetryHistory;
  const exprRef = useRef<HTMLInputElement>(null);
  const error = useMemo(() => compile(series.expr, telemetry).error, [series.expr, telemetry]);

  const insert = (name: string) => {
    const el = exprRef.current;
    const text = `tel("${name}")`;
    const start = el?.selectionStart ?? series.expr.length;
    const end = el?.selectionEnd ?? series.expr.length;
    onChange({ expr: series.expr.slice(0, start) + text + series.expr.slice(end) });
  };

  return (
    <div className="flex flex-wrap items-start gap-2">
      <input type="color" title={t.color} className="h-6 w-8 bg-transparent" value={series.color} onChange={e => onChange({ color: e.target.value })} />
      <input className={inputClass + " w-36"} placeholder={t.label} value={series.label} onChange={e => onChange({ label: e.target.value })} />
      <div className="flex-1 min-w-[16rem]">
        <input ref={exprRef} spellCheck={false}
          className={`${inputClass} w-full font-mono ${error ? "border-red-500" : ""}`}
          placeholder={t.formula} value={series.expr} onChange={e => onChange({ expr: e.target.value })} />
        {error && <div className="text-red-300 mt-0.5">{error}</div>}
      </div>
      <select className={inputClass} value="" onChange={e => { if (e.target.value) insert(e.target.value); }}>
        <option value="">{t.insertChannel}</option>
        {channels.map(c => <option key={c.id} value={c.name}>{c.name}{c.unit ? ` [${c.unit}]` : ""}</option>)}
      </select>
      <input className={inputClass + " w-16"} placeholder={t.unit} value={series.unit ?? ""} onChange={e => onChange({ unit: e.target.value || undefined })} />
      <input type="number" min={0} max={6} className={inputClass + " w-14"} title={t.decimals} placeholder={t.decimals}
        value={series.decimals ?? ""} onChange={e => onChange({ decimals: e.target.value === "" ? undefined : Math.max(0, Math.min(6, Number(e.target.value))) })} />
      <button className={btnGhost + " text-red-300"} onClick={onRemove}>{t.removeSeries}</button>
    </div>
  );
}
