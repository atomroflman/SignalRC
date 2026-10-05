import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import GamepadViewer from "../../../components/gamepad-viewer";
import CarFunctionsView from "../../../components/car-functions-view";
import SessionTransfer from "../../../components/session-transfer";
import ReactFlow, { MiniMap, Controls, Background, useReactFlow, NodeDragHandler, Node, Edge, ReactFlowProvider, Connection, OnEdgesDelete } from "reactflow";
import "reactflow/dist/style.css";
import { ControlFlowEdge, ControlFlowNode, useControlFlowStore } from "@/components/control-flow-store";
import FunctionNodesView from "@/components/function-nodes-view";
import CustomFlowNode from "@/components/custom-flow-node";
import ConfigGuard from "@/components/config-guard";
import UpdateControl from "@/components/update-control";
import LanguageSwitcher from "@/components/language-switcher";
import SetupTemplatePanel from "@/components/setup-template-panel";
import { useI18n } from "@/i18n/provider";

const nodeTypes = { custom: CustomFlowNode };

export default function CarControlFlowPage() {
  const { messages } = useI18n();
  const router = useRouter();
  const flowControl = useControlFlowStore();
  const carId = router.query.carId as string;
  const carIdNum = carId ? parseInt(carId) : undefined;

  function controlNodeToReact(input: ControlFlowNode): Node<any, string | undefined> {
    return {
      id: input.nodeId.toString(),
      data: {
        ...input,
        label: `${input.nodeId}: ${input.label} (${(typeof(flowControl.nodeLatestValues[input.nodeId]) == "number" ? flowControl.nodeLatestValues[input.nodeId] : 0).toFixed(6)})`,
      },
      position: input.position,
      type: "custom"
    };
  }

  function controlEdgeToReact(input: ControlFlowEdge): Edge<any> {
    return {
      id: input.id.toString(),
      source: input.source.toString(),
      target: input.target.toString(),
      type: "smoothstep",
      animated: true,
      sourceHandle: input.sourcePort,
      targetHandle: input.targetPort,
    };
  }

  useEffect(() => {
    if (carIdNum) {
      flowControl.load(carIdNum);
      flowControl.startUserChannelConnection();
      flowControl.subscribeToInputNodes();
      // Enable config mode when entering configuration page
      flowControl.setConfigMode(true);
    }
    
    // Cleanup: disable config mode when leaving
    return () => {
      flowControl.setConfigMode(false);
    };
  }, [carIdNum]);

  const onNodeDrag: NodeDragHandler = async (event, node) => {
    const oldNode = flowControl.nodes.find(n => n.nodeId === Number(node.id));
    if (!oldNode) return;
    flowControl.updateNode({ ...oldNode, position: { x: node.position.x, y: node.position.y } });
  };

  const onConnect = useCallback((params: Connection) => {
    flowControl.addEdge(params);
  }, [flowControl]);

  const onEdgeClick = useCallback((event: any, edge: Edge<any>) => {
    flowControl.removeEdge(Number(edge.id));
  }, [flowControl]);

  const onNodeDragStop: NodeDragHandler = async (event, node) => {
    const oldNode = flowControl.nodes.find(n => n.nodeId === Number(node.id));
    if (!oldNode) return;
    await fetch("/api/flow/movenode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        NodeId: typeof node.data?.id === "number" ? node.data.id : parseInt(node.id.replace(/\D/g, "")),
        PositionX: node.position.x ?? 0,
        PositionY: node.position.y ?? 0,
      }),
    });
    flowControl.updateNode({ ...oldNode, position: { x: node.position.x, y: node.position.y } });
  };

  if (flowControl.isLoading)
    return <div className="p-8 text-zinc-300">{messages.controlFlowPage.loadingFlow}</div>;
  
  if (!carIdNum) {
    return <div className="p-8 text-zinc-300">{messages.common.loading}</div>;
  }

  return (
    <ConfigGuard carId={carIdNum}>
      <div className="flex flex-col md:flex-row gap-4 p-4 bg-zinc-950 min-h-screen">
        <div className="w-full md:w-1/4 space-y-4">
          <div className="flex justify-end">
            <LanguageSwitcher />
          </div>
          <UpdateControl />
          <GamepadViewer hideFlowButtons={false} />
          <FunctionNodesView />
          {carIdNum && <CarFunctionsView carId={carIdNum} hideFlowButtons={false} />}
          {carIdNum && (
            <div className="bg-zinc-900 rounded-lg p-2 border border-zinc-800 text-xs space-y-1">
              <Link href={`/car/${carIdNum}/channels`} className="text-blue-400 hover:underline block">
                Channels (control / telemetry / video)
              </Link>
              <Link href={`/car/${carIdNum}/test`} className="text-blue-400 hover:underline block">
                Test inputs / telemetry / video / audio
              </Link>
            </div>
          )}
          {carIdNum && <SetupTemplatePanel carId={carIdNum} />}
        </div>
        <div className="flex-1 bg-zinc-900 rounded-lg p-2 min-h-[600px]">
          <ReactFlowProvider>
            <ReactFlow
              nodes={flowControl.nodes.map(controlNodeToReact)}
              edges={flowControl.edges.map(controlEdgeToReact)}
              fitView
              onNodeDrag={onNodeDrag}
              onNodeDragStop={onNodeDragStop}
              onConnect={onConnect}
              onEdgeClick={onEdgeClick}
              nodeTypes={nodeTypes}
              draggable
            >
              <MiniMap />
              <Controls />
              <Background />
            </ReactFlow>
          </ReactFlowProvider>
        </div>
      </div>
    </ConfigGuard>
  );
}
