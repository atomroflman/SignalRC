// AP13 – feeds the driver's computed flow values to the control display
// (Shared/Overlay/telemetry/README.md §7, D07–D09, D36, D37, D57). Only reads
// the flow store: it never recalculates a node, never calls sendOutput and
// never changes updatesEnabled / config mode.
import type { ControlDisplayPort, LocalControlSource } from "../sources/control-display";
import type { HubLike } from "../sources/hub";

/** Function name of the flow node "HUD-Signal" (D37). */
export const HUD_SIGNAL_FUNCTION = "HudSignal";
/** Its only input port. */
export const HUD_SIGNAL_INPUT = "value";

/** The parts of the control flow store read here (control-flow-store.ts). */
export interface FlowNodeLike {
  nodeId: number;
  nodeTypeName: string;
  representingId?: number;
  metadata?: { functionName?: string } | null;
  params?: Record<string, unknown> | null;
}

export interface FlowEdgeLike {
  source: number;
  target: number;
  targetPort?: string | null;
}

export interface FlowSnapshot {
  nodes: FlowNodeLike[];
  edges: FlowEdgeLike[];
  nodeLatestValues: Record<string, number>;
  updatesEnabled: boolean;
  isInConfigMode: boolean;
}

export interface ControlDisplayValues {
  /** CarChannel.Id → computed output value. */
  outputs: Map<number, number>;
  /** Signal name → value of its HUD-Signal node. */
  signals: Map<string, number>;
  /** Signals mapped by more than one node: not available (D37). */
  duplicateSignals: string[];
}

/** `paused = !updatesEnabled || isInConfigMode` (§7). */
export const isPaused = (s: Pick<FlowSnapshot, "updatesEnabled" | "isInConfigMode">) => !s.updatesEnabled || s.isInConfigMode;

/** The signal name a HUD-Signal node is mapped to, or undefined. */
export function hudSignalName(node: FlowNodeLike): string | undefined {
  if (node.nodeTypeName !== "UserSetupFunctionNode" || node.metadata?.functionName !== HUD_SIGNAL_FUNCTION) return undefined;
  const name = node.params?.signal;
  return typeof name === "string" && name.trim() !== "" ? name.trim() : undefined;
}

/**
 * Display values of the current flow state. Outputs are the values computed
 * for vehicle channel nodes (also while sending is paused); a channel node or
 * HUD-Signal node without an incoming edge has no value. Nothing is computed.
 */
export function collectControlDisplay(snapshot: FlowSnapshot): ControlDisplayValues {
  const fed = new Set(snapshot.edges.map((e) => e.target));
  const fedSignal = new Set(snapshot.edges.filter((e) => (e.targetPort ?? HUD_SIGNAL_INPUT) === HUD_SIGNAL_INPUT).map((e) => e.target));
  const value = (nodeId: number) => {
    const v = snapshot.nodeLatestValues[nodeId];
    return typeof v === "number" && Number.isFinite(v) ? v : undefined;
  };
  const outputs = new Map<number, number>();
  const signals = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const node of snapshot.nodes) {
    if (node.nodeTypeName === "UserSetupCarChannelNode") {
      const v = value(node.nodeId);
      if (node.representingId != null && fed.has(node.nodeId) && v !== undefined) outputs.set(node.representingId, v);
      continue;
    }
    const name = hudSignalName(node);
    if (name === undefined) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
    const v = value(node.nodeId);
    if (fedSignal.has(node.nodeId) && v !== undefined) signals.set(name, v);
  }
  const duplicateSignals = [...counts].filter(([, n]) => n > 1).map(([name]) => name).sort();
  for (const name of duplicateSignals) signals.delete(name);
  return { outputs, signals, duplicateSignals };
}

/** Applies display values to the port as differences (the publisher coalesces and rate-limits). */
export class ControlDisplayFeed {
  private outputs = new Map<number, number>();
  private signals = new Map<string, number>();
  private paused: boolean | undefined;

  constructor(private readonly port: ControlDisplayPort) {}

  apply(values: Pick<ControlDisplayValues, "outputs" | "signals">, paused: boolean) {
    if (paused !== this.paused) {
      this.paused = paused;
      this.port.setPaused(paused);
    }
    for (const id of this.outputs.keys()) if (!values.outputs.has(id)) this.port.removeOutput(id);
    for (const [id, v] of values.outputs) if (this.outputs.get(id) !== v) this.port.setOutput(id, v);
    for (const name of this.signals.keys()) if (!values.signals.has(name)) this.port.removeSignal(name);
    for (const [name, v] of values.signals) if (this.signals.get(name) !== v) this.port.setSignal(name, v);
    this.outputs = new Map(values.outputs);
    this.signals = new Map(values.signals);
  }
}

/** The control flow store as far as the binding uses it (zustand StoreApi). */
export interface FlowStoreLike<S extends FlowSnapshot & ControlKey = FlowSnapshot & ControlKey> {
  getState(): S;
  subscribe(listener: (state: S) => void): () => void;
}

export interface ControlKey {
  /** The connection that acquired control (control-flow-store `connection`). */
  connection?: HubLike | null;
  carId?: number;
  carSession?: string;
}

export interface PublisherLike extends ControlDisplayPort, LocalControlSource {
  controlEnded(): void;
  dispose(): void;
}

export interface BindingDeps {
  createPublisher(hub: HubLike, carId: number): PublisherLike;
  /** The vehicle's shared source provider; the driver's HUD reads the local values (§7). */
  acquireProvider(carId: number): { provider: { setLocalControlSource(local: LocalControlSource | undefined): void }; release(): void };
}

/**
 * While this client holds control of a vehicle (connection, carId and
 * carSession set), a publisher runs on the controlling connection and is fed
 * from the flow store; on release, loss or vehicle change it ends.
 */
export function bindControlDisplay(store: FlowStoreLike, deps: BindingDeps): () => void {
  let active: { connection: HubLike; carId: number; carSession: string; publisher: PublisherLike; feed: ControlDisplayFeed; release(): void } | undefined;

  const end = () => {
    const a = active;
    active = undefined;
    if (!a) return;
    a.publisher.controlEnded();
    a.release();
    a.publisher.dispose();
  };

  const update = (state: FlowSnapshot & ControlKey) => {
    const { connection, carId, carSession } = state;
    const holds = !!connection && typeof carId === "number" && !!carSession;
    if (active && (!holds || active.connection !== connection || active.carId !== carId || active.carSession !== carSession)) end();
    if (holds && !active) {
      const publisher = deps.createPublisher(connection!, carId!);
      const car = deps.acquireProvider(carId!);
      car.provider.setLocalControlSource(publisher);
      active = {
        connection: connection!, carId: carId!, carSession: carSession!, publisher, feed: new ControlDisplayFeed(publisher),
        release: () => {
          car.provider.setLocalControlSource(undefined);
          car.release();
        },
      };
    }
    if (active) active.feed.apply(collectControlDisplay(state), isPaused(state));
  };

  update(store.getState());
  const unsubscribe = store.subscribe(update);
  return () => {
    unsubscribe();
    end();
  };
}
