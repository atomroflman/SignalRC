"use client";
// Layers panel (tree, lock/hide, order, inheritance markers) and the numeric
// transform panel with inherited/overridden indicators and reset (variants).
import React, { useState } from "react";
import { ROOT, type EffectiveElement } from "../../document/types";
import { staticProps } from "../core/geometry";
import type { EditorStore } from "../core/store";
import { withBase } from "../core/commands";
import { arrangeCommand } from "../core/tools";
import type { AttributeName } from "../core/types";
import { useEditorState } from "./hooks";
import type { EditorMessages } from "./messages";

const btn = "px-1.5 py-0.5 rounded text-[11px] border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 disabled:opacity-40";
const input = "w-full bg-zinc-800 text-zinc-100 border border-zinc-700 rounded px-1 py-0.5 text-xs";

/** Boolean attribute: explicit false where a default or the standard would differ. */
export function setFlag(store: EditorStore, el: EffectiveElement, name: AttributeName, value: boolean) {
  const explicit = name === "lockAspect" || (store.getState().activeVariant !== null && el.origin === "standard");
  store.dispatch({ type: "setAttribute", element: el.id, name, value: value ? true : explicit ? false : undefined });
}

function label(el: EffectiveElement, m: EditorMessages) {
  return el.name ?? `${m.types[el.type]} ${el.id}`;
}

export function LayersPanel({ store, m }: { store: EditorStore; m: EditorMessages }) {
  const state = useEditorState(store);
  const config = store.effective();
  const variant = state.activeVariant !== null ? state.document.variants?.[state.activeVariant] : undefined;
  const [dragId, setDragId] = useState<string | null>(null);

  const toggle = (el: EffectiveElement, name: AttributeName, value: boolean) => setFlag(store, el, name, value);

  const onDrop = (target: EffectiveElement, e: React.DragEvent) => {
    e.preventDefault();
    if (!dragId || dragId === target.id) return;
    if (target.type === "group" && e.altKey) {
      store.dispatch({ type: "reparent", ids: [dragId], container: target.id, keepPosition: true });
    } else {
      const container = target.parent;
      const list = container === ROOT ? config.root : (config.elements[container]?.children ?? []);
      const dragged = config.elements[dragId];
      if (dragged?.parent !== container) {
        store.dispatch({ type: "reparent", ids: [dragId], container, index: list.indexOf(target.id) + 1, keepPosition: true });
      } else {
        const order = list.filter((id) => id !== dragId);
        order.splice(order.indexOf(target.id) + 1, 0, dragId);
        store.dispatch({ type: "reorder", container, order });
      }
    }
    setDragId(null);
  };

  const row = (id: string, depth: number): React.ReactNode => {
    const el = config.elements[id];
    if (!el) return null;
    const selected = state.selection.includes(id);
    const overridden = variant?.elements?.[id] !== undefined;
    const moved = variant?.structure?.parents?.[id] !== undefined;
    // Top of the list = top of the z order.
    const children = el.type === "group" ? [...(el.children ?? [])].reverse() : [];
    return (
      <React.Fragment key={id}>
        <div
          draggable
          onDragStart={() => setDragId(id)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => onDrop(el, e)}
          onClick={(e) => store.select([id], e.shiftKey || e.ctrlKey || e.metaKey ? "toggle" : "replace")}
          className={`flex items-center gap-1 px-1 py-0.5 text-xs cursor-pointer rounded ${selected ? "bg-sky-900/60" : "hover:bg-zinc-800"} ${el.effectiveDisabled ? "opacity-50" : ""}`}
          style={{ paddingLeft: 4 + depth * 12 }}
          data-ovl-layer={id}
        >
          <span className="flex-1 truncate" title={id}>
            {label(el, m)}
            {el.origin === "variant" && <span className="ml-1 text-emerald-400" title={m.addedInVariant}>+</span>}
            {overridden && <span className="ml-1 text-amber-400" title={m.overridden}>●</span>}
            {moved && <span className="ml-1 text-violet-400" title={m.movedInVariant}>↳</span>}
          </span>
          <button className={btn} title={el.editorHidden ? m.show : m.hide} onClick={(e) => { e.stopPropagation(); toggle(el, "editorHidden", !el.editorHidden); }}>
            {el.editorHidden ? "◌" : "◉"}
          </button>
          <button className={btn} title={el.locked ? m.unlock : m.lock} onClick={(e) => { e.stopPropagation(); toggle(el, "locked", !el.locked); }}>
            {el.locked ? "🔒" : "🔓"}
          </button>
        </div>
        {children.map((c) => row(c, depth + 1))}
      </React.Fragment>
    );
  };

  const arrange = (how: "forward" | "backward" | "front" | "back") => {
    const cmd = arrangeCommand(config, state.selection, how);
    if (cmd) store.dispatch(cmd, { label: m.arrange[how] });
  };

  return (
    <div className="flex flex-col gap-1 min-h-0">
      <div className="flex items-center gap-1 text-xs text-zinc-400">
        <span className="flex-1 font-semibold">{m.layers}</span>
        <button className={btn} title={m.arrange.front} disabled={!state.selection.length} onClick={() => arrange("front")}>⤒</button>
        <button className={btn} title={m.arrange.forward} disabled={!state.selection.length} onClick={() => arrange("forward")}>↑</button>
        <button className={btn} title={m.arrange.backward} disabled={!state.selection.length} onClick={() => arrange("backward")}>↓</button>
        <button className={btn} title={m.arrange.back} disabled={!state.selection.length} onClick={() => arrange("back")}>⤓</button>
      </div>
      <div className="overflow-auto">{[...config.root].reverse().map((id) => row(id, 0))}</div>
    </div>
  );
}

