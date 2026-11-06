"use client";

import React, { useCallback, useEffect, useState } from "react";
import ReactFlow, { Background, Edge, Node, ReactFlowProvider } from "reactflow";
import { useControlFlowStore } from "@/components/control-flow-store";
import { useI18n } from "@/i18n/provider";

/** One driver's flow of the vehicle (GET /api/flow/cars/{carId}/setups). */
export type SetupSummary = { setupId: number; owner: string; isMine: boolean; nodeCount: number; linkCount: number };

type FlowPreview = { nodes: Node[]; edges: Edge[] };

type RawFlow = {
  nodes?: { nodeId: number; label?: string; position?: { x: number; y: number } }[];
  edges?: { id: number; source: number; target: number }[];
};

/** The other drivers' flows (not the own one), largest first. */
export function otherFlows(list: SetupSummary[]): SetupSummary[] {
  return list.filter(s => !s.isMine && s.nodeCount > 0).sort((a, b) => b.nodeCount - a.nodeCount || a.owner.localeCompare(b.owner));
}

export function toPreview(raw: RawFlow): FlowPreview {
  return {
    nodes: (raw.nodes ?? []).map(n => ({
      id: String(n.nodeId),
      position: n.position ?? { x: 0, y: 0 },
      data: { label: n.label || String(n.nodeId) },
      draggable: false,
      connectable: false,
    })),
    edges: (raw.edges ?? []).map(e => ({ id: String(e.id), source: String(e.source), target: String(e.target) })),
  };
}

/**
 * Flows stay per driver (Docs/VehicleKeyAuth.md), but the others' flows of a vehicle
 * can be viewed and copied into the own one; the copy replaces the own flow.
 */
export default function FlowSharingPanel({ carId }: { carId: number }) {
  const { messages } = useI18n();
  const t = messages.flowSharing;
  const reloadFlow = useControlFlowStore(s => s.load);
  const [list, setList] = useState<SetupSummary[] | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ owner: string; flow: FlowPreview } | null>(null);
  const [busy, setBusy] = useState(false);

  const loadList = useCallback(async () => {
    const res = await fetch(`/api/flow/cars/${carId}/setups`);
    setList(res.ok ? otherFlows(await res.json()) : []);
  }, [carId]);
  useEffect(() => { void loadList(); }, [loadList]);

  const view = async (setup: SetupSummary) => {
    const res = await fetch(`/api/flow/${setup.setupId}`);
    if (!res.ok) {
      setStatus(t.failed(res.statusText));
      return;
    }
    setPreview({ owner: setup.owner, flow: toPreview(await res.json()) });
  };

  const copy = async (setup: SetupSummary) => {
    if (!window.confirm(t.confirmCopy(setup.owner))) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/flow/cars/${carId}/copy-from/${setup.setupId}`, { method: "POST" });
      if (!res.ok) {
        setStatus(t.failed(await res.text()));
        return;
      }
      const result = await res.json() as { warnings?: string[] };
      setStatus(t.copied(result.warnings?.length ?? 0));
      await reloadFlow(carId);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-zinc-900 rounded-lg p-2 border border-zinc-800 text-xs space-y-2">
      <div className="font-semibold text-zinc-200">{t.title}</div>
      {list === null ? null : list.length === 0 ? (
        <div className="text-zinc-500">{t.empty}</div>
      ) : (
        <ul className="space-y-1">
          {list.map(s => (
            <li key={s.setupId} className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-zinc-200">{s.owner}</div>
                <div className="text-zinc-500">{t.size(s.nodeCount, s.linkCount)}</div>
              </div>
              <div className="flex shrink-0 gap-1">
                <button type="button" className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200" onClick={() => void view(s)}>{t.view}</button>
                <button type="button" disabled={busy} className="px-2 py-1 rounded bg-sky-800 hover:bg-sky-700 border border-sky-700 text-white disabled:opacity-50" onClick={() => void copy(s)}>{t.copy}</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {status && <div className="text-zinc-400">{status}</div>}

      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-label={t.previewTitle(preview.owner)}>
          <div className="flex h-[80vh] w-full max-w-5xl flex-col rounded-lg border border-zinc-700 bg-zinc-950">
            <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
              <span className="text-sm text-zinc-100">{t.previewTitle(preview.owner)}</span>
              <button type="button" className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-xs" onClick={() => setPreview(null)}>{t.close}</button>
            </div>
            <div className="flex-1">
              <ReactFlowProvider>
                <ReactFlow nodes={preview.flow.nodes} edges={preview.flow.edges} fitView nodesDraggable={false} nodesConnectable={false} elementsSelectable={false}>
                  <Background color="#3f3f46" gap={20} />
                </ReactFlow>
              </ReactFlowProvider>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
