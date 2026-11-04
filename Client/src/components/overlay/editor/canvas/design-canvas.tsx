"use client";
// Design surface: renders the active view through the AP08 runtime in design
// mode (animation paused, optional scrub) and adds selection, handles,
// marquee, zoom/pan and grid snapping on top. All changes go through store commands.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ROOT, type EffectiveConfig } from "../../document/types";
import { OverlayRenderer } from "../../runtime/overlay-renderer";
import type { RendererSource } from "../../runtime/controller";
import type { FrameResult, Locale, RuntimeAsset } from "../../runtime/types";
import { hitTest, layout, marqueeSelect, selectionBox, staticProps, worldCorners, apply, type Box, type Placement } from "../core/geometry";
import type { EditorStore } from "../core/store";
import { dispatchAll, moveCommands, resizeCommand, rotateCommand, snap, topLevel, type Handle } from "../core/tools";
import type { Point } from "../core/types";
import { useEditorState } from "./hooks";

export interface DesignCanvasProps {
  store: EditorStore;
  assets?: Record<string, RuntimeAsset>;
  locale: Locale;
  /** Live values for formulas shown in design mode (read-only). */
  source?: RendererSource;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  className?: string;
}

type Drag =
  | { kind: "move"; start: Point; config: EffectiveConfig; placements: Map<string, Placement>; ids: string[]; box: Box; moved: boolean }
  | { kind: "resize"; handle: Handle; id: string; config: EffectiveConfig; placement: Placement }
  | { kind: "rotate"; id: string; start: Point; config: EffectiveConfig; placement: Placement }
  | { kind: "marquee"; start: Point; current: Point; additive: boolean }
  | { kind: "pan"; start: { x: number; y: number }; pan: { x: number; y: number } };

