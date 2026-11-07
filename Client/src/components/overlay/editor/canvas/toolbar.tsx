"use client";
// Toolbar: undo/redo, insert, group, duplicate, delete, align/distribute, zoom and grid.
import React from "react";
import type { ElementType } from "../../document/types";
import type { EditorStore } from "../core/store";
import { align, distribute, duplicateSelection, groupSelection, insertElement, ungroupSelection } from "./actions";
import { useEditorState } from "./hooks";
import type { EditorMessages } from "./messages";

const btn = "px-2 py-0.5 rounded text-xs border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 disabled:opacity-40";
const INSERTABLE: ElementType[] = ["rect", "ellipse", "line", "arc", "text", "valueText", "linearGauge", "radialGauge", "group", "lidarWidget", "videoStream"];

export function Toolbar({ store, m, onDelete, onFit, streams = [] }: { store: EditorStore; m: EditorMessages; onDelete: () => void; onFit: () => void; streams?: { streamId: string }[] }) {
  const state = useEditorState(store);
  const config = store.effective();
  const sel = state.selection;
  const hasGroup = sel.some((id) => config.elements[id]?.type === "group");
  const zoom = (f: number) => store.setView({ zoom: Math.min(16, Math.max(0.05, state.view.zoom * f)) });
  const sep = <span className="w-px h-4 bg-zinc-700 mx-1" />;
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs" data-ovl-toolbar="">
      <button className={btn} disabled={!state.history.canUndo} title={state.history.undoLabel} onClick={() => store.undo()}>↶ {m.undo}</button>
      <button className={btn} disabled={!state.history.canRedo} title={state.history.redoLabel} onClick={() => store.redo()}>↷ {m.redo}</button>
      {sep}
      <select className={btn} value="" onChange={(e) => { if (e.target.value) insertElement(store, e.target.value as ElementType, { stream: pipStream(streams, state.activeVariant) }); }}>
        <option value="">{m.add} …</option>
        {INSERTABLE.map((t) => <option key={t} value={t}>{m.types[t]}</option>)}
      </select>
      <button className={btn} disabled={sel.length === 0} onClick={() => groupSelection(store)}>{m.group}</button>
      <button className={btn} disabled={!hasGroup} onClick={() => ungroupSelection(store)}>{m.ungroup}</button>
      <button className={btn} disabled={sel.length === 0} onClick={() => duplicateSelection(store)}>{m.duplicate}</button>
      <button className={btn} disabled={sel.length === 0} onClick={onDelete}>{m.delete}</button>
      {sep}
      {(["left", "centerX", "right", "top", "centerY", "bottom"] as const).map((a) => (
        <button key={a} className={btn} disabled={sel.length === 0} title={m.align[a]} onClick={() => align(store, a)}>
          {{ left: "⇤", centerX: "↔", right: "⇥", top: "⤒", centerY: "↕", bottom: "⤓" }[a]}
        </button>
      ))}
      <button className={btn} disabled={sel.length < 3} title={m.distributeX} onClick={() => distribute(store, "x")}>⋯</button>
      <button className={btn} disabled={sel.length < 3} title={m.distributeY} onClick={() => distribute(store, "y")}>⋮</button>
      {sep}
      <button className={btn} title={m.zoomOut} onClick={() => zoom(1 / 1.25)}>−</button>
      <button className={btn} title={m.zoomFit} onClick={onFit}>{m.zoomFit}</button>
      <button className={btn} title={m.zoomIn} onClick={() => zoom(1.25)}>+</button>
      {sep}
      <label className="flex items-center gap-1 text-zinc-300">
        <input type="checkbox" checked={state.view.grid.enabled} onChange={(e) => store.setView({ grid: { ...state.view.grid, enabled: e.target.checked } })} />{m.grid}
      </label>
      <input
        className="w-12 bg-zinc-800 text-zinc-100 border border-zinc-700 rounded px-1 py-0.5"
        type="number" min={1} title={m.gridSize} value={state.view.grid.size}
        onKeyDown={(e) => e.stopPropagation()}
        onChange={(e) => { const v = Number(e.target.value); if (v > 0) store.setView({ grid: { ...state.view.grid, size: v } }); }}
      />
      <label className="flex items-center gap-1 text-zinc-300">
        <input type="checkbox" checked={state.view.grid.snap} onChange={(e) => store.setView({ grid: { ...state.view.grid, snap: e.target.checked } })} />{m.snap}
      </label>
    </div>
  );
}

/** Default stream of a new picture-in-picture: another stream than the variant being edited, if there is one. */
function pipStream(streams: { streamId: string }[], activeVariant: string | null): string | undefined {
  return (streams.find((s) => s.streamId !== activeVariant) ?? streams[0])?.streamId;
}
