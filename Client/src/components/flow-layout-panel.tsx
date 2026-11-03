import React, { useState } from "react";
import { NodeProps, Panel, useReactFlow } from "reactflow";
import { useI18n } from "@/i18n/provider";
import { useControlFlowStore } from "./control-flow-store";
import { layoutFlow, type FlowCluster, type Point, type Size } from "./flow-layout";

// "Arrange automatically" for the flow editor (flow-layout.ts) with undo, and
// the cluster frame drawn behind the nodes. Frames are not saved; they follow
// dragged nodes until the next arrangement or undo.

export type ClusterFrameData = { title: string };

export function ClusterFrameNode({ data }: NodeProps<ClusterFrameData>) {
  return (
    <div className="w-full h-full rounded-xl border border-zinc-700 bg-zinc-800/25">
      <div className="px-3 pt-2 text-xs font-semibold tracking-wide text-zinc-300 truncate" title={data.title}>{data.title}</div>
    </div>
  );
}

export type ArrangedClusters = { clusters: FlowCluster[]; sizes: Record<number, Size> };

export function FlowLayoutPanel({ onArranged }: { onArranged(result: ArrangedClusters | null): void }) {
  const { messages } = useI18n();
  const m = messages.flowNode;
  const { getNodes, fitView } = useReactFlow();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [previous, setPrevious] = useState<Record<number, Point> | null>(null);

  const apply = async (positions: Record<number, Point>) => {
    await useControlFlowStore.getState().setNodePositions(positions);
    // Wait for the moved nodes to render before fitting the view.
    requestAnimationFrame(() => fitView({ padding: 0.1, duration: 300 }));
  };

  const arrange = async () => {
    setBusy(true);
    setError(false);
    try {
      const { nodes, edges } = useControlFlowStore.getState();
      // Measured sizes of the rendered node cards.
      const sizes: Record<number, Size> = {};
      for (const n of getNodes()) {
        if (n.type === "custom" && n.width && n.height) sizes[Number(n.id)] = { width: n.width, height: n.height };
      }
      const { default: ELK } = await import("elkjs/lib/elk.bundled.js");
      const result = await layoutFlow(new ELK(), nodes, edges, sizes, m.unconnected);
      const before = Object.fromEntries(nodes.map(n => [n.nodeId, n.position]));
      await apply(result.positions);
      setPrevious(before);
      onArranged({ clusters: result.clusters, sizes });
    } catch (e) {
      console.error("Arranging the flow failed", e);
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    if (!previous) return;
    setBusy(true);
    setError(false);
    try {
      await apply(previous);
      setPrevious(null);
      onArranged(null);
    } catch (e) {
      console.error("Undoing the arrangement failed", e);
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  const button = "px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors disabled:opacity-50";
  return (
    <Panel position="top-right" className="flex items-center gap-1.5">
      {error && <span className="text-xs text-red-300">{m.arrangeFailed}</span>}
      {previous && (
        <button className={`${button} bg-zinc-800 border-zinc-600 text-zinc-200 hover:bg-zinc-700`} disabled={busy} onClick={undo}>
          {m.undoArrange}
        </button>
      )}
      <button className={`${button} bg-zinc-700 border-zinc-500 text-zinc-50 hover:bg-zinc-600`} disabled={busy} onClick={arrange}>
        {busy ? m.arranging : m.arrange}
      </button>
    </Panel>
  );
}
