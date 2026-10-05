import React from "react";
import { Handle, Position, NodeProps } from "reactflow";
import { filterFunctionRegistry } from "./filters/filter-function-registry";
import { useControlFlowStore } from "./control-flow-store";
import { CustomFlowNodeProps } from "./custom-flow-node";
import { ParamInputField } from "./param-input";
import { useI18n } from "@/i18n/provider";

export default function SmoothFlowNode(props: CustomFlowNodeProps) {
  const { messages } = useI18n();
  if (!props || !props.data) {
    return <div className="bg-zinc-800 border border-zinc-700 rounded p-2">{messages.flowNode.loading}</div>;
  }

  const id = props.data.nodeId;
  const flowControl = useControlFlowStore();
  
  // Verwende den globalen State direkt statt lokalen State
  const data = flowControl.nodes.find((n) => n.nodeId == id);

  // Parameter-Änderung
  const handleParamChange = (key: string, value: any) => {
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
  };

  if (!data?.metadata?.functionName || data.metadata.functionName !== 'Smooth') {
    return null;
  }

  const definition = filterFunctionRegistry.Smooth;
  const inputs = definition.inputLabels.map(e => e);
  const outputs = definition.outputLabels.map(e => e);
  const params = definition.params.map(p => ({ 
    name: p.name, 
    value: (data.params ?? {})[p.name] || p.default 
  }));

  // Get current values
  const outputValues = Array.isArray(data?.latestValue) ? data.latestValue : [data?.latestValue];
  const currentResult = outputValues[0] || 0;

  // Get parameters
  const speed = Math.max(0.01, Math.min(1.0, parseFloat(params.find(p => p.name === 'speed')?.value) || 0.1));
  const threshold = Math.max(0.0001, parseFloat(params.find(p => p.name === 'threshold')?.value) || 0.001);

  // Get current input value to calculate transition time
  const getInputValue = (inputLabel: string): number => {
    const incomingEdge = flowControl.edges.find(e => e.target === id && e.targetPort === inputLabel);
    if (incomingEdge) {
      const sourceValue = flowControl.nodeLatestValues[incomingEdge.source];
      return typeof sourceValue === 'number' ? sourceValue : 0;
    }
    return 0;
  };

  const inputValue = getInputValue('input');
  const currentValue = currentResult;

  const fps = Math.max(10, Math.min(120, params.find(p => p.name === 'fps')?.value ?? 60));
    
  // Calculate transition time
  const calculateTransitionTime = (from: number, to: number, speed: number, threshold: number): number => {
    if (Math.abs(to - from) <= threshold) return 0;
    
    // For exponential smoothing: newValue = current + (target - current) * speed
    // We need to solve: |target - current_n| <= threshold
    // After n steps: current_n = target - (target - initial) * (1 - speed)^n
    // So: |(target - initial) * (1 - speed)^n| <= threshold
    // n >= log(threshold / |target - initial|) / log(1 - speed)
    
    const difference = Math.abs(to - from);
    if (difference <= threshold) return 0;
    const intervalMs = 1000 / fps;
    const steps = Math.log(threshold / difference) / Math.log(1 - speed);
    const timeInSeconds = (steps * intervalMs) / 1000;
    
    return Math.max(0, timeInSeconds);
  };

  const transitionTime = calculateTransitionTime(currentValue, inputValue, speed, threshold);
  const transitionFrames = Math.ceil(transitionTime * fps);

  // Calculate maximum possible transition time (from 0 to 1 with current settings)
  const maxTransitionTime = calculateTransitionTime(0, 1, speed, threshold);
  const maxTransitionFrames = Math.ceil(maxTransitionTime * fps);

  // Format time display
  const formatTime = (seconds: number): string => {
    if (seconds < 0.1) return `${Math.round(seconds * 1000)}ms`;
    if (seconds < 1) return `${Math.round(seconds * 100) / 100}s`;
    if (seconds < 60) return `${Math.round(seconds * 10) / 10}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    return `${minutes}m ${remainingSeconds}s`;
  };

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
    <div className="bg-zinc-800 border border-zinc-700 rounded p-2 pt-3 pb-6 flex flex-col min-w-[220px] relative">
      <div className="flex items-center justify-between mb-2">
        <span className="truncate text-xs font-mono font-bold text-cyan-300">🌊 Smooth</span>
        <button
          className="ml-2 px-1 py-0.5 bg-red-900 hover:bg-red-800 text-red-100 rounded text-[10px] border border-red-800 transition-colors duration-150"
          onClick={(e) => {
            e.stopPropagation();
            flowControl.deleteNode(Number(id));
          }}
          title={messages.flowNode.deleteNode}
        >
          ✕
        </button>
      </div>

      {/* Current Values Display */}
      <div className="bg-zinc-900 border border-zinc-600 rounded p-2 mb-2">
        <div className="text-xs text-zinc-400 mb-1">Current → Target</div>
        <div className="text-sm font-mono text-cyan-300">
          {Number(currentValue).toFixed(3)} → {Number(inputValue).toFixed(3)}
        </div>
        <div className="text-xs text-zinc-500 mt-1">
          Δ: {Number(Math.abs(inputValue - currentValue)).toFixed(3)}
        </div>
      </div>

      {/* Transition Time Display */}
      <div className="bg-zinc-900 border border-zinc-600 rounded p-2 mb-2">
        <div className="text-xs text-zinc-400 mb-1">Transition Time</div>
        <div className="text-lg font-bold text-green-300">
          {formatTime(transitionTime)}
        </div>
        <div className="text-xs text-zinc-500">
          ~{transitionFrames} frames @ {fps}fps
        </div>
      </div>

      {/* Max Duration Info */}
      <div className="bg-zinc-900 border border-zinc-600 rounded p-2 mb-2">
        <div className="text-xs text-zinc-400 mb-1">Max Duration (0→1)</div>
        <div className="text-sm font-bold text-yellow-300">
          {formatTime(maxTransitionTime)}
        </div>
        <div className="text-xs text-zinc-500">
          ~{maxTransitionFrames} frames @ {fps}fps
        </div>
      </div>

      {/* Parameters */}
      <div className="space-y-2">
        {params.map((param) => (
          <div key={param.name} className="flex flex-col gap-1"
            onMouseDown={(e) => e.stopPropagation()}
            onMouseUp={(e) => e.stopPropagation()}
            onMouseMove={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onTouchEnd={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onFocus={(e) => e.stopPropagation()}
            onBlur={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            onKeyUp={(e) => e.stopPropagation()}
          >
            <label className="text-xs text-zinc-400">{param.name}:</label>
            <ParamInputField
              name={param.name}
              value={param.value}
              onBlur={handleParamChange}
              className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 focus:border-cyan-500 focus:outline-none"
              placeholder={definition.params.find(p => p.name === param.name)?.default?.toString()}
            />
            {param.name === 'speed' && (
              <div className="text-[10px] text-zinc-500">
                Range: 0.01 (slow) - 1.0 (instant)
              </div>
            )}
            {param.name === 'threshold' && (
              <div className="text-[10px] text-zinc-500">
                Precision: smaller = more precise
              </div>
            )}
          </div>
        ))}
      </div>

      {inputHandles}
      {outputHandles}
    </div>
  );
}
