import { FilterFunctionDef, FilterFunctionParam, InputMap } from "./filter-function-registry";

// "Pulsieren": square wave between 0 and 1 at `rate` Hz (0 or less = off, capped at 25 Hz),
// `duty` = share of each period that is 1. Vehicle flow only (Server/Services/FlowZoneRules.cs):
// it needs the steady 50 Hz tick of the vehicle (Onboard/Flow/FlowFunctions.cs PulseFn); the
// browser only evaluates on changes and knows it for the editor and the reference cases.
const state = new Map<number, { phase: number; lastMs: number }>();

export class PulseFunction implements FilterFunctionDef<readonly ["rate"]> {
  name = "Pulse";
  label = "Pulsieren";
  params: FilterFunctionParam[] = [
    { name: "duty", label: "duty (share that is 1, 0…1)", type: "number", default: 0.5 },
  ];
  inputLabels = ["rate"];
  outputLabels = ["pulse"];

  apply(inputs: InputMap<readonly ["rate"]>, params: Record<string, any>, nodeId?: number) {
    const key = nodeId ?? -1;
    const st = state.get(key) ?? { phase: 0, lastMs: -1 };
    state.set(key, st);
    const rate = Math.min(Number(inputs.rate ?? 0), 25);
    const d = Number(params?.duty ?? 0.5);
    const duty = Number.isFinite(d) ? Math.min(1, Math.max(0, d)) : 0.5;
    const now = Date.now();
    if (!(rate > 0)) {
      st.phase = 0;
      st.lastMs = now;
      return [0];
    }
    if (st.lastMs >= 0) st.phase = Number((st.phase + Math.max(0, now - st.lastMs) / 1000 * rate).toFixed(9)) % 1;
    st.lastMs = now;
    return [st.phase < duty ? 1 : 0];
  }
}
