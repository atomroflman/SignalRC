import React from "react";
import { Handle, Position, NodeProps } from "reactflow";
import { filterFunctionRegistry } from "./filters/filter-function-registry";
import { useControlFlowStore } from "./control-flow-store";
import { CustomFlowNodeProps } from "./custom-flow-node";
import { ParamInput } from "./param-input";
import { useI18n } from "@/i18n/provider";

export default function FloatValueFlowNode(props: CustomFlowNodeProps) {
  const { messages } = useI18n();
  if (!props || !props.data) {
    return <div className="bg-zinc-800 border border-zinc-700 rounded p-2">{messages.flowNode.loading}</div>;
  }

  const id = props.data.nodeId;
  const flowControl = useControlFlowStore();

  const data = flowControl.nodes.find((n) => n.nodeId == id);

  if (!data?.metadata?.functionName || data.metadata.functionName !== 'FloatValue') {
    return null;
  }

  const definition = filterFunctionRegistry.FloatValue;
  const outputs = definition.outputLabels.map(e => e);
  const params = definition.params.map(p => ({
    name: p.name,
    value: (data.params ?? {})[p.name] || p.default
  }));

  const outputValues = Array.isArray(data?.latestValue) ? data.latestValue : [data?.latestValue];
  const currentValue = outputValues[0] || 0;

  const value = parseFloat(params.find(p => p.name === 'value')?.value || '0');
  const min = parseFloat(params.find(p => p.name === 'min')?.value || '-1');
  const max = parseFloat(params.find(p => p.name === 'max')?.value || '1');
  const step = parseFloat(params.find(p => p.name === 'step')?.value || '0.1');

  const setValue = React.useCallback((newValue: number) => {
    const clamped = Math.min(max, Math.max(min, newValue));
    props.data.params.value = clamped.toString();
    flowControl.updateNodeParams(props.data.nodeId, props.data.params);
  }, [min, max, flowControl, props.data.nodeId, props.data.params]);

  // Five buttons per row: clamp / -deltas / +deltas
  const deltas = [step, 0.1, 0.01, 0.001];
  const leftRow: { label: string; title: string; variant: string; onClick: (e: React.MouseEvent) => void }[] = [
    { label: 'min', title: 'Set to minimum value', variant: 'red', onClick: (e) => { e.stopPropagation(); setValue(min); } },
    ...deltas.map(d => ({
      label: `-${d}`,
      title: `Decrease by ${d}`,
      variant: d === step ? 'zinc-strong' : 'zinc-soft',
      onClick: (e: React.MouseEvent) => { e.stopPropagation(); setValue(value - d); },
    })),
  ];
  const rightRow = [
    { label: 'max', title: 'Set to maximum value', variant: 'green', onClick: (e: React.MouseEvent) => { e.stopPropagation(); setValue(max); } },
    ...deltas.map(d => ({
      label: `+${d}`,
      title: `Increase by ${d}`,
      variant: d === step ? 'zinc-strong' : 'zinc-soft',
      onClick: (e: React.MouseEvent) => { e.stopPropagation(); setValue(value + d); },
    })),
  ];

  const variantClass = (v: string) => {
    switch (v) {
      case 'red':        return 'bg-red-800 hover:bg-red-700 text-red-200';
      case 'green':      return 'bg-green-800 hover:bg-green-700 text-green-200';
      case 'zinc-strong':return 'bg-zinc-700 hover:bg-zinc-600 text-zinc-300';
      default:           return 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400';
    }
  };

  const renderRow = (row: typeof leftRow) => row.map((b, i) => (
    <button
      key={i}
      className={`px-2 py-1 rounded text-xs font-mono ${variantClass(b.variant)}`}
      onClick={b.onClick}
      title={b.title}
    >
      {b.label}
    </button>
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
        {label}: {Number(currentValue).toFixed(3)}
      </span>
    </Handle>
  ));

  return (
    <div className="bg-zinc-800 border border-zinc-700 rounded p-2 pt-3 pb-6 flex flex-col min-w-[180px] relative">
      <div className="flex items-center justify-between mb-2">
        <span className="truncate text-xs font-mono font-bold text-cyan-300">🔢 Float Value</span>
        <button
          className="ml-2 px-1 py-0.5 bg-red-900 hover:bg-red-800 text-red-100 rounded text-[10px] border border-red-800 transition-colors duration-150"
          onClick={() => flowControl.deleteNode(Number(id))}
          title={messages.flowNode.deleteNode}
        >
          ✕
        </button>
      </div>

      <div className="bg-zinc-900 border border-zinc-600 rounded p-2 mb-2 text-center">
        <div className="text-xs text-zinc-400 mb-1">Current Value</div>
        <div className="text-lg font-bold text-cyan-300">{Number(value).toFixed(3)}</div>
        <div className="text-xs text-zinc-500">Range: {min} - {max}</div>
      </div>

      <div className="mb-2">
        <div className="grid grid-cols-5 gap-1 mb-2">
          {renderRow(leftRow)}
          {renderRow(rightRow)}
        </div>

        <div className="flex justify-between text-xs text-zinc-400 mt-1">
          <span>{min}</span>
          <span className="font-mono">Range</span>
          <span>{max}</span>
        </div>
      </div>

      {params && (
        <div className="flex flex-col gap-1 mt-1">
          {params.map((e) => (
            <ParamInput
              key={e.name}
              name={e.name}
              value={e.value}
              onBlur={props.handleParamChange}
            />
          ))}
        </div>
      )}
      {outputHandles}
    </div>
  );
}