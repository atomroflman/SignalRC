// Signal names of the driver's HUD-Signal flow nodes (D37) for the overlay
// editor: offered in the binding picker and the signals panel. Read only; the
// flow is never recalculated here.
import { hudSignalName, type FlowNodeLike } from "./control-display-binding";

export function flowSignalNames(nodes: readonly FlowNodeLike[]): string[] {
  const names = new Set<string>();
  for (const node of nodes) {
    const name = hudSignalName(node);
    if (name !== undefined) names.add(name);
  }
  return [...names].sort();
}

/** Loads the user's flow of a car (GET userconfig/setup → GET flow) and returns its signal names. */
export async function loadFlowSignalNames(carId: number, fetchJson: (url: string) => Promise<unknown>): Promise<string[]> {
  const setup = (await fetchJson(`/api/userconfig/setup/${carId}`)) as { id?: number } | null;
  if (typeof setup?.id !== "number") return [];
  const flow = (await fetchJson(`/api/flow/${setup.id}`)) as { nodes?: FlowNodeLike[] } | null;
  return flowSignalNames(flow?.nodes ?? []);
}
