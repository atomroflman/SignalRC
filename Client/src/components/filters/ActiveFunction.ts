import { useControlFlowStore } from "../control-flow-store";
import { FilterFunctionDef, FilterFunctionParam, InputMap } from "./filter-function-registry";

const lastActive = new Map<number, number>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

/** Clock for tests. */
export const activeClock = { now: () => Date.now() };

// "Aktiv?" (OnboardFlow-Arbeitspakete.md OF02): 1 while |input| exceeds the threshold
// and for `hold` seconds after. Tells whether a source is being used, e.g. so that the
// local controller overrides the web (with "Vorrang"). Same in the onboard engine.
export class ActiveFunction implements FilterFunctionDef<readonly ["input"]> {
  name = "Active";
  label = "Aktiv?";
  params: FilterFunctionParam[] = [
    { name: "threshold", label: "Threshold", type: "number", default: 0.05 },
    { name: "hold", label: "Hold (s)", type: "number", default: 2 },
  ];
  inputLabels = ["input"];
  outputLabels = ["active"];

  apply(inputs: InputMap<readonly ["input"]>, params: Record<string, any>, nodeId?: number) {
    const now = activeClock.now();
    const rawThreshold = Number(params?.threshold ?? 0.05);
    const threshold = Number.isFinite(rawThreshold) ? Math.abs(rawThreshold) : 0.05;
    const rawHold = Number(params?.hold ?? 2);
    const hold = Number.isFinite(rawHold) && rawHold >= 0 ? rawHold : 2;
    const key = nodeId ?? -1;
    if (Math.abs(Number(inputs.input ?? 0)) > threshold) {
      lastActive.set(key, now);
      // Fall back to 0 after the hold time even without a new input.
      if (nodeId !== undefined && typeof window !== "undefined") {
        clearTimeout(timers.get(nodeId));
        timers.set(nodeId, setTimeout(() => useControlFlowStore.getState().recalculateNode(nodeId), hold * 1000 + 20));
      }
    }
    const last = lastActive.get(key);
    return [last !== undefined && now - last <= hold * 1000 ? 1 : 0];
  }
}
