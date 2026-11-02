"use client";
// AP12 – choose a template, map its channels and conversions, preview with
// base values (no invented measurements) and insert via editor commands.
import React, { useMemo, useState } from "react";
import { effectiveConfig } from "../document/resolve";
import type { OverlayDocument } from "../document/types";
import type { EditorStore } from "../editor/core/store";
import { OverlayRenderer } from "../runtime/overlay-renderer";
import type { Locale } from "../runtime/types";
import { suggestConversion } from "./conversions";
import { checkMapping, insertTemplate, instantiate, paramValues, type ChannelOption } from "./instantiate";
import { TEMPLATES } from "./library";
import { templateMessages } from "./messages";
import type { Conversion, ParamValue, TemplateDefinition, TemplateMapping, TemplateSlot } from "./types";

const btn = "px-2 py-0.5 rounded text-xs border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 disabled:opacity-40";
const input = "bg-zinc-900 border border-zinc-700 rounded px-1 py-0.5 text-xs text-zinc-100";

export interface TemplateInserterProps {
  store: EditorStore;
  locale: Locale;
  /** Channels of the vehicle (AP05 catalog, GET …/overlay/sources). */
  channels: ChannelOption[];
  /** Opens the form of this template directly. */
  initialTemplate?: string;
}

const fits = (slot: TemplateSlot, c: ChannelOption) => (slot.kind === "lidarGrid" ? c.dataType === "LidarGrid" : c.dataType === "Integer" || c.dataType === "Number");

function presetId(slot: TemplateSlot, c: Conversion | undefined): string {
  if (!c) return slot.presets?.[0]?.id ?? "custom";
  return slot.presets?.find((p) => p.factor === c.factor && p.offset === c.offset)?.id ?? "custom";
}

/** Start mapping: only an unambiguous channel is preselected, with the conversion its unit suggests. */
function initialMapping(d: TemplateDefinition, channels: ChannelOption[]): TemplateMapping {
  const slots: TemplateMapping["slots"] = {};
  for (const s of d.slots) {
    const options = channels.filter((c) => fits(s, c));
    if (options.length === 1) slots[s.id] = { channel: options[0].name, conversion: suggestConversion(s, options[0].unit) };
  }
  return { slots, params: paramValues(d) };
}

