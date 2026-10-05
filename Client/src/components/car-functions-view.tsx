import React, { useEffect, useState } from "react";
import { useControlFlowStore } from "./control-flow-store";
import CollapsibleSection from "./collapsible-section";
import { useI18n } from "@/i18n/provider";

export type CarFunction = {
  id: number;
  displayName: string;
  channelName: string;
  isEnabled: boolean;
  requiresAxis: boolean;
};

export default function CarFunctionsView({ carId, hideFlowButtons }: { carId: number, hideFlowButtons?: boolean }) {
  const { messages } = useI18n();
  const [functions, setFunctions] = useState<CarFunction[]>([]);
  const controlFlow = useControlFlowStore();

  useEffect(() => {
    async function fetchingCarFunctions() {
      if (!carId) return;

      try {
        const response = await fetch(`/api/car/${carId}/functions`);
        const data = await response.json();
        setFunctions(data);
      } catch (error) {
        console.error("Error fetching car functions:", error);
        setFunctions([]);
      }
    }

    fetchingCarFunctions();
  }, [carId]);

  // Only allow one output node per function
  const hasOutputNode = (dbId: number) =>{
    return controlFlow.nodes.some((n) => n.type === "output" && n.data?.id === dbId);
  };
  return (
    <CollapsibleSection title={messages.collapsible.carFunctions} label={messages.collapsible.carFunctions}>
      <div className="bg-zinc-900 rounded-lg p-2 border border-zinc-800 text-xs mt-2">
        <div className="font-bold mb-2 text-zinc-200 text-xs">{messages.carFunctions.title}</div>
        {functions.length === 0 && <div className="text-zinc-400 text-xs">{messages.carFunctions.none}</div>}
        <ul className="space-y-1">
          {functions.map((f) => {
            const alreadyUsed = hasOutputNode(f.id);
            return (
              <li key={f.channelName} className="flex items-center justify-between">
                <div>
                  <span className="font-mono text-zinc-100 text-xs">{f.displayName || f.channelName}</span>
                  {f.requiresAxis && <span className="ml-2 text-zinc-400">({messages.carFunctions.axis})</span>}
                </div>
                {!hideFlowButtons &&  (
                  <button
                    className="ml-2 px-1 py-0.5 bg-green-900 hover:bg-green-800 text-green-100 rounded text-[10px] border border-green-800 transition-colors duration-150 text-right whitespace-nowrap disabled:opacity-50"
                    hidden={alreadyUsed}
                    onClick={() => controlFlow.registerOutput(f.id)}
                  >
                    {messages.carFunctions.addFlow}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </CollapsibleSection>
  );
}
