import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/router";
import GamepadViewer from "../../../components/gamepad-viewer";
import CarFunctionsView from "../../../components/car-functions-view";
import SessionTransfer from "../../../components/session-transfer";
import ReactFlow, { MiniMap, Controls, Background, useReactFlow, NodeDragHandler, Node, Edge, ReactFlowProvider, Connection, OnEdgesDelete } from "reactflow";
import "reactflow/dist/style.css";
import { ControlFlowEdge, ControlFlowNode, useControlFlowStore } from "@/components/control-flow-store";
import FunctionNodesView from "@/components/function-nodes-view";
import CustomFlowNode from "@/components/custom-flow-node";
import FlowEdge from "@/components/flow-edge";
import { clusterFrame } from "@/components/flow-layout";
import { ArrangedClusters, ClusterFrameNode, FlowLayoutPanel } from "@/components/flow-layout-panel";
import ConfigGuard from "@/components/config-guard";
import UpdateControl from "@/components/update-control";
import ConfigHeader from "@/components/config-header";
import SetupTemplatePanel from "@/components/setup-template-panel";
import FlowSharingPanel from "@/components/flow-sharing-panel";
import { useI18n } from "@/i18n/provider";
import OnboardFlowStatusBanner from "@/components/onboard-flow-status";
import VehicleInputsView from "@/components/vehicle-inputs-view";
import { isAllowedLink, portZone } from "@/components/flow-zone-rules";
import { FlowViewportCenter } from "@/components/flow-new-node-position";

const nodeTypes = { custom: CustomFlowNode, clusterFrame: ClusterFrameNode };
const edgeTypes = { flow: FlowEdge };

