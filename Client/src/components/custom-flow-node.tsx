import React from "react";
import { Handle, Position, NodeProps } from "reactflow";
import { filterFunctionRegistry } from "./filters/filter-function-registry";
import { useControlFlowStore } from "./control-flow-store";
import FloatValueFlowNode from "./float-value-flow-node";
import GearboxFlowNode from "./gearbox-flow-node";
import IifFlowNode from "./iif-flow-node";
import SmoothFlowNode from "./smooth-flow-node";
import { ParamInput } from "./param-input";
import { useI18n } from "@/i18n/provider";

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
    return <div className="bg-zinc-800 border border-zinc-700 rounded p-2">{messages.flowNode.loading}</div>;
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
          className="ml-2 px-1 py-0.5 bg-red-900 hover:bg-red-800 text-red-100 rounded text-[10px] border border-red-800 transition-colors duration-150"
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
      style={{ left: `${100 / (inputs.length + 1) * (index + 1)}%`, top: "-4px" }}
      className="bg-green-500"
    >
      <span className="text-[8px] pt-1 text-center text-green-300 font-mono block" style={{marginLeft: -50 / (inputs.length + 1), width: 100 / (inputs.length + 1)}}>{label}</span>
    </Handle>
  ));
  const outputHandles = outputs.map((label, index) => (
      <Handle
        type="source"
        position={Position.Bottom}
        id={`${label}`}
        className="bg-blue-500"
        style={{ left: `${100 / (outputs.length + 1) * (index + 1)}%`, bottom: "-4px" }}
      >  
        <span className="text-[8px] text-blue-300 font-mono block" style={{ marginTop: -24, marginLeft: -4 }}>
          {label}: {outputValues[index] !== undefined ? Number(outputValues[index]).toFixed(3) : ''}
        </span>
      </Handle>
  ));

  return (
    <div className="bg-zinc-800 border border-zinc-700 rounded p-2 pt-3 pb-6 flex flex-col min-w-[140px] relative">
      <div className="flex items-center justify-between">
        <span className="truncate text-xs font-mono">{data?.label}</span>
        <span className="truncate text-xs font-mono">
          {Array.isArray(data?.latestValue)
            ? data.latestValue.map((v: number) => Number(v).toFixed(3)).join(", ")
            : Number(data?.latestValue ?? '').toFixed(3)}
        </span>
        {removeButton()}
      </div>
      
      {params && (
        <div className="flex flex-col gap-1 mt-1">
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

      {inputHandles}
      {outputHandles}
    </div>
  );
}
