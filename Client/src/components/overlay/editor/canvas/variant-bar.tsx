"use client";
// Scope selection (standard / stream variants), variant lifecycle (D22, D53)
// and workspace changes (D04, D39).
import React, { useState } from "react";
import type { EditorStore } from "../core/store";
import type { PackageSource } from "../persistence/backup";
import { useEditorState } from "./hooks";
import type { EditorMessages } from "./messages";

const btn = "px-2 py-0.5 rounded text-xs border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 disabled:opacity-40";
const tab = (active: boolean) => `px-2 py-0.5 rounded-t text-xs border-b-2 ${active ? "border-sky-400 text-sky-200" : "border-transparent text-zinc-400 hover:text-zinc-200"}`;

export type StreamInfo = PackageSource["streams"][number];

export function VariantBar({ store, m, streams }: { store: EditorStore; m: EditorMessages; streams: StreamInfo[] }) {
  const state = useEditorState(store);
  const doc = state.document;
  const variants = doc.variants ?? {};
  const [pending, setPending] = useState<string | null>(null);
  const known = new Set(streams.map((s) => s.streamId));
  const orphaned = Object.keys(variants).filter((id) => !known.has(id)).sort();
  const active = state.activeVariant;
  const shownTab = pending ?? active;
  const variant = active !== null ? variants[active] : undefined;
  const ws = store.effective().workspace;
  const [w, setW] = useState("");
  const [h, setH] = useState("");

  const choose = (id: string | null) => {
    if (id === null || variants[id]) {
      setPending(null);
      store.setActiveVariant(id);
    } else {
      setPending(id);
      store.setActiveVariant(null);
    }
  };

  const create = (streamId: string) => {
    const s = streams.find((x) => x.streamId === streamId);
    const workspace = s?.width && s?.height ? { width: s.width, height: s.height } : undefined;
    const sameAsStandard = workspace && workspace.width === doc.workspace.width && workspace.height === doc.workspace.height;
    if (store.dispatch({ type: "setVariant", streamId, settings: workspace && !sameAsStandard ? { workspace } : {} }).ok) {
      setPending(null);
      store.setActiveVariant(streamId);
    }
  };

  const setWorkspace = (mode: "areaOnly" | "fitContent") => {
    const width = Number(w || ws.width);
    const height = Number(h || ws.height);
    if (width > 0 && height > 0) store.dispatch({ type: "setWorkspace", width, height, mode });
    setW("");
    setH("");
  };

  const free = streams.filter((s) => !variants[s.streamId]);

  return (
    <div className="flex flex-col gap-1 text-xs" data-ovl-variants="">
      <div className="flex flex-wrap items-end gap-1 border-b border-zinc-800">
        <button className={tab(shownTab === null)} onClick={() => choose(null)}>{m.standard}</button>
        {streams.map((s) => (
          <button key={s.streamId} className={tab(shownTab === s.streamId)} onClick={() => choose(s.streamId)}>
            {s.name ?? s.streamId}
            {variants[s.streamId] ? (variants[s.streamId].disabled ? " ⊘" : " ●") : ""}
          </button>
        ))}
        {orphaned.map((id) => (
          <button key={id} className={tab(shownTab === id)} onClick={() => choose(id)} title={m.orphaned}>
            {id} <span className="text-amber-400">({m.orphaned})</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {pending !== null && (
          <>
            <span className="text-zinc-400">{m.inherited}</span>
            <button className={btn} onClick={() => create(pending)}>{m.createVariant}</button>
          </>
        )}
        {active === null && pending === null && (
          <label className="flex items-center gap-1 text-zinc-300">
            <input type="checkbox" checked={doc.disabled === true} onChange={(e) => store.dispatch({ type: "setOverlayDisabled", disabled: e.target.checked })} />
            {m.overlayDisabled}
          </label>
        )}
        {active !== null && variant && (
          <>
            <label className="flex items-center gap-1 text-zinc-300">
              <input type="checkbox" checked={variant.disabled === true} onChange={(e) => store.dispatch({ type: "setVariant", streamId: active, settings: { disabled: e.target.checked } })} />
              {m.variantDisabled}
            </label>
            {orphaned.includes(active) && free.length > 0 && (
              <select className={btn} value="" onChange={(e) => {
                const to = e.target.value;
                if (to && store.dispatch({ type: "reassignVariant", from: active, to }).ok) store.setActiveVariant(to);
              }}>
                <option value="">{m.reassign} …</option>
                {free.map((s) => <option key={s.streamId} value={s.streamId}>{s.name ?? s.streamId}</option>)}
              </select>
            )}
            <button className={btn} onClick={() => { if (window.confirm(m.removeVariantConfirm(active))) store.dispatch({ type: "removeVariant", streamId: active }); }}>
              {m.removeVariant}
            </button>
          </>
        )}
        {pending === null && (
          <span className="flex items-center gap-1 text-zinc-300">
            {m.workspace}
            <input className="w-16 bg-zinc-800 border border-zinc-700 rounded px-1" placeholder={String(ws.width)} value={w} onChange={(e) => setW(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
            ×
            <input className="w-16 bg-zinc-800 border border-zinc-700 rounded px-1" placeholder={String(ws.height)} value={h} onChange={(e) => setH(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
            <button className={btn} disabled={!w && !h} onClick={() => setWorkspace("areaOnly")}>{m.areaOnly}</button>
            <button className={btn} disabled={!w && !h} onClick={() => setWorkspace("fitContent")}>{m.fitContent}</button>
            {(active === null ? doc.rootTransform : variant?.rootTransform) && (
              <button className={btn} title="rootTransform" onClick={() => store.dispatch({ type: "setRootTransform", rootTransform: undefined })}>↺ rootTransform</button>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
