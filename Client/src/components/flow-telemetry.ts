// Feeds the flow's Telemetry nodes from the shared live sources, so that a
// vehicle value (a GPIO input, a PWM readback, a temperature …) can drive the
// flow like a gamepad axis. Runs in the driver's browser, like the whole flow:
// a value takes one telemetry interval plus the round trip to reach a vehicle
// output. Safety-relevant reactions (end stops, e-stop) belong on the vehicle.
import { sharedSourceHub, type QualifiedValue } from "./overlay/sources";
import { telemetryInputValues, telemetryNumber } from "./filters/TelemetryFunction";

export const TELEMETRY_FUNCTION = "Telemetry";

interface FlowNodeLike {
  nodeId: number;
  nodeTypeName: string;
  metadata?: { functionName: string };
  params?: Record<string, any>;
}

interface FlowStoreLike {
  getState(): { carId: number | undefined; nodes: FlowNodeLike[]; recalculateNode(nodeId: number): void };
  subscribe(listener: (state: any, prev: any) => void): () => void;
}

/** The channel a Telemetry node reads, or undefined for other nodes / an empty name. */
export function telemetryChannelOf(node: FlowNodeLike): string | undefined {
  if (node.nodeTypeName !== "UserSetupFunctionNode" || node.metadata?.functionName !== TELEMETRY_FUNCTION) return undefined;
  const name = node.params?.channel;
  return typeof name === "string" && name.trim() ? name.trim() : undefined;
}

/** Node value of a source value: valid and unchecked count, invalid does not. */
export function nodeValue(v: QualifiedValue | undefined): { value: number; valid: boolean } {
  if (!v || v.state === "invalid") return { value: 0, valid: false };
  return { value: telemetryNumber(v.value), valid: true };
}

/** Starts the binding; returns a stop function. Call once per store. */
export function bindFlowTelemetry(store: FlowStoreLike): () => void {
  let car: { carId: number; release(): void; provider: ReturnType<ReturnType<typeof sharedSourceHub>["acquire"]>["provider"] } | null = null;
  let requirement: { release(): void; source: { get(kind: "tel", name: string): QualifiedValue } } | null = null;
  let unsubscribeSource: (() => void) | null = null;
  let signature = "";

  const nodesByChannel = () => {
    const map = new Map<string, number[]>();
    for (const node of store.getState().nodes) {
      const channel = telemetryChannelOf(node);
      if (!channel) continue;
      map.set(channel, [...(map.get(channel) ?? []), node.nodeId]);
    }
    return map;
  };

  const push = () => {
    if (!requirement) return;
    const state = store.getState();
    for (const [channel, nodeIds] of nodesByChannel()) {
      const next = nodeValue(requirement.source.get("tel", channel));
      for (const nodeId of nodeIds) {
        const prev = telemetryInputValues.get(nodeId);
        if (prev && prev.value === next.value && prev.valid === next.valid) continue;
        telemetryInputValues.set(nodeId, next);
        state.recalculateNode(nodeId);
      }
    }
  };

  const release = () => {
    unsubscribeSource?.();
    unsubscribeSource = null;
    requirement?.release();
    requirement = null;
    car?.release();
    car = null;
  };

  const sync = () => {
    if (typeof window === "undefined") return;
    const { carId } = store.getState();
    const channels = [...nodesByChannel().keys()].sort();
    const next = carId && channels.length > 0 ? `${carId}|${channels.join("\n")}` : "";
    if (next === signature) return;
    signature = next;
    if (!next || !carId) { release(); return; }
    if (!car || car.carId !== carId) {
      release();
      const acquired = sharedSourceHub().acquire(carId);
      car = { carId, ...acquired };
    }
    requirement?.release();
    requirement = car.provider.require("flow-telemetry", channels.map(name => ({ kind: "tel" as const, name })));
    unsubscribeSource ??= car.provider.subscribe(push);
    push();
  };

  const unsubscribeStore = store.subscribe((state, prev) => {
    if (state.nodes !== prev.nodes || state.carId !== prev.carId) sync();
  });
  sync();
  return () => { unsubscribeStore(); release(); signature = ""; };
}
