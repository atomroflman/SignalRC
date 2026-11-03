import React from "react";
import { useControlFlowStore } from "./control-flow-store";

export default function GamepadButtonView({
  dbId,
  label,
  isPressed = false,
  alreadyUsed = false,
  hideFlowButtons
}: {
  dbId?: number;
  /** Channel name as the flow input node shows it. */
  label: string;
  isPressed?: boolean;
  alreadyUsed?: boolean;
  hideFlowButtons?: boolean;
}) {

  const controlFlow = useControlFlowStore();
  function onRegisterInputChannelValue() {
    if (!controlFlow || !dbId) return;
    controlFlow.registerInput(dbId as number);
  }

  return (
    <li className="flex items-center text-xs justify-between whitespace-nowrap">
      <div className="flex items-center min-w-0">
        <span className="w-16 text-zinc-400 text-xs text-left whitespace-nowrap">{label}:</span>
        <span
          className={`inline-block w-4 h-4 rounded-full border transition-colors duration-150 ${isPressed ? "bg-zinc-100 border-zinc-400" : "bg-zinc-700 border-zinc-500"}`}
          style={{ marginLeft: '1.5rem', marginRight: '1.5rem' }}
          title={isPressed ? "Pressed" : "Not pressed"}
        />
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
