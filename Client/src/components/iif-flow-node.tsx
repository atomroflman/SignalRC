import React from "react";
import { Handle, Position, NodeProps } from "reactflow";
import { filterFunctionRegistry } from "./filters/filter-function-registry";
import { useControlFlowStore } from "./control-flow-store";
import { CustomFlowNodeProps } from "./custom-flow-node";
import { useI18n } from "@/i18n/provider";

export default function IifFlowNode(props: CustomFlowNodeProps) {
  const { messages } = useI18n();
  // Umfassender Null-Check für props und props.data
  if (!props || !props.data) {
    return <div className="bg-zinc-800 border border-zinc-700 rounded p-2">{messages.flowNode.loading}</div>;
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
      className="bg-orange-500"
      style={{ left: `${100 / (inputs.length + 1) * (index + 1)}%`, top: "-4px" }}
    >
      <span className="text-[8px] pt-1 text-center text-orange-300 font-mono block" style={{
        marginLeft: -50 / (inputs.length + 1), 
        width: 100 / (inputs.length + 1)
      }}>
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
      <span className="text-[8px] pb-1 text-center text-blue-300 font-mono block" style={{
        marginLeft: -50 / (outputs.length + 1), 
        width: 100 / (outputs.length + 1),
        marginTop: -16
      }}>
        {label}: {Number(currentResult).toFixed(3)}
      </span>
    </Handle>
  ));

  return (
    <div className="bg-zinc-800 border border-zinc-700 rounded p-2 pt-3 pb-6 flex flex-col min-w-[200px] relative">
      <div className="flex items-center justify-between mb-2">
        <span className="truncate text-xs font-mono font-bold text-purple-300">🔀 IIF (If-Then-Else)</span>
        <button
          className="ml-2 px-1 py-0.5 bg-red-900 hover:bg-red-800 text-red-100 rounded text-[10px] border border-red-800 transition-colors duration-150"
          onClick={() => flowControl.deleteNode(Number(id))}
          title={messages.flowNode.deleteNode}
        >
          ✕
        </button>
      </div>

      {/* Current Result Display */}
      <div className="bg-zinc-900 border border-zinc-600 rounded p-2 mb-2 text-center">
        <div className="text-xs text-zinc-400 mb-1">Result</div>
        <div className="text-lg font-bold text-purple-300">{Number(currentResult).toFixed(3)}</div>
      </div>

      {/* Operator Selection */}
      <div className="mb-2">
        <label className="text-xs text-zinc-400 block mb-1">Operator:</label>
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
          className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 focus:border-purple-500 focus:outline-none"
        >
          {operators.map((op) => (
            <option key={op.value} value={op.value} className="bg-zinc-900 text-zinc-200">
              {op.label}
            </option>
          ))}
        </select>
      </div>

      {/* Logic Display */}
      <div className="bg-zinc-900 border border-zinc-600 rounded p-2 text-xs text-zinc-300 font-mono text-center">
        <div className="mb-1">
          if ({aValue.toFixed(2)} {operator} {bValue.toFixed(2)}) 
          <span className={`ml-2 px-1 rounded text-[10px] font-bold ${
            conditionResult ? 'bg-green-800 text-green-200' : 'bg-red-800 text-red-200'
          }`}>
            {conditionResult ? 'TRUE' : 'FALSE'}
          </span>
        </div>
        <div className={`${conditionResult ? 'text-green-400 font-bold' : 'text-zinc-500'}`}>
          → trueValue ({trueValue.toFixed(2)})
        </div>
        <div className={`${!conditionResult ? 'text-red-400 font-bold' : 'text-zinc-500'}`}>
          → falseValue ({falseValue.toFixed(2)})
        </div>
      </div>

      {inputHandles}
      {outputHandles}
    </div>
  );
}
