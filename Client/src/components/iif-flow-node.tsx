import React from "react";
import { Handle, Position, NodeProps } from "reactflow";
import { filterFunctionRegistry } from "./filters/filter-function-registry";
import { useControlFlowStore } from "./control-flow-store";
import { CustomFlowNodeProps } from "./custom-flow-node";
import { useI18n } from "@/i18n/provider";
import { flowNodeStyles, handleOffset } from "./flow-node-styles";
import { FlowNodeHeader } from "./flow-node-header";

export default function IifFlowNode(props: CustomFlowNodeProps) {
  const { messages } = useI18n();
  // Umfassender Null-Check für props und props.data
  if (!props || !props.data) {
    return <div className={flowNodeStyles.card}>{messages.flowNode.loading}</div>;
  }

  const id = props.data.nodeId;
  const flowControl = useControlFlowStore();
  
  // Verwende den globalen State direkt statt lokalen State
  const data = flowControl.nodes.find((n) => n.nodeId == id);

  // Parameter-Änderung - use React.useCallback to prevent recreation
  const handleParamChange = React.useCallback((key: string, value: any) => {
    if (!flowControl.nodes) 
      return;
    console.log(props.data.nodeId, key, value, flowControl.nodes);
    const nodeData = flowControl.nodes.find(n => n.nodeId == props.data.nodeId);
    if (!nodeData) 
      return;
    const newParams = { ...nodeData.params, [key]: value };
    const updatedNode = { ...nodeData, params: newParams };
    flowControl.updateNodeParams(props.data.nodeId, newParams);
    const updatedNodes = flowControl.nodes.map(n => n.nodeId === props.data.nodeId ? updatedNode : n);
    flowControl.setNodes(updatedNodes);
  }, [props.data.nodeId, flowControl]);

  if (!data?.metadata?.functionName || data.metadata.functionName !== 'Iif') {
    return null;
  }

  const definition = filterFunctionRegistry.Iif;
  
  // Memoize inputs, outputs, and params to prevent unnecessary re-renders
  const { inputs, outputs, params } = React.useMemo(() => {
    const inputs = definition.inputLabels.map(e => e);
    const outputs = definition.outputLabels.map(e => e);
    const params = definition.params.map(p => ({ 
      name: p.name, 
      value: (data.params ?? {})[p.name] || p.default 
    }));
    return { inputs, outputs, params };
  }, [JSON.stringify(data?.params)]);

  // Get current values
  const outputValues = Array.isArray(data?.latestValue) ? data.latestValue : [data?.latestValue];
  const currentResult = outputValues[0] || 0;

  // Get operator parameter
  const operator = params.find(p => p.name === 'operator')?.value || '>';
  
  // Get current input values by checking edges and nodeLatestValues
  const getInputValue = (inputLabel: string): number => {
    const incomingEdge = flowControl.edges.find(e => e.target === id && e.targetPort === inputLabel);
    if (incomingEdge) {
      const sourceValue = flowControl.nodeLatestValues[incomingEdge.source];
      return typeof sourceValue === 'number' ? sourceValue : 0;
    }
    return 0;
  };
  
  const aValue = getInputValue('a');
  const bValue = getInputValue('b');
  const trueValue = getInputValue('trueValue');
  const falseValue = getInputValue('falseValue');
  
  // Calculate condition result
  let conditionResult = false;
  switch (operator) {
    case '>':
      conditionResult = aValue > bValue;
      break;
    case '<':
      conditionResult = aValue < bValue;
      break;
    case '=':
    case '==':
      conditionResult = Math.abs(aValue - bValue) < 0.00001;
      break;
    case '>=':
      conditionResult = aValue >= bValue;
      break;
    case '<=':
      conditionResult = aValue <= bValue;
      break;
    case '!=':
    case '<>':
      conditionResult = Math.abs(aValue - bValue) >= 0.00001;
      break;
    default:
      conditionResult = aValue > bValue;
      break;
  }

  // Available operators
  const operators = [
    { value: '>', label: '> (größer als)' },
    { value: '<', label: '< (kleiner als)' },
    { value: '=', label: '= (gleich)' },
    { value: '>=', label: '>= (größer gleich)' },
    { value: '<=', label: '<= (kleiner gleich)' },
    { value: '!=', label: '!= (ungleich)' }
  ];

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
        {label}: {Number(currentResult).toFixed(3)}
      </span>
    </Handle>
  ));

  return (
    <div className={`${flowNodeStyles.card} min-w-[220px]`}>
      <FlowNodeHeader title="IIF (If-Then-Else)" docKey="Iif" onDelete={() => flowControl.deleteNode(Number(id))} />
      <div className={flowNodeStyles.body}>
        {/* Current Result Display */}
        <div className={`${flowNodeStyles.panel} text-center`}>
          <div className={flowNodeStyles.label}>Result</div>
          <div className={flowNodeStyles.primaryValue}>{Number(currentResult).toFixed(3)}</div>
        </div>

        {/* Operator Selection */}
        <div className="mb-2">
          <label className={`${flowNodeStyles.label} block mb-1`}>Operator</label>
          <select
            value={operator}
            onChange={(e) => {
              e.stopPropagation();
              handleParamChange('operator', e.target.value);
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onMouseUp={(e) => e.stopPropagation()}
            onMouseMove={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onTouchEnd={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onFocus={(e) => e.stopPropagation()}
            onBlur={(e) => e.stopPropagation()}
            className={`${flowNodeStyles.input} w-full py-1`}
          >
            {operators.map((op) => (
              <option key={op.value} value={op.value} className="bg-zinc-900 text-zinc-100">
                {op.label}
              </option>
            ))}
          </select>
        </div>

        {/* Logic Display */}
        <div className={`${flowNodeStyles.panel} text-xs text-zinc-200 font-mono text-center`}>
          <div className="mb-1">
            if ({aValue.toFixed(2)} {operator} {bValue.toFixed(2)}) 
            <span className={`ml-2 px-1 rounded text-[10px] font-bold ${
              conditionResult ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-700 text-zinc-200'
            }`}>
              {conditionResult ? 'TRUE' : 'FALSE'}
            </span>
          </div>
          <div className={`${conditionResult ? 'text-zinc-50 font-semibold' : 'text-zinc-400'}`}>
            → trueValue ({trueValue.toFixed(2)})
          </div>
          <div className={`${!conditionResult ? 'text-zinc-50 font-semibold' : 'text-zinc-400'}`}>
            → falseValue ({falseValue.toFixed(2)})
          </div>
        </div>
      </div>
      {inputHandles}
      {outputHandles}
    </div>
  );
}
