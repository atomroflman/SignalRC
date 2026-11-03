import ELK from "elkjs/lib/elk.bundled.js";
import { describe, expect, it } from "vitest";
import type { ControlFlowEdge, ControlFlowNode } from "./control-flow-store";
import { clusterFrame, flowClusters, layoutFlow, type Size } from "./flow-layout";

const node = (nodeId: number, type: string, label: string, functionName?: string): ControlFlowNode => ({
  nodeId, type, label, data: {}, position: { x: 0, y: 0 }, nodeTypeName: "",
  metadata: functionName ? { functionName } : undefined, params: {},
});
const edge = (id: number, source: number, sourcePort: string, target: number, targetPort: string): ControlFlowEdge =>
  ({ id, source, sourcePort, target, targetPort });

// Steering: axis → Rescale → Smooth → steering; light: button → Toggle → light; one loose Abs.
const nodes = [
  node(1, "input", "Axis 1"), node(2, "default", "Rescale", "Rescale"), node(3, "default", "Smooth", "Smooth"), node(4, "output", "steering"),
  node(5, "input", "Button 1"), node(6, "default", "Toggle", "Toggle"), node(7, "output", "light"),
  node(8, "default", "Abs", "Abs"),
];
const edges = [
  edge(1, 1, "out", 2, "input"), edge(2, 2, "output", 3, "input"), edge(3, 3, "output", 4, "in"),
  edge(4, 5, "out", 6, "input"), edge(5, 6, "Out", 7, "in"),
];
const sizes: Record<number, Size> = Object.fromEntries(nodes.map(n => [n.nodeId, { width: 180, height: n.type === "default" ? 120 : 40 }]));

describe("flow auto layout", () => {
  it("groups connected nodes into clusters named after their vehicle channels", () => {
    expect(flowClusters(nodes, edges, "loose")).toEqual([
      { title: "light", nodeIds: [5, 6, 7], unconnected: false },
      { title: "steering", nodeIds: [1, 2, 3, 4], unconnected: false },
      { title: "loose", nodeIds: [8], unconnected: true },
    ]);
  });

  it("lays every chain out top down and keeps nodes and cluster frames apart", async () => {
    const { positions, clusters } = await layoutFlow(new ELK(), nodes, edges, sizes, "loose");
    const chain = [1, 2, 3, 4].map(id => positions[id].y);
    expect([...chain].sort((a, b) => a - b)).toEqual(chain);
    expect(positions[5].y).toBeLessThan(positions[6].y);
    const boxes = nodes.map(n => ({ ...positions[n.nodeId], ...sizes[n.nodeId] }));
    for (const a of boxes) for (const b of boxes) {
      if (a === b) continue;
      const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
      expect(overlap).toBe(false);
    }
    const frames = clusters.map(c => clusterFrame(c, positions, sizes)!);
    for (let i = 0; i < frames.length; i++) for (let j = i + 1; j < frames.length; j++) {
      const [a, b] = [frames[i], frames[j]];
      expect(a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height).toBe(false);
    }
  });
});
