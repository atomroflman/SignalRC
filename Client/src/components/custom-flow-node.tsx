import React from "react";
import { Handle, Position, NodeProps } from "reactflow";
import { filterFunctionRegistry } from "./filters/filter-function-registry";
import { useControlFlowStore } from "./control-flow-store";
import FloatValueFlowNode from "./float-value-flow-node";
import GearboxFlowNode from "./gearbox-flow-node";
import IifFlowNode from "./iif-flow-node";
import SmoothFlowNode from "./smooth-flow-node";
import { ParamInput } from "./param-input";
import { flowNodeStyles, handleOffset } from "./flow-node-styles";
import { FlowNodeHeader } from "./flow-node-header";
import { useI18n } from "@/i18n/provider";
import { hudSignalProblem as findHudSignalProblem } from "./overlay/integration/control-display-binding";
import { hudInputProblem as findHudInputProblem } from "./overlay/integration/hud-input";

export type CustomFlowNodeProps = NodeProps & {
  data: any;
  handleParamChange: (key: string, value: any) => void;
};

// Specialized node renderers keyed by function name. Add new ones here
// instead of growing the if-chain in CustomFlowNode below.
const SPECIALIZED_NODES: Record<string, React.ComponentType<CustomFlowNodeProps>> = {
  FloatValue: FloatValueFlowNode,
  Gearbox: GearboxFlowNode,
  Iif: IifFlowNode,
  Smooth: SmoothFlowNode,
};

/** Node kinds that are not filter functions. */
const CHANNEL_TYPES = ["input", "output", "vehicleInput", "handoff"];

/**
 * Frame showing the node's zone (OnboardFlow-Arbeitspakete.md OF10): vehicle nodes get an
 * amber ring and badge; functions and vehicle channels can move to the other zone; browser
 * vehicle channels are marked as not available locally once the flow has a vehicle part (E07).
 */
function ZoneFrame({ node, children }: { node: any; children: React.ReactNode }) {
  const { messages } = useI18n();
  const t = messages.onboardFlow;
  const hasOnboardPart = useControlFlowStore(s => s.nodes.some(n => n.zone === "onboard"));
  const setNodeZone = useControlFlowStore(s => s.setNodeZone);
  if (!node) return <>{children}</>;
  const onboard = node.zone === "onboard";
  const movable = node.nodeTypeName === "UserSetupFunctionNode" || node.nodeTypeName === "UserSetupCarChannelNode";
  const move = async () => {
    const error = await setNodeZone(node.nodeId, onboard ? "browser" : "onboard");
    if (error) alert(error);
  };
  return (
    <div className={onboard ? "relative rounded-lg ring-2 ring-amber-500/80" : "relative rounded-lg"}>
      {(onboard || movable || (hasOnboardPart && node.type === "output")) && (
        <div className="absolute -top-5 left-0 flex items-center gap-1 text-[10px] whitespace-nowrap">
          {onboard && <span className="px-1 rounded bg-amber-700 text-amber-50">{t.onboardBadge}</span>}
          {!onboard && hasOnboardPart && node.type === "output" && (
            <span className="px-1 rounded bg-zinc-700 text-zinc-300">{t.localUnavailable}</span>
          )}
          {movable && (
            <button
              className="nodrag px-1 rounded bg-zinc-800 border border-zinc-600 text-zinc-300 hover:bg-zinc-700"
              title={onboard ? t.moveToBrowser : t.moveToOnboard}
              onClick={move}
            >
              {onboard ? "→ " + t.zoneBrowser : "→ " + t.zoneOnboard}
            </button>
          )}
        </div>
      )}
      {children}
    </div>
  );
}

export default function CustomFlowNode(props: NodeProps) {
  const data = useControlFlowStore(s => s.nodes.find(n => n.nodeId == props?.data?.nodeId));
  return (
    <ZoneFrame node={data}>
      <CustomFlowNodeContent {...props} />
    </ZoneFrame>
  );
}

