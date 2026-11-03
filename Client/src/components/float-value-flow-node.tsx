import React from "react";
import { Handle, Position, NodeProps } from "reactflow";
import { filterFunctionRegistry } from "./filters/filter-function-registry";
import { useControlFlowStore } from "./control-flow-store";
import { CustomFlowNodeProps } from "./custom-flow-node";
import { ParamInput } from "./param-input";
import { useI18n } from "@/i18n/provider";
import { flowNodeStyles, handleOffset } from "./flow-node-styles";

export default function FloatValueFlowNode(props: CustomFlowNodeProps) {
  const { messages } = useI18n();
  if (!props || !props.data) {
    return <div className={flowNodeStyles.card}>{messages.flowNode.loading}</div>;
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
    { label: 'min', title: 'Set to minimum value', variant: 'strong', onClick: (e) => { e.stopPropagation(); setValue(min); } },
    ...deltas.map(d => ({
      label: `-${d}`,
      title: `Decrease by ${d}`,
      variant: d === step ? 'strong' : 'soft',
      onClick: (e: React.MouseEvent) => { e.stopPropagation(); setValue(value - d); },
    })),
  ];
  const rightRow = [
    { label: 'max', title: 'Set to maximum value', variant: 'strong', onClick: (e: React.MouseEvent) => { e.stopPropagation(); setValue(max); } },
    ...deltas.map(d => ({
      label: `+${d}`,
      title: `Increase by ${d}`,
      variant: d === step ? 'strong' : 'soft',
      onClick: (e: React.MouseEvent) => { e.stopPropagation(); setValue(value + d); },
    })),
  ];

  const variantClass = (v: string) => v === 'strong' ? flowNodeStyles.button : flowNodeStyles.buttonSoft;

  const renderRow = (row: typeof leftRow) => row.map((b, i) => (
    <button
      key={i}
      className={variantClass(b.variant)}
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
      style={handleOffset(index, outputs.length)}
    >
      <span className={flowNodeStyles.outputLabel}>
        {label}: {Number(currentValue).toFixed(3)}
      </span>
    </Handle>
  ));

  return (
    <div className={`${flowNodeStyles.card} min-w-[220px]`}>
      <div className={flowNodeStyles.header}>
        <span className={flowNodeStyles.title}>Float Value</span>
        <button
          className={flowNodeStyles.deleteButton}
          onClick={() => flowControl.deleteNode(Number(id))}
          title={messages.flowNode.deleteNode}
        >
          ✕
        </button>
      </div>

      <div className={`${flowNodeStyles.panel} text-center`}>
        <div className={flowNodeStyles.label}>Current Value</div>
        <div className={flowNodeStyles.primaryValue}>{Number(value).toFixed(3)}</div>
      </div>

      <div className="mb-2">
        <div className="grid grid-cols-5 gap-1 mb-2">
          {renderRow(leftRow)}
          {renderRow(rightRow)}
        </div>

        <div className={`flex justify-between font-mono ${flowNodeStyles.hint}`}>
          <span>{min}</span>
          <span>Range</span>
          <span>{max}</span>
        </div>
      </div>

      {params && (
        <div className="flex flex-col gap-1.5 pt-2 border-t border-zinc-700">
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