// Names from the driver's flow for the overlay editor: HUD-Signal nodes (D37),
// offered in the binding picker and the signals panel, and HUD-Eingabe nodes
// (D75), offered for clickable elements. Read only; the flow is never
// recalculated here.
import { hudSignalName, type FlowNodeLike } from "./control-display-binding";
import { hudInputName } from "./hud-input";

export function flowSignalNames(nodes: readonly FlowNodeLike[]): string[] {
  const names = new Set<string>();
  for (const node of nodes) {
    const name = hudSignalName(node);
    if (name !== undefined) names.add(name);
  }
  return [...names].sort();
}

export function flowInputNames(nodes: readonly FlowNodeLike[]): string[] {
  return [...new Set(nodes.map(hudInputName).filter((n): n is string => n !== undefined))].sort();
}

/** Loads the user's flow of a car (GET userconfig/setup → GET flow) and returns its HUD signal and HUD input names. */
export async function loadFlowNames(carId: number, fetchJson: (url: string) => Promise<unknown>): Promise<{ signals: string[]; inputs: string[] }> {
  const setup = (await fetchJson(`/api/userconfig/setup/${carId}`)) as { id?: number } | null;
  if (typeof setup?.id !== "number") return { signals: [], inputs: [] };
  const flow = (await fetchJson(`/api/flow/${setup.id}`)) as { nodes?: FlowNodeLike[] } | null;
  const nodes = flow?.nodes ?? [];
  return { signals: flowSignalNames(nodes), inputs: flowInputNames(nodes) };
}
