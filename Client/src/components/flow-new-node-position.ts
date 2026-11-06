import { useEffect } from "react";
import { useReactFlow, useStoreApi } from "reactflow";

type Point = { x: number; y: number };

// Rough size of a node card; its top left corner is placed so the card sits in the middle.
const NODE_HALF = { x: 100, y: 60 };
const STEP = 30;

let viewportCenter: (() => Point | null) | null = null;

/**
 * Where a new node goes: centred in the visible part of the flow editor, shifted down
 * and right while another node already sits there. Without an editor on screen, the
 * fallback is used.
 */
export function newNodePosition(fallback: Point, existing: Point[]): Point {
  const center = viewportCenter?.();
  if (!center) return fallback;
  let p = { x: Math.round(center.x - NODE_HALF.x), y: Math.round(center.y - NODE_HALF.y) };
  for (let i = 0; i < 50 && existing.some(e => Math.abs(e.x - p.x) < STEP / 2 && Math.abs(e.y - p.y) < STEP / 2); i++)
    p = { x: p.x + STEP, y: p.y + STEP };
  return p;
}

/** Placed inside <ReactFlow>: makes the visible centre of this editor available to newNodePosition. */
export function FlowViewportCenter() {
  const { screenToFlowPosition } = useReactFlow();
  const store = useStoreApi();
  useEffect(() => {
    const get = () => {
      const dom = store.getState().domNode;
      if (!dom) return null;
      const r = dom.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return null;
      return screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    };
    viewportCenter = get;
    return () => { if (viewportCenter === get) viewportCenter = null; };
  }, [screenToFlowPosition, store]);
  return null;
}
