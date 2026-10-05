import React from "react";
import { Handle, Position, NodeProps } from "reactflow";
import { filterFunctionRegistry } from "./filters/filter-function-registry";
import { useControlFlowStore } from "./control-flow-store";
import { CustomFlowNodeProps } from "./custom-flow-node";
import { ParamInput } from "./param-input";
import { useI18n } from "@/i18n/provider";

export default function GearboxFlowNode(props: CustomFlowNodeProps) {
  const { messages } = useI18n();
  // Umfassender Null-Check für props und props.data
  if (!props || !props.data) {
    console.warn('GearboxFlowNode: props oder props.data ist null/undefined', { props });
    return <div className="bg-zinc-800 border border-zinc-700 rounded p-2">{messages.flowNode.loading}</div>;
  }

  const id = props.data.nodeId;
  const flowControl = useControlFlowStore();
  
  // Verwende den globalen State direkt statt lokalen State
  const data = flowControl.nodes.find((n) => n.nodeId == id);

  // Parameter-Änderung
  const handleParamChange = (key: string, value: any) => {
    if (!data) return;
    
    const newParams = { ...data.params, [key]: value };
    flowControl.updateNodeParams(props.data.nodeId, newParams);
  };

  if (!data?.metadata?.functionName || data.metadata.functionName !== 'Gearbox') {
    return null;
  }

  const definition = filterFunctionRegistry.Gearbox;
  const inputs = definition.inputLabels.map(e => e);
  const outputs = definition.outputLabels.map(e => e);
  const params = definition.params.map(p => ({ 
    name: p.name, 
    value: (data.params ?? {})[p.name] || p.default 
  }));

  // Get current gear state
  const outputValues = Array.isArray(data?.latestValue) ? data.latestValue : [data?.latestValue];
  const currentGear = outputValues[0] || 0;
  const gearValue = outputValues[1] || 0;
  const gearName = outputValues[2] || 'N';

  const gearNamesStr = params.find(p => p.name === 'gearNames')?.value || 'R,N,D';
  const gearNames = gearNamesStr.split(',').map((name: string) => name.trim());

  const inputHandles = inputs.map((label, index) => (
    <Handle
      key={`${label}`}
      type="target"
      position={Position.Top}
      id={`${label}`}
      style={{ left: `${100 / (inputs.length + 1) * (index + 1)}%`, top: "-4px" }}
      className="bg-green-500"
    >
      <span className="text-[8px] pt-1 text-center text-green-300 font-mono block" style={{marginLeft: -50 / (inputs.length + 1), width: 100 / (inputs.length + 1)}}>
        {label}
      </span>
    </Handle>
  ));

  const outputHandles = outputs.map((label, index) => (
    <Handle
      key={`${label}`}
      type="source"
      position={Position.Bottom}
      id={`${label}`}
      className="bg-blue-500"
      style={{ left: `${100 / (outputs.length + 1) * (index + 1)}%`, bottom: "-4px" }}
    >  
      <span className="text-[8px] text-blue-300 font-mono block" style={{ marginTop: -24, marginLeft: -4 }}>
        {label === 'currentGear' ? 'Gear' : 
         label === 'gearValue' ? 'Value' : 
         label === 'gearName' ? 'Name' : label}: {
          label === 'currentGear' ? currentGear :
          label === 'gearValue' ? Number(gearValue).toFixed(2) :
          label === 'gearName' ? gearName :
          outputValues[index] !== undefined ? Number(outputValues[index]).toFixed(3) : ''
        }
      </span>
    </Handle>
  ));

  return (
    <div className="bg-zinc-800 border border-zinc-700 rounded p-2 pt-3 pb-6 flex flex-col min-w-[180px] relative">
      <div className="flex items-center justify-between mb-2">
        <span className="truncate text-xs font-mono font-bold text-yellow-300">Gearbox</span>
        <button
          className="ml-2 px-1 py-0.5 bg-red-900 hover:bg-red-800 text-red-100 rounded text-[10px] border border-red-800 transition-colors duration-150"
          onClick={() => flowControl.deleteNode(Number(id))}
          title={messages.flowNode.deleteNode}
        >
          ✕
        </button>
      </div>

      {/* Gear Indicator */}
      <div className="flex justify-center gap-1 mb-2">
        {gearNames.map((name: string, index: number) => (
          <div
            key={index}
            className={`px-2 py-1 rounded text-xs font-mono ${
              index === currentGear 
                ? 'bg-yellow-600 text-yellow-100 border border-yellow-500' 
                : 'bg-zinc-700 text-zinc-400 border border-zinc-600'
            }`}
          >
            {name}
          </div>
        ))}
      </div>

      {/* Parameters */}
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
