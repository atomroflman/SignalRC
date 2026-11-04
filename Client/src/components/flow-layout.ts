import type { ElkExtendedEdge, ElkNode, ElkPort } from "elkjs/lib/elk-api";
import type { ControlFlowEdge, ControlFlowNode } from "./control-flow-store";
import { filterFunctionRegistry } from "./filters/filter-function-registry";

// Auto layout of the flow editor. Nodes connected by edges form a cluster
// (e.g. axis → Rescale → Smooth → steering); every cluster is laid out top
// down with ELK "layered" (gamepad inputs first, vehicle outputs last, ports
// at the same spots as the node handles), unconnected nodes are packed into
// one extra cluster, and the clusters are placed in rows.

export type Size = { width: number; height: number };
export type Point = { x: number; y: number };

export type FlowCluster = {
  /** Vehicle channels, else HUD signals, else gamepad inputs, else functions of the cluster. */
  title: string;
  nodeIds: number[];
  unconnected: boolean;
};

export type FlowLayout = { positions: Record<number, Point>; clusters: FlowCluster[] };

/** The part of an ELK instance used here (elkjs/lib/elk.bundled.js). */
export type ElkLike = { layout(graph: ElkNode): Promise<ElkNode> };

/** Space above the cluster content for the frame title. */
export const CLUSTER_TITLE_SPACE = 36;
export const CLUSTER_PADDING = 24;
const CLUSTER_GAP = 60;
const DEFAULT_SIZE: Size = { width: 180, height: 60 };

/** Input and output ports of a node, as the node renders its handles. */
export function nodePorts(node: ControlFlowNode): { inputs: string[]; outputs: string[] } {
  if (node.type === "input") return { inputs: [], outputs: ["out"] };
  if (node.type === "output") return { inputs: ["in"], outputs: [] };
  const def = filterFunctionRegistry[node.metadata?.functionName as keyof typeof filterFunctionRegistry];
  return { inputs: [...(def?.inputLabels ?? [])], outputs: [...(def?.outputLabels ?? [])] };
}

function clusterTitle(nodes: ControlFlowNode[]): string {
  const pick = (list: ControlFlowNode[], name: (n: ControlFlowNode) => string | undefined) =>
    [...new Set(list.map(name).filter((s): s is string => !!s))].sort().join(", ");
  return pick(nodes.filter(n => n.type === "output"), n => n.label)
    || pick(nodes.filter(n => n.metadata?.functionName === "HudSignal"), n => String(n.params?.signal ?? "").trim() || undefined)
    || pick(nodes.filter(n => n.type === "input"), n => n.label)
    || pick(nodes, n => n.label);
}

/** Connected components of the flow; unconnected nodes are collected in the last cluster. */
export function flowClusters(nodes: ControlFlowNode[], edges: ControlFlowEdge[], unconnectedTitle: string): FlowCluster[] {
  const parent = new Map<number, number>(nodes.map(n => [n.nodeId, n.nodeId]));
  const find = (id: number): number => {
    let root = id;
    while (parent.get(root)! !== root) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };
  const linked = new Set<number>();
  for (const e of edges) {
    if (!parent.has(e.source) || !parent.has(e.target)) continue;
    linked.add(e.source).add(e.target);
    parent.set(find(e.source), find(e.target));
  }
  const groups = new Map<number, ControlFlowNode[]>();
  for (const n of nodes.filter(n => linked.has(n.nodeId))) {
    const root = find(n.nodeId);
    groups.set(root, [...(groups.get(root) ?? []), n]);
  }
  const clusters = [...groups.values()]
    .map(list => ({ title: clusterTitle(list), nodeIds: list.map(n => n.nodeId), unconnected: false }))
    .sort((a, b) => a.title.localeCompare(b.title));
  const rest = nodes.filter(n => !linked.has(n.nodeId)).map(n => n.nodeId);
  if (rest.length) clusters.push({ title: unconnectedTitle, nodeIds: rest, unconnected: true });
  return clusters;
}

const portId = (nodeId: number, dir: "in" | "out", port: string) => `${nodeId}:${dir}:${port}`;