function CustomFlowNodeContent(props: NodeProps) {
  const { messages } = useI18n();
  if (!props || !props.data) {
    console.warn('CustomFlowNode: props oder props.data ist null/undefined', { props });
    return <div className={flowNodeStyles.card}>{messages.flowNode.loading}</div>;
  }

  const id = props.data.nodeId;
  const flowControl = useControlFlowStore();
  
  // Get data directly from store
  const data = flowControl.nodes.find((n) => n.nodeId == id);

  // Parameter-Änderung - use React.useCallback to prevent recreation on every render
  const handleParamChange = React.useCallback((key: string, value: any) => {
    if (!flowControl.nodes) 
      return;
    console.log(props.data.nodeId, key, value,  flowControl.nodes);
    const nodeData = flowControl.nodes.find(n => n.nodeId == props.data.nodeId);
    if (!nodeData) 
      return;
    const newParams = { ...nodeData.params, [key]: value };
    const updatedNode = { ...nodeData, params: newParams };
    flowControl.updateNodeParams(props.data.nodeId, newParams);
    const updatedNodes = flowControl.nodes.map(n => n.nodeId === props.data.nodeId ? updatedNode : n);
    flowControl.setNodes(updatedNodes);
  }, [props.data.nodeId, flowControl]);

  const deleteNode = () => flowControl.deleteNode(Number(id));
  // A node whose function is unknown can only be deleted.
  const brokenNode = (text: string) => (
    <div className={`${flowNodeStyles.card} min-w-[160px]`}>
      <FlowNodeHeader title={data?.label ?? "?"} onDelete={deleteNode} />
      <div className={`${flowNodeStyles.body} text-xs text-red-300`}>{text}</div>
    </div>
  );

  // Resolve known function names with their respective components
  if (data?.metadata?.functionName) {
    const Specialized = SPECIALIZED_NODES[data.metadata.functionName];
    if (Specialized) {
      return <Specialized {...props} handleParamChange={handleParamChange} data={data} />;
    }
  }

  // Memoize inputs, outputs, and params to prevent unnecessary re-renders
  const { inputs, outputs, params } = React.useMemo(() => {
    let inputs = [] as string[];
    let outputs = [] as string[];
    let params = [] as { name: string; value: string | number }[];
    
    if (data?.type === "input") {
      outputs.push("out");
    } else if (data?.type === "output") {
      inputs.push("in");
    } else if (data?.type === "vehicleInput") {
      outputs.push("value", "connected");
    } else if (data?.type === "handoff") {
      inputs.push("in");
      outputs.push("value", "connected");
    } else {
      if (data?.metadata?.functionName) {
        const definition = filterFunctionRegistry[data?.metadata?.functionName as keyof typeof filterFunctionRegistry];
        if (definition) {
          inputs = definition.inputLabels.map(e => e);
          outputs = definition.outputLabels.map(e => e);
          params = definition.params.map(p => ({ name: p.name, value: (data.params ?? [])[p.name] || p.default }));
        }
      }
    }
    
    return { inputs, outputs, params };
  }, [data?.type, data?.metadata?.functionName, JSON.stringify(data?.params)]);
  
  // Check for undefined function after useMemo
  const isChannel = CHANNEL_TYPES.includes(data?.type ?? "");
  if (!isChannel && !data?.metadata?.functionName) {
    return brokenNode("undefined!");
  }
  if (!isChannel && data?.metadata?.functionName) {
    const definition = filterFunctionRegistry[data?.metadata?.functionName as keyof typeof filterFunctionRegistry];
    if (!definition) {
      return brokenNode(messages.flowNode.functionNotFound);
    }
  }
  
  const outputValues = Array.isArray(data?.latestValue) ? data.latestValue : [data?.latestValue];
  const inputHandles = inputs.map((label, index) => (
    <Handle
      key={`${label}`}
      type="target"
      position={Position.Top}
      id={`${label}`}
      style={handleOffset(index, inputs.length)}
    >
      <span className={flowNodeStyles.inputLabel}>{label}</span>
    </Handle>
  ));
  const outputHandles = outputs.map((label, index) => (
      <Handle
        key={`${label}`}
        type="source"
        position={Position.Bottom}
        id={`${label}`}
        style={handleOffset(index, outputs.length)}
      >
        <span className={flowNodeStyles.outputLabel}>
          {label}: {outputValues[index] !== undefined ? Number(outputValues[index]).toFixed(3) : ''}
        </span>
      </Handle>
  ));

  // HUD-Signal (D37): one node per signal; a missing or doubled mapping makes it unavailable.
  const problem = data ? findHudSignalProblem(data, flowControl.nodes) : undefined;
  const inputProblem = data ? findHudInputProblem(data) : undefined;
  const hudSignalProblem = problem ? {
    missing: messages.overlay.flowNode.hudSignalMissing,
    invalid: messages.overlay.flowNode.hudSignalInvalid,
    duplicate: messages.overlay.flowNode.hudSignalDuplicate,
  }[problem] : inputProblem ? {
    missing: messages.overlay.flowNode.hudInputMissing,
    invalid: messages.overlay.flowNode.hudSignalInvalid,
  }[inputProblem] : undefined;

  return (
    <div className={`${flowNodeStyles.card} min-w-[180px]`}>
      <FlowNodeHeader
        title={data?.label}
        docKey={CHANNEL_TYPES.includes(data?.type ?? "") ? data!.type : data?.metadata?.functionName}
        value={Array.isArray(data?.latestValue)
          ? data.latestValue.map((v: number) => Number(v).toFixed(3)).join(", ")
          : Number(data?.latestValue ?? 0).toFixed(3)}
        onDelete={deleteNode}
      />

      {(params.length > 0 || hudSignalProblem) && (
        <div className={`${flowNodeStyles.body} gap-1.5`}>
          {params.map((e) => (
            <ParamInput
              key={e.name}
              name={e.name}
              value={e.value}
              onBlur={handleParamChange}
            />
          ))}
          {hudSignalProblem && <div className="text-[11px] text-red-300">{hudSignalProblem}</div>}
        </div>
      )}

      {inputHandles}
      {outputHandles}
    </div>
  );
}
