import React from "react";
import { Handle, Position, NodeProps } from "reactflow";
import { filterFunctionRegistry } from "./filters/filter-function-registry";
import { useControlFlowStore } from "./control-flow-store";
import { CustomFlowNodeProps } from "./custom-flow-node";
import { ParamInput } from "./param-input";
import { useI18n } from "@/i18n/provider";
import { flowNodeStyles, handleOffset } from "./flow-node-styles";
import { FlowNodeHeader } from "./flow-node-header";

export default function GearboxFlowNode(props: CustomFlowNodeProps) {
  const { messages } = useI18n();
  // Umfassender Null-Check für props und props.data
  if (!props || !props.data) {
    console.warn('GearboxFlowNode: props oder props.data ist null/undefined', { props });
    return <div className={flowNodeStyles.card}>{messages.flowNode.loading}</div>;
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
      style={handleOffset(index, inputs.length)}
    >
      <span className={flowNodeStyles.inputLabel}>
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
      style={handleOffset(index, outputs.length)}
    >
      <span className={flowNodeStyles.outputLabel}>
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
    <div className={`${flowNodeStyles.card} min-w-[200px]`}>
      <FlowNodeHeader title="Gearbox" docKey="Gearbox" onDelete={() => flowControl.deleteNode(Number(id))} />
      <div className={flowNodeStyles.body}>
        {/* Gear Indicator */}
        <div className="flex justify-center gap-1 mb-2">
          {gearNames.map((name: string, index: number) => (
            <div
              key={index}
              className={`px-2 py-1 rounded text-xs font-mono border ${
                index === currentGear
                  ? 'bg-zinc-100 text-zinc-900 border-zinc-100 font-semibold'
                  : 'bg-zinc-900 text-zinc-300 border-zinc-700'
              }`}
            >
              {name}
            </div>
          ))}
        </div>

        {/* Parameters */}
        {params && (
          <div className="flex flex-col gap-1.5 pt-2 border-t border-zinc-700">
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
      </div>
      {inputHandles}
      {outputHandles}
    </div>
  );
}
