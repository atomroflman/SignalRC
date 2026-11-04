import React from "react";
import { BaseEdge, EdgeLabelRenderer, EdgeProps, getSmoothStepPath } from "reactflow";
import { useI18n } from "@/i18n/provider";
import { useControlFlowStore } from "./control-flow-store";
import { TrashIcon } from "./flow-node-header";

// Connection between two flow nodes. A wide invisible stroke makes it easy to
// hit; a click selects it (page state) and only the trash button at its middle
// deletes it, so a stray click no longer removes a connection.
export const EDGE_HIT_WIDTH = 28;

export default function FlowEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, markerEnd, selected }: EdgeProps) {
  const { messages } = useI18n();
  const removeEdge = useControlFlowStore((s) => s.removeEdge);
  const [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  return (
    <>
      <BaseEdge path={path} style={style} markerEnd={markerEnd} interactionWidth={EDGE_HIT_WIDTH} />
      {selected && (
        <EdgeLabelRenderer>
          <button
            className="nodrag nopan absolute w-7 h-7 grid place-items-center rounded-full bg-zinc-800 border border-zinc-500 text-zinc-200 shadow-lg shadow-black/50 hover:text-red-300 hover:border-red-400 hover:bg-red-950 transition-colors"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, pointerEvents: "all" }}
            onClick={(e) => { e.stopPropagation(); removeEdge(Number(id)); }}
            title={messages.flowNode.deleteEdge}
            aria-label={messages.flowNode.deleteEdge}
          >
            <TrashIcon />
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
