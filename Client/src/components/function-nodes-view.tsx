import React from "react";
import { filterFunctionRegistry } from "./filters/filter-function-registry";
import { useControlFlowStore } from "./control-flow-store";
import CollapsibleSection from "./collapsible-section";
import { useI18n } from "@/i18n/provider";

export default function FunctionNodesView({ hideFlowButtons }: { hideFlowButtons?: boolean }) {
  const { messages } = useI18n();
  const controlFlow = useControlFlowStore();
  const functionNames = Object.keys(filterFunctionRegistry);
  const [params, setParams] = React.useState<Record<string, any>>({});
  const [inputPorts, setInputPorts] = React.useState<Record<string, number>>({});
  const [outputPorts, setOutputPorts] = React.useState<Record<string, number>>({});

  return (
    <CollapsibleSection title={messages.collapsible.filterFunctionNodes} label={messages.collapsible.filterFunctionNodes}>
      {functionNames.length === 0 && (
        <div className="text-zinc-400 text-xs">{messages.functionNodes.none}</div>
      )}
      <ul className="space-y-2">
        {functionNames.map((fn) => {
          return (
              <div key={fn} className="flex items-center justify-between">
                <span className="font-mono text-zinc-100 text-xs">{fn}</span>
                {!hideFlowButtons && (
                  <button
                    className="ml-2 px-1 py-0.5 bg-blue-900 hover:bg-blue-800 text-blue-100 rounded text-[10px] border border-blue-800 transition-colors duration-150 text-right whitespace-nowrap disabled:opacity-50"
                    onClick={async () => {
                      await controlFlow.registerFunctionNode(
                        fn,
                        params[fn] || {},
                        inputPorts[fn] || 1,
                        outputPorts[fn] || 1
                      );
                    }}
                  >
                    {messages.functionNodes.addFlow}
                  </button>
                )}
              </div>
          );
        })}
      </ul>
    </CollapsibleSection>
  );
}
