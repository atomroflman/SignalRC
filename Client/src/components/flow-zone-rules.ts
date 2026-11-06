import type { ControlFlowNode } from "./control-flow-store";

// Client copy of Server/Services/FlowZoneRules.cs (OnboardFlow-Arbeitspakete.md T03):
// checked while dragging a connection; the server decides.
type Side = "browser" | "handoff" | "onboard";

export function flowSide(node: Pick<ControlFlowNode, "zone" | "nodeTypeName">): Side {
  if (node.nodeTypeName === "UserSetupHandoffNode") return "handoff";
  return node.zone === "onboard" ? "onboard" : "browser";
}

const ALLOWED = new Set(["browser>browser", "browser>handoff", "handoff>onboard", "onboard>onboard"]);

/** Whether a connection from → to is allowed: top-down only, inputs never targets, vehicle channels never sources. */
export function isAllowedLink(from: ControlFlowNode | undefined, to: ControlFlowNode | undefined): boolean {
  if (!from || !to || from.nodeId === to.nodeId) return false;
  if (to.type === "input" || to.type === "vehicleInput") return false;
  if (from.type === "output") return false;
  return ALLOWED.has(`${flowSide(from)}>${flowSide(to)}`);
}

/**
 * Zone a port belongs to, for its colour (web blue, vehicle orange): the handoff takes the
 * web value in and gives it out in the vehicle; controllers of the vehicle are vehicle side.
 */
export function portZone(node: Pick<ControlFlowNode, "zone" | "nodeTypeName" | "type"> | undefined, port: "source" | "target"): "browser" | "onboard" {
  if (!node) return "browser";
  if (node.nodeTypeName === "UserSetupHandoffNode") return port === "target" ? "browser" : "onboard";
  if (node.type === "vehicleInput") return "onboard";
  return node.zone === "onboard" ? "onboard" : "browser";
}