const FIELDS: { name: string; types?: EffectiveElement["type"][] }[] = [
  { name: "x" }, { name: "y" }, { name: "rotation" }, { name: "scaleX" }, { name: "scaleY" },
  { name: "width", types: ["rect", "ellipse", "linearGauge", "videoStream"] }, { name: "height", types: ["rect", "ellipse", "linearGauge", "videoStream"] },
  { name: "radius", types: ["arc", "radialGauge", "lidarWidget"] }, { name: "pivotX" }, { name: "pivotY" },
];

export function TransformPanel({ store, m }: { store: EditorStore; m: EditorMessages }) {
  const state = useEditorState(store);
  const config = store.effective();
  const ids = state.selection.filter((id) => config.elements[id]);
  if (ids.length === 0) return <div className="text-xs text-zinc-500">{m.noSelection}</div>;
  if (ids.length > 1) return <div className="text-xs text-zinc-400">{m.multiSelection(ids.length)}</div>;
  const el = config.elements[ids[0]];
  const values = staticProps(el.type, el.props, el.lockAspect);
  const inVariant = state.activeVariant !== null && el.origin === "standard";
  const override = inVariant ? state.document.variants?.[state.activeVariant!]?.elements?.[el.id] : undefined;

  const commit = (name: string, text: string) => {
    if (name.startsWith("pivot") && text.trim() === "") {
      store.dispatch({ type: "setProperty", element: el.id, property: name, value: undefined });
      return;
    }
    const v = Number(text.replace(",", "."));
    if (!Number.isFinite(v)) return;
    store.dispatch({ type: "setProperty", element: el.id, property: name, value: withBase(el.props[name], v) }, { mergeKey: `${el.id}:${name}` });
  };

  const attr = (name: AttributeName, value: boolean) => setFlag(store, el, name, value);

  return (
    <div className="flex flex-col gap-1 text-xs" data-ovl-transform={el.id}>
      <div className="flex items-center gap-1">
        <input
          className={input}
          defaultValue={el.name ?? ""}
          key={`${el.id}-name-${state.version}`}
          placeholder={m.types[el.type]}
          onBlur={(e) => store.dispatch({ type: "setAttribute", element: el.id, name: "name", value: e.target.value || undefined })}
        />
        {override && <button className={btn} onClick={() => store.dispatch({ type: "resetOverride", element: el.id, variant: state.activeVariant! })}>{m.resetElement}</button>}
      </div>
      <div className="font-semibold text-zinc-400">{m.transform}</div>
      <div className="grid grid-cols-[auto_1fr_auto] gap-x-1 gap-y-0.5 items-center">
        {FIELDS.filter((f) => !f.types || f.types.includes(el.type)).filter((f) => !(f.name === "scaleY" && el.lockAspect)).map((f) => {
          const origin = el.propOrigins[f.name];
          const overridden = inVariant && origin === "variant";
          const dynamic = typeof el.props[f.name] === "object" && el.props[f.name] !== null;
          const v = values[f.name];
          return (
            <React.Fragment key={f.name}>
              <label className={overridden ? "text-amber-400" : inVariant ? "text-zinc-500" : "text-zinc-300"} title={overridden ? m.overridden : inVariant ? m.inherited : undefined}>
                {f.name}{dynamic ? " ƒ" : ""}
              </label>
              <input
                className={input}
                key={`${el.id}-${f.name}-${state.version}`}
                defaultValue={v === "center" || v === undefined ? "" : String(v)}
                placeholder={v === "center" ? "center" : undefined}
                title={dynamic ? m.dynamicHint : undefined}
                onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") commit(f.name, (e.target as HTMLInputElement).value); }}
                onBlur={(e) => commit(f.name, e.target.value)}
              />
              {overridden ? (
                <button className={btn} title={m.reset} onClick={() => store.dispatch({ type: "resetOverride", element: el.id, property: f.name, variant: state.activeVariant! })}>↺</button>
              ) : <span />}
            </React.Fragment>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-1 mt-1">
        <label className="flex items-center gap-1"><input type="checkbox" checked={el.lockAspect} onChange={(e) => attr("lockAspect", e.target.checked)} />lockAspect</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={el.locked} onChange={(e) => attr("locked", e.target.checked)} />{m.lock}</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={el.editorHidden} onChange={(e) => attr("editorHidden", e.target.checked)} />{m.hide}</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={el.disabled} onChange={(e) => attr("disabled", e.target.checked)} />{m.disable}</label>
      </div>
    </div>
  );
}
