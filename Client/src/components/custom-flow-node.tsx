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
import { useI18n } from "@/i18n/provider";
import { hudSignalProblem as findHudSignalProblem } from "./overlay/integration/control-display-binding";

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

export default function CustomFlowNode(props: NodeProps) {
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

  function removeButton() {
    return (
    <button
          className={flowNodeStyles.deleteButton}
          onClick={() => flowControl.deleteNode(Number(id))}
          title={messages.flowNode.deleteNode}
        >
          ✕
        </button>
    );
  }

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
  if (data?.type !== "input" && data?.type !== "output" && !data?.metadata?.functionName) {
    return (<>undefined! {removeButton()}</>);
  }
  if (data?.type !== "input" && data?.type !== "output" && data?.metadata?.functionName) {
    const definition = filterFunctionRegistry[data?.metadata?.functionName as keyof typeof filterFunctionRegistry];
    if (!definition) {
      return (<>{messages.flowNode.functionNotFound} {removeButton()}</>);
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
  const hudSignalProblem = problem && {
    missing: messages.overlay.flowNode.hudSignalMissing,
    invalid: messages.overlay.flowNode.hudSignalInvalid,
    duplicate: messages.overlay.flowNode.hudSignalDuplicate,
  }[problem];

  return (
    <div className={`${flowNodeStyles.card} min-w-[160px]`}>
      <div className={params.length || hudSignalProblem ? flowNodeStyles.header : flowNodeStyles.headerBare}>
        <span className={flowNodeStyles.title}>{data?.label}</span>
        <span className={`${flowNodeStyles.headerValue} ml-auto`}>
          {Array.isArray(data?.latestValue)
            ? data.latestValue.map((v: number) => Number(v).toFixed(3)).join(", ")
            : Number(data?.latestValue ?? '').toFixed(3)}
        </span>
        {removeButton()}
      </div>
      
      {params.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {params.map((e) => (
            <ParamInput 
              key={e.name} 
              name={e.name} 
              value={e.value} 
              onBlur={handleParamChange}
            />
          ))}
        </div>
      )} 

      {hudSignalProblem && <div className="mt-2 text-[11px] text-red-300">{hudSignalProblem}</div>}

      {inputHandles}
      {outputHandles}
    </div>
  );
}