export default function CarControlFlowPage() {
  const { messages } = useI18n();
  const router = useRouter();
  // Only what the page itself needs: values change many times per second (gamepad,
  // vehicle status) and must not rebuild the canvas; each node reads its values itself.
  const flowNodes = useControlFlowStore(s => s.nodes);
  const flowEdges = useControlFlowStore(s => s.edges);
  const isLoading = useControlFlowStore(s => s.isLoading);
  const flowControl = useControlFlowStore.getState();
  const carId = router.query.carId as string;
  const carIdNum = carId ? parseInt(carId) : undefined;
  // Clicking a connection selects it; its trash button or the Delete key removes it.
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  // Cluster frames of the last auto arrangement; they follow dragged nodes.
  const [arranged, setArranged] = useState<ArrangedClusters | null>(null);

  function controlNodeToReact(input: ControlFlowNode): Node<any, string | undefined> {
    return {
      id: input.nodeId.toString(),
      // CustomFlowNode takes everything else (values, params) from the store by nodeId.
      data: { nodeId: input.nodeId },
      position: input.position,
      type: "custom"
    };
  }

  // The store hands out a new nodes array with every value update; React Flow only gets
  // new node objects when something it shows changes. Otherwise every update re-rendered
  // all nodes, which made nodes flicker while connecting and editing values.
  const structure = flowNodes.map(n => `${n.nodeId}:${n.position.x}:${n.position.y}:${n.zone ?? ""}:${n.type}`).join("|");
  const reactNodes = useMemo(
    () => flowNodes.map(controlNodeToReact),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [structure],
  );

  function clusterFrameNodes(): Node[] {
    if (!arranged) return [];
    const positions = Object.fromEntries(flowNodes.map(n => [n.nodeId, n.position]));
    return arranged.clusters.flatMap((cluster, i) => {
      const frame = clusterFrame(cluster, positions, arranged.sizes);
      if (!frame) return [];
      return [{
        id: `cluster-${i}`,
        type: "clusterFrame",
        position: { x: frame.x, y: frame.y },
        data: { title: cluster.title },
        style: { width: frame.width, height: frame.height },
        draggable: false,
        selectable: false,
        connectable: false,
        zIndex: -1,
      }];
    });
  }

  const nodeById = new Map(flowNodes.map(n => [n.nodeId, n]));

  function controlEdgeToReact(input: ControlFlowEdge): Edge<any> {
    return {
      id: input.id.toString(),
      source: input.source.toString(),
      target: input.target.toString(),
      type: "flow",
      // Coloured by the zone of the output it comes from: web blue, vehicle orange.
      className: `flow-edge-${portZone(nodeById.get(Number(input.source)), "source")}`,
      animated: true,
      selected: input.id.toString() === selectedEdgeId,
      sourceHandle: input.sourcePort,
      targetHandle: input.targetPort,
    };
  }

  useEffect(() => {
    if (carIdNum) {
      // Opened directly or reloaded: the main page that normally connects is skipped.
      flowControl.startConnection(carIdNum, undefined).catch(err => console.error("Connecting to the server failed:", err));
      flowControl.load(carIdNum);
      flowControl.startUserChannelConnection();
      flowControl.subscribeToInputNodes();
      // Enable config mode when entering configuration page
      flowControl.setConfigMode(true);
    }
    
    // The vehicle sends its node values only while an editor shows them.
    flowControl.setFlowValuesWanted(true);

    // Cleanup: disable config mode when leaving
    return () => {
      flowControl.setConfigMode(false);
      useControlFlowStore.getState().setFlowValuesWanted(false);
    };
  }, [carIdNum]);

  const onNodeDrag: NodeDragHandler = async (event, node) => {
    const store = useControlFlowStore.getState();
    const oldNode = store.nodes.find(n => n.nodeId === Number(node.id));
    if (!oldNode) return;
    store.updateNode({ ...oldNode, position: { x: node.position.x, y: node.position.y } });
  };

  const onConnect = useCallback((params: Connection) => {
    useControlFlowStore.getState().addEdge(params);
  }, []);

  // Top-down only (OnboardFlow-Arbeitspakete.md T03); the server checks again.
  const isValidConnection = useCallback((c: Connection) => {
    const nodes = useControlFlowStore.getState().nodes;
    return isAllowedLink(nodes.find(n => String(n.nodeId) === c.source), nodes.find(n => String(n.nodeId) === c.target));
  }, []);

  const onEdgeClick = useCallback((event: any, edge: Edge<any>) => {
    setSelectedEdgeId(id => id === edge.id ? null : edge.id);
  }, []);

  const onEdgesDelete: OnEdgesDelete = useCallback((edges) => {
    edges.forEach(edge => useControlFlowStore.getState().removeEdge(Number(edge.id)));
    setSelectedEdgeId(null);
  }, []);

  const onNodeDragStop: NodeDragHandler = async (event, node) => {
    const store = useControlFlowStore.getState();
    const oldNode = store.nodes.find(n => n.nodeId === Number(node.id));
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
    store.updateNode({ ...oldNode, position: { x: node.position.x, y: node.position.y } });
  };

  const frames = useMemo(clusterFrameNodes,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [arranged, structure]);
  const allNodes = useMemo(() => [...frames, ...reactNodes], [frames, reactNodes]);
  const reactEdges = useMemo(
    () => flowEdges.map(controlEdgeToReact),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flowEdges, selectedEdgeId, structure],
  );

  if (isLoading)
    return <div className="p-8 text-zinc-300">{messages.controlFlowPage.loadingFlow}</div>;
  
  if (!carIdNum) {
    return <div className="p-8 text-zinc-300">{messages.common.loading}</div>;
  }

  return (
    <ConfigGuard carId={carIdNum}>
      <div className="flex flex-col p-4 bg-zinc-950 text-zinc-100 min-h-screen">
      <ConfigHeader carId={carIdNum} active="flow" className="mb-4" />
      <OnboardFlowStatusBanner showToggle className="mb-4" />
      <div className="flex flex-1 flex-col md:flex-row gap-4">
        <div className="w-full md:w-1/4 space-y-4">
          <UpdateControl />
          <GamepadViewer hideFlowButtons={false} />
          <FunctionNodesView />
          {carIdNum && <CarFunctionsView carId={carIdNum} hideFlowButtons={false} />}
          {carIdNum && <VehicleInputsView carId={carIdNum} />}
          {carIdNum && <SetupTemplatePanel carId={carIdNum} />}
          {carIdNum && <FlowSharingPanel carId={carIdNum} />}
        </div>
        <div className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg p-2 min-h-[600px]">
          <ReactFlowProvider>
            <ReactFlow
              nodes={allNodes}
              edges={reactEdges}
              fitView
              onNodeDrag={onNodeDrag}
              onNodeDragStop={onNodeDragStop}
              onConnect={onConnect}
              isValidConnection={isValidConnection}
              onEdgeClick={onEdgeClick}
              onEdgesDelete={onEdgesDelete}
              onPaneClick={() => setSelectedEdgeId(null)}
              edgeTypes={edgeTypes}
              deleteKeyCode={["Delete", "Backspace"]}
              nodeTypes={nodeTypes}
              connectionLineStyle={{ stroke: "#e4e4e7", strokeWidth: 2 }}
              connectionRadius={30}
              draggable
            >
              <MiniMap
                nodeColor={n => n.type === "clusterFrame" ? "transparent" : "#52525b"}
                nodeStrokeColor={n => n.type === "clusterFrame" ? "#3f3f46" : "#a1a1aa"}
                maskColor="rgba(9, 9, 11, 0.6)"
              />
              <FlowLayoutPanel onArranged={setArranged} />
              <FlowViewportCenter />
              <Controls />
              <Background color="#3f3f46" gap={20} />
            </ReactFlow>
          </ReactFlowProvider>
        </div>
      </div>
      </div>
    </ConfigGuard>
  );
}