export function TemplateInserter({ store, locale, channels, initialTemplate }: TemplateInserterProps) {
  const m = templateMessages[locale] ?? templateMessages.de;
  const initial = TEMPLATES.find((t) => t.id === initialTemplate) ?? null;
  const [def, setDef] = useState<TemplateDefinition | null>(initial);
  const [mapping, setMapping] = useState<TemplateMapping>(() => (initial ? initialMapping(initial, channels) : { slots: {} }));
  const [error, setError] = useState<string | null>(null);

  const choose = (d: TemplateDefinition) => {
    setDef(d);
    setMapping(initialMapping(d, channels));
    setError(null);
  };

  const issues = def ? checkMapping(def, mapping, channels) : [];
  const preview = useMemo(() => {
    if (!def || issues.length > 0) return null;
    const inst = instantiate(def, mapping, { locale });
    const doc: OverlayDocument = { schemaVersion: 1, workspace: { width: def.size.width, height: def.size.height }, elements: inst.elements, children: [inst.root], clips: inst.clips };
    return effectiveConfig(doc, null);
  }, [def, mapping, issues.length, locale]);

  const setSlot = (slot: TemplateSlot, channel: string) => {
    const unit = channels.find((c) => c.name === channel)?.unit;
    setMapping({ ...mapping, slots: { ...mapping.slots, [slot.id]: channel ? { channel, conversion: suggestConversion(slot, unit) } : undefined } });
  };
  const setConversion = (slot: TemplateSlot, conversion: Conversion) => {
    const a = mapping.slots[slot.id];
    if (a) setMapping({ ...mapping, slots: { ...mapping.slots, [slot.id]: { ...a, conversion } } });
  };
  const setParam = (id: string, value: ParamValue) => setMapping({ ...mapping, params: { ...mapping.params, [id]: value } });

  if (!def) {
    return (
      <div className="flex flex-col gap-1 text-xs" data-ovl-templates>
        <strong className="text-zinc-300">{m.title}</strong>
        {TEMPLATES.map((t) => (
          <button key={t.id} className={`${btn} text-left`} title={t.description[locale]} onClick={() => choose(t)} data-ovl-template={t.id}>{t.name[locale]}</button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 text-xs" data-ovl-template-form={def.id}>
      <strong className="text-zinc-200">{def.name[locale]}</strong>
      <span className="text-zinc-400">{def.description[locale]}</span>
      {def.slots.map((slot) => {
        const options = channels.filter((c) => fits(slot, c));
        const a = mapping.slots[slot.id];
        const pid = presetId(slot, a?.conversion);
        return (
          <fieldset key={slot.id} className="flex flex-col gap-1 border border-zinc-800 rounded p-1" data-ovl-slot={slot.id}>
            <legend className="text-zinc-300">{slot.label[locale]}</legend>
            {options.length === 0 && <span className="text-amber-300">{m.noChannels}</span>}
            <select className={input} value={a?.channel ?? ""} onChange={(e) => setSlot(slot, e.target.value)} aria-label={m.channel}>
              <option value="">{m.none}</option>
              {options.map((c) => <option key={c.name} value={c.name}>{c.name}{c.unit ? ` (${c.unit})` : ""}</option>)}
            </select>
            {slot.kind === "number" && a && (
              <>
                <label className="flex items-center gap-1">
                  {m.conversion}
                  <select
                    className={input}
                    value={pid}
                    onChange={(e) => {
                      const p = slot.presets?.find((x) => x.id === e.target.value);
                      setConversion(slot, p ? { factor: p.factor, offset: p.offset } : { ...(a.conversion ?? { factor: 1, offset: 0 }) });
                    }}
                  >
                    {(slot.presets ?? []).map((p) => <option key={p.id} value={p.id}>{p.label[locale]}</option>)}
                    <option value="custom">{m.custom}</option>
                  </select>
                </label>
                {pid === "custom" && (
                  <span className="flex items-center gap-1">
                    {m.factor}
                    <input className={`${input} w-20`} type="number" step="any" value={a.conversion?.factor ?? 1}
                      onChange={(e) => setConversion(slot, { factor: Number(e.target.value), offset: a.conversion?.offset ?? 0 })} />
                    {m.offset}
                    <input className={`${input} w-20`} type="number" step="any" value={a.conversion?.offset ?? 0}
                      onChange={(e) => setConversion(slot, { factor: a.conversion?.factor ?? 1, offset: Number(e.target.value) })} />
                  </span>
                )}
              </>
            )}
          </fieldset>
        );
      })}
      {def.params.length > 0 && (
        <fieldset className="flex flex-col gap-1 border border-zinc-800 rounded p-1">
          <legend className="text-zinc-300">{m.params}</legend>
          {def.params.map((p) => {
            const v = paramValues(def, mapping.params)[p.id];
            return (
              <label key={p.id} className="flex items-center justify-between gap-1">
                {p.label[locale]}
                {p.type === "bool" ? (
                  <input type="checkbox" checked={v === true} onChange={(e) => setParam(p.id, e.target.checked)} />
                ) : p.type === "choice" ? (
                  <select className={input} value={String(v)} onChange={(e) => setParam(p.id, Number(e.target.value))}>
                    {p.values.map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                ) : (
                  <input className={`${input} w-20`} type="number" step="any" min={p.min} max={p.max} value={String(v)} onChange={(e) => setParam(p.id, Number(e.target.value))} />
                )}
              </label>
            );
          })}
        </fieldset>
      )}
      {issues.length > 0 && <span className="text-amber-300">{m.issue(issues[0])}</span>}
      {preview && (
        <div>
          <span className="text-zinc-400">{m.preview}</span>
          <OverlayRenderer config={preview} mode="design" locale={locale} className="w-full max-h-48 bg-zinc-900 border border-zinc-800" idPrefix="ovl-tpl-" />
        </div>
      )}
      {error && <span className="text-red-300">{error}</span>}
      <span className="text-zinc-500">{m.hint}</span>
      <div className="flex gap-2 justify-end">
        <button className={btn} onClick={() => setDef(null)}>{m.cancel}</button>
        <button
          className={btn}
          disabled={issues.length > 0}
          onClick={() => {
            const r = insertTemplate(store, def, mapping, channels, { locale });
            if (r.ok) setDef(null);
            else setError(r.error.message);
          }}
          data-ovl-template-insert
        >{m.insert}</button>
      </div>
    </div>
  );
}
