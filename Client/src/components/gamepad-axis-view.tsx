import React from "react";
import { useGamepadStore } from "./controller-store";
import { useControlFlowStore } from "./control-flow-store";

export default function GamepadAxisView({
  dbId,
  label,
  value = 0,
  accuracy = 2,
  alreadyUsed = false,
  hideFlowButtons
}: {
  dbId?: number;
  /** Channel name as the flow input node shows it. */
  label: string;
  value?: number;
  accuracy?: number;
  alreadyUsed?: boolean;
  hideFlowButtons?: boolean;
}) {
  const controlFlow = useControlFlowStore();
  function onRegisterInputChannelValue() {
    if (!controlFlow || !dbId) 
    {
      console.error("Control flow or dbId is not defined", controlFlow, dbId);
      return;
    } 
    controlFlow.registerInput(dbId as number);
  }

  const acc = Math.pow(10, -accuracy);
  const formatted = (Math.round(value / acc) * acc).toFixed(accuracy);
  return (
    <li className="flex items-center text-xs justify-between whitespace-nowrap">
      <div className="flex items-center min-w-0">
        <span className="w-16 text-zinc-400 text-xs text-left whitespace-nowrap">{label}:</span>
        <span className="font-mono w-10 text-zinc-100 text-xs text-left whitespace-pre">{formatted}</span>
      </div>
      {!hideFlowButtons && (
        <button
          className="ml-2 px-1 py-0.5 bg-blue-900 hover:bg-blue-800 text-blue-100 rounded text-[10px] border border-blue-800 transition-colors duration-150 disabled:opacity-50"
          disabled={alreadyUsed}
          onClick={() => onRegisterInputChannelValue()}
        >
          +Flow
        </button>
      )}
    </li>
  );
}
