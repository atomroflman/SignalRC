import React from "react";
import { filterFunctionRegistry } from "./filters/filter-function-registry";
import { useControlFlowStore } from "./control-flow-store";
import CollapsibleSection from "./collapsible-section";
import { useI18n } from "@/i18n/provider";

/** Functions that only exist in the browser flow (Server/Services/FlowZoneRules.cs). */
export const BROWSER_ONLY_FUNCTIONS = ["HudInput", "HudSignal"];
/** Functions that only exist in the vehicle flow. */
export const ONBOARD_ONLY_FUNCTIONS = ["DisconnectController", "TelemetryOut", "ControllerLight"];

export default function FunctionNodesView({ hideFlowButtons }: { hideFlowButtons?: boolean }) {
  const { messages } = useI18n();
  const controlFlow = useControlFlowStore();
  const functionNames = Object.keys(filterFunctionRegistry).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  const [params, setParams] = React.useState<Record<string, any>>({});
  const [inputPorts, setInputPorts] = React.useState<Record<string, number>>({});
  const [outputPorts, setOutputPorts] = React.useState<Record<string, number>>({});

  return (
    <CollapsibleSection title={messages.collapsible.filterFunctionNodes} label={messages.collapsible.filterFunctionNodes}>
      {!hideFlowButtons && (
        <div className="mb-3 space-y-2">
          {/* Zone of new function and channel nodes (OnboardFlow-Arbeitspakete.md T01). */}
          <div className="flex items-center gap-2">
            <span className="text-zinc-400">{messages.onboardFlow.newNodesIn}</span>
            {(["browser", "onboard"] as const).map(zone => (
              <button
                key={zone}
                className={`px-1.5 py-0.5 rounded border text-[10px] ${controlFlow.newNodeZone === zone
                  ? zone === "onboard" ? "bg-amber-800 border-amber-600 text-amber-50" : "bg-zinc-600 border-zinc-400 text-zinc-50"
                  : "bg-zinc-900 border-zinc-700 text-zinc-400 hover:bg-zinc-800"}`}
                onClick={() => controlFlow.setNewNodeZone(zone)}
              >
                {zone === "onboard" ? messages.onboardFlow.zoneOnboard : messages.onboardFlow.zoneBrowser}
              </button>
            ))}
          </div>
          <button
            className="px-1.5 py-0.5 rounded border text-[10px] bg-amber-950 border-amber-800 text-amber-100 hover:bg-amber-900"
            onClick={() => {
              const name = window.prompt(messages.onboardFlow.handoffNamePrompt, messages.onboardFlow.handoffDefaultName);
              if (name !== null) controlFlow.registerHandoff(name).catch(e => alert(String(e?.message ?? e)));
            }}
          >
            {messages.onboardFlow.addHandoff}
          </button>
        </div>
      )}
      {functionNames.length === 0 && (
        <div className="text-zinc-400 text-xs">{messages.functionNodes.none}</div>
      )}
      <ul className="space-y-2">
        {functionNames
          .filter(fn => controlFlow.newNodeZone === "onboard" ? !BROWSER_ONLY_FUNCTIONS.includes(fn) : !ONBOARD_ONLY_FUNCTIONS.includes(fn))
          .map((fn) => {
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