const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const CURSOR: Record<Handle, string> = { n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", ne: "nesw-resize", sw: "nesw-resize", nw: "nwse-resize", se: "nwse-resize" };

/** Hides editor-hidden elements on the design surface only (D47). */
function designConfig(config: EffectiveConfig): EffectiveConfig {
  const hidden = Object.values(config.elements).filter((e) => e.editorHidden);
  if (hidden.length === 0) return config;
  const elements = { ...config.elements };
  for (const e of hidden) elements[e.id] = { ...e, props: { ...e.props, visible: false } };
  return { ...config, elements };
}

export function DesignCanvas({ store, assets, locale, source, onKeyDown, className }: DesignCanvasProps) {
  const state = useEditorState(store);
  const config = store.effective();
  const shown = useMemo(() => designConfig(config), [config]);
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<FrameResult | undefined>();
  const [drag, setDrag] = useState<Drag | undefined>();
  const [spaceDown, setSpaceDown] = useState(false);
  const { zoom, panX, panY, grid, enteredGroup } = state.view;
  const ws = config.workspace;

  const onFrame = useCallback((f: FrameResult) => setFrame(f), []);
  const placements = useMemo(() => layout(config, (el) => frame?.elements[el.id]?.props ?? staticProps(el.type, el.props, el.lockAspect), { assets, locale }),
    [config, frame, assets, locale]);

  const fit = useCallback(() => {
    const host = hostRef.current;
    if (!host) return;
    const r = host.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    const z = Math.min(r.width / ws.width, r.height / ws.height) * 0.95;
    store.setView({ zoom: z, panX: (r.width - ws.width * z) / 2, panY: (r.height - ws.height * z) / 2 });
  }, [store, ws.width, ws.height]);

  // Fit once the host has a size, and when the workspace changes.
  useEffect(() => { fit(); }, [fit]);

  const toWorkspace = (e: { clientX: number; clientY: number }): Point => {
    const r = stageRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
  };

  const pickLevel = (path: string[]): string => {
    if (enteredGroup !== null) {
      const i = path.indexOf(enteredGroup);
      if (i >= 0 && i + 1 < path.length) return path[i + 1];
    }
    return path[0];
  };

  const selectable = state.selection.filter((id) => !config.elements[id]?.locked);

  const onPointerDown = (e: React.PointerEvent) => {
    hostRef.current?.focus();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    if (e.button === 1 || (e.button === 0 && spaceDown)) {
      setDrag({ kind: "pan", start: { x: e.clientX, y: e.clientY }, pan: { x: panX, y: panY } });
      return;
    }
    if (e.button !== 0) return;
    const p = toWorkspace(e);
    const target = (e.target as Element).getAttribute?.("data-handle");
    if (target && selectable.length === 1) {
      const id = selectable[0];
      const placement = placements.get(id);
      if (placement) {
        store.beginTransaction(target === "rotate" ? "Drehen" : "Skalieren");
        setDrag(target === "rotate"
          ? { kind: "rotate", id, start: p, config, placement }
          : { kind: "resize", handle: target as Handle, id, config, placement });
        return;
      }
    }
    const path = hitTest(config, placements, p);
    if (!path) {
      if (!e.shiftKey) store.select([]);
      setDrag({ kind: "marquee", start: p, current: p, additive: e.shiftKey });
      return;
    }
    const id = pickLevel(path);
    if (e.shiftKey) {
      store.select([id], "toggle");
      return;
    }
    const ids = state.selection.includes(id) ? selectable : [id];
    if (!state.selection.includes(id)) store.select([id]);
    const moving = topLevel(config, ids);
    store.beginTransaction("Verschieben");
    setDrag({ kind: "move", start: p, config, placements, ids: moving, box: selectionBox(placements, moving) ?? [p.x, p.y, 0, 0], moved: false });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    if (drag.kind === "pan") {
      store.setView({ panX: drag.pan.x + e.clientX - drag.start.x, panY: drag.pan.y + e.clientY - drag.start.y });
      return;
    }
    const p = toWorkspace(e);
    switch (drag.kind) {
      case "move": {
        let dx = p.x - drag.start.x;
        let dy = p.y - drag.start.y;
        if (!drag.moved && Math.hypot(dx, dy) * zoom < 3) return;
        if (e.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        if (grid.enabled && grid.snap && !e.altKey) {
          dx = snap(drag.box[0] + dx, grid.size) - drag.box[0];
          dy = snap(drag.box[1] + dy, grid.size) - drag.box[1];
        }
        drag.moved = true;
        for (const c of moveCommands(drag.config, drag.placements, drag.ids, dx, dy)) store.dispatch(c);
        break;
      }
      case "resize": {
        const el = drag.config.elements[drag.id];
        const q = grid.enabled && grid.snap && !e.altKey ? { x: snap(p.x, grid.size), y: snap(p.y, grid.size) } : p;
        store.dispatch(resizeCommand(el, drag.placement, drag.handle, q, e.shiftKey));
        break;
      }
      case "rotate":
        store.dispatch(rotateCommand(drag.config.elements[drag.id], drag.placement, drag.start, p, e.shiftKey ? 15 : 0));
        break;
      case "marquee":
        setDrag({ ...drag, current: p });
        break;
    }
  };

  const onPointerUp = () => {
    if (!drag) return;
    if (drag.kind === "move" || drag.kind === "resize" || drag.kind === "rotate") store.commitTransaction();
    if (drag.kind === "marquee") {
      const r = rectOf(drag.start, drag.current);
      if (r[2] > 0 || r[3] > 0) {
        const ids = marqueeSelect(config, placements, r, enteredGroup ?? ROOT);
        store.select(ids, drag.additive ? "add" : "replace");
      }
    }
    setDrag(undefined);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const path = hitTest(config, placements, toWorkspace(e));
    if (!path) {
      store.setView({ enteredGroup: null });
      return;
    }
    const id = pickLevel(path);
    if (config.elements[id]?.type === "group") {
      store.setView({ enteredGroup: id });
      const inner = path[path.indexOf(id) + 1];
      if (inner) store.select([inner]);
    }
  };

  const zoomAt = useRef<(e: WheelEvent) => void>(() => {});
  zoomAt.current = (e) => {
    const host = hostRef.current;
    if (!host) return;
    const r = host.getBoundingClientRect();
    const cx = e.clientX - r.left;
    const cy = e.clientY - r.top;
    const z = Math.min(16, Math.max(0.05, zoom * Math.exp(-e.deltaY * 0.0015)));
    store.setView({ zoom: z, panX: cx - ((cx - panX) / zoom) * z, panY: cy - ((cy - panY) / zoom) * z });
  };
  // The wheel zooms only over the HUD workspace; elsewhere the page scrolls.
  // A native listener, because React's wheel handler is passive and cannot stop the scroll.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt.current(e);
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, []);

  const keyDown = (e: React.KeyboardEvent) => {
    // Editor keys never reach the vehicle control (api/README.md §6).
    e.stopPropagation();
    if (e.key === " ") {
      setSpaceDown(true);
      e.preventDefault();
      return;
    }
    if (e.key === "Escape" && drag) {
      if (drag.kind !== "marquee" && drag.kind !== "pan") store.cancelTransaction();
      setDrag(undefined);
      return;
    }
    const step = e.shiftKey ? 10 : 1;
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (arrows[e.key] && selectable.length > 0) {
      e.preventDefault();
      const [dx, dy] = arrows[e.key];
      const cmds = moveCommands(config, placements, selectable, dx, dy);
      if (cmds.length === 1) store.dispatch(cmds[0], { label: "Verschieben", mergeKey: `nudge:${selectable.join(",")}` });
      else dispatchAll(store, cmds, "Verschieben");
      return;
    }
    onKeyDown?.(e);
  };

  const unit = 1 / zoom;
  const single = selectable.length === 1 ? placements.get(selectable[0]) : undefined;
  const union = selectionBox(placements, state.selection);

  return (
    <div
      ref={hostRef}
      tabIndex={0}
      className={`relative overflow-hidden bg-zinc-950 outline-none select-none ${className ?? ""}`}
      style={{ cursor: drag?.kind === "pan" || spaceDown ? "grab" : "default" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      onKeyDown={keyDown}
      onKeyUp={(e) => { if (e.key === " ") setSpaceDown(false); e.stopPropagation(); }}
      data-ovl-design-canvas=""
    >
      <div
        ref={stageRef}
        className="absolute"
        style={{ left: panX, top: panY, width: ws.width * zoom, height: ws.height * zoom, background: "repeating-conic-gradient(#27272a 0% 25%, #18181b 0% 50%) 0 0 / 20px 20px" }}
      >
        <OverlayRenderer
          config={shown}
          assets={assets}
          source={source}
          mode="design"
          locale={locale}
          scrub={state.scrub}
          onFrame={onFrame}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        />
        <svg viewBox={`0 0 ${ws.width} ${ws.height}`} className="absolute inset-0 w-full h-full" style={{ overflow: "visible" }}>
          {grid.enabled && grid.size * zoom >= 4 && (
            <>
              <defs>
                <pattern id="ovl-editor-grid" width={grid.size} height={grid.size} patternUnits="userSpaceOnUse">
                  <path d={`M${grid.size} 0H0V${grid.size}`} fill="none" stroke="#ffffff22" strokeWidth={unit} />
                </pattern>
              </defs>
              <rect width={ws.width} height={ws.height} fill="url(#ovl-editor-grid)" pointerEvents="none" />
            </>
          )}
          <rect width={ws.width} height={ws.height} fill="none" stroke="#71717a" strokeWidth={unit} pointerEvents="none" />
          {enteredGroup && placements.get(enteredGroup) && (
            <polygon points={pts(worldCorners(placements.get(enteredGroup)!))} fill="none" stroke="#a78bfa" strokeDasharray={`${4 * unit} ${3 * unit}`} strokeWidth={unit} pointerEvents="none" />
          )}
          {state.selection.map((id) => {
            const p = placements.get(id);
            if (!p) return null;
            const locked = config.elements[id]?.locked;
            return <polygon key={id} points={pts(worldCorners(p))} fill="none" stroke={locked ? "#f59e0b" : "#38bdf8"} strokeWidth={1.5 * unit} pointerEvents="none" />;
          })}
          {state.selection.length > 1 && union && (
            <rect x={union[0]} y={union[1]} width={union[2]} height={union[3]} fill="none" stroke="#38bdf8" strokeDasharray={`${4 * unit} ${3 * unit}`} strokeWidth={unit} pointerEvents="none" />
          )}
          {single && <Handles placement={single} unit={unit} />}
          {drag?.kind === "marquee" && (() => {
            const r = rectOf(drag.start, drag.current);
            return <rect x={r[0]} y={r[1]} width={r[2]} height={r[3]} fill="#38bdf822" stroke="#38bdf8" strokeWidth={unit} pointerEvents="none" />;
          })()}
        </svg>
      </div>
      <div className="absolute bottom-1 right-2 text-[10px] text-zinc-500 pointer-events-none">{Math.round(zoom * 100)} %</div>
    </div>
  );
}

function Handles({ placement, unit }: { placement: Placement; unit: number }) {
  const [x, y, w, h] = placement.box;
  const local: Record<Handle, [number, number]> = {
    nw: [x, y], n: [x + w / 2, y], ne: [x + w, y], e: [x + w, y + h / 2], se: [x + w, y + h], s: [x + w / 2, y + h], sw: [x, y + h], w: [x, y + h / 2],
  };
  const size = 8 * unit;
  const [tx, ty] = apply(placement.world, x + w / 2, y);
  const [cx, cy] = apply(placement.world, x + w / 2, y + h / 2);
  const len = Math.hypot(tx - cx, ty - cy) || 1;
  const rx = tx + ((tx - cx) / len) * 24 * unit;
  const ry = ty + ((ty - cy) / len) * 24 * unit;
  const [pvx, pvy] = apply(placement.world, placement.pivot[0], placement.pivot[1]);
  return (
    <g>
      <line x1={tx} y1={ty} x2={rx} y2={ry} stroke="#38bdf8" strokeWidth={unit} pointerEvents="none" />
      <circle data-handle="rotate" cx={rx} cy={ry} r={5 * unit} fill="#0c4a6e" stroke="#38bdf8" strokeWidth={unit} style={{ cursor: "grab" }} />
      <circle cx={pvx} cy={pvy} r={3 * unit} fill="none" stroke="#f472b6" strokeWidth={unit} pointerEvents="none" />
      {HANDLES.map((hd) => {
        const [hx, hy] = apply(placement.world, local[hd][0], local[hd][1]);
        return <rect key={hd} data-handle={hd} x={hx - size / 2} y={hy - size / 2} width={size} height={size} fill="#ffffff" stroke="#0284c7" strokeWidth={unit} style={{ cursor: CURSOR[hd] }} />;
      })}
    </g>
  );
}

const pts = (corners: Point[]) => corners.map((c) => `${c.x},${c.y}`).join(" ");

function rectOf(a: Point, b: Point): Box {
  return [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(a.x - b.x), Math.abs(a.y - b.y)];
}