function elkGraph(cluster: FlowCluster, nodes: ControlFlowNode[], edges: ControlFlowEdge[], sizes: Record<number, Size>): ElkNode {
  const members = new Set(cluster.nodeIds);
  const clusterEdges = edges.filter(e => members.has(e.source) && members.has(e.target));
  const children: ElkNode[] = nodes.filter(n => members.has(n.nodeId)).map(n => {
    const size = sizes[n.nodeId] ?? DEFAULT_SIZE;
    const { inputs, outputs } = nodePorts(n);
    // Ports used by edges but unknown to the definition still need a port.
    for (const e of clusterEdges) {
      if (e.target === n.nodeId && e.targetPort && !inputs.includes(e.targetPort)) inputs.push(e.targetPort);
      if (e.source === n.nodeId && e.sourcePort && !outputs.includes(e.sourcePort)) outputs.push(e.sourcePort);
    }
    const ports = (labels: string[], dir: "in" | "out"): ElkPort[] => labels.map((label, i) => ({
      id: portId(n.nodeId, dir, label),
      // Same spot as the handle: evenly spread over the top (inputs) or bottom (outputs) edge.
      x: size.width * (i + 1) / (labels.length + 1),
      y: dir === "in" ? 0 : size.height,
      width: 1,
      height: 1,
      layoutOptions: { "elk.port.side": dir === "in" ? "NORTH" : "SOUTH" },
    }));
    const layer = n.type === "input" || (n.metadata?.functionName === "HudInput" || n.metadata?.functionName === "Telemetry") ? "FIRST" : n.type === "output" || n.metadata?.functionName === "HudSignal" ? "LAST" : "NONE";
    return {
      id: String(n.nodeId),
      width: size.width,
      height: size.height,
      ports: [...ports(inputs, "in"), ...ports(outputs, "out")],
      layoutOptions: { "elk.portConstraints": "FIXED_POS", "elk.layered.layering.layerConstraint": layer },
    };
  });
  const elkEdges: ElkExtendedEdge[] = clusterEdges.map(e => {
    const source = nodes.find(n => n.nodeId === e.source)!;
    const target = nodes.find(n => n.nodeId === e.target)!;
    return {
      id: String(e.id),
      sources: [portId(e.source, "out", e.sourcePort ?? nodePorts(source).outputs[0] ?? "out")],
      targets: [portId(e.target, "in", e.targetPort ?? nodePorts(target).inputs[0] ?? "in")],
    };
  });
  const padding = `[top=${CLUSTER_TITLE_SPACE + CLUSTER_PADDING},left=${CLUSTER_PADDING},bottom=${CLUSTER_PADDING},right=${CLUSTER_PADDING}]`;
  const layoutOptions: Record<string, string> = cluster.unconnected
    ? { "elk.algorithm": "rectpacking", "elk.spacing.nodeNode": "40", "elk.aspectRatio": "2.5", "elk.padding": padding }
    : {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.nodeNode": "50",
      // Room for the port labels above and below the nodes.
      "elk.layered.spacing.nodeNodeBetweenLayers": "80",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      "elk.padding": padding,
    };
  return { id: "root", layoutOptions, children, edges: elkEdges };
}

/**
 * Positions for all nodes and their clusters. `sizes` are the measured node
 * sizes; `maxRowWidth` limits the width of a row of clusters.
 */
export async function layoutFlow(
  elk: ElkLike,
  nodes: ControlFlowNode[],
  edges: ControlFlowEdge[],
  sizes: Record<number, Size>,
  unconnectedTitle: string,
  maxRowWidth = 1800,
): Promise<FlowLayout> {
  const clusters = flowClusters(nodes, edges, unconnectedTitle);
  const laidOut = await Promise.all(clusters.map(c => elk.layout(elkGraph(c, nodes, edges, sizes))));
  const positions: Record<number, Point> = {};
  let x = 0, y = 0, rowHeight = 0;
  laidOut.forEach(graph => {
    const width = graph.width ?? 0;
    const height = graph.height ?? 0;
    if (x > 0 && x + width > maxRowWidth) {
      x = 0;
      y += rowHeight + CLUSTER_GAP;
      rowHeight = 0;
    }
    for (const child of graph.children ?? []) positions[Number(child.id)] = { x: x + (child.x ?? 0), y: y + (child.y ?? 0) };
    x += width + CLUSTER_GAP;
    rowHeight = Math.max(rowHeight, height);
  });
  return { positions, clusters };
}

/** Frame of a cluster around the current node positions (follows dragged nodes). */
export function clusterFrame(cluster: FlowCluster, positions: Record<number, Point | undefined>, sizes: Record<number, Size>): { x: number; y: number; width: number; height: number } | undefined {
  const boxes = cluster.nodeIds
    .filter(id => positions[id])
    .map(id => ({ ...positions[id]!, ...(sizes[id] ?? DEFAULT_SIZE) }));
  if (!boxes.length) return undefined;
  const left = Math.min(...boxes.map(b => b.x)) - CLUSTER_PADDING;
  const top = Math.min(...boxes.map(b => b.y)) - CLUSTER_PADDING - CLUSTER_TITLE_SPACE;
  const right = Math.max(...boxes.map(b => b.x + b.width)) + CLUSTER_PADDING;
  const bottom = Math.max(...boxes.map(b => b.y + b.height)) + CLUSTER_PADDING;
  return { x: left, y: top, width: right - left, height: bottom - top };
}
