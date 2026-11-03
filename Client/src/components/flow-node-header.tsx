import React from "react";
import { useI18n } from "@/i18n/provider";
import { flowNodeDocs } from "./flow-node-docs";
import { flowNodeStyles } from "./flow-node-styles";

// Title bar of every flow node: title, optional live value, info popover with
// the node's description (flow-node-docs.ts) and the delete button.

export function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </svg>
  );
}

export function FlowNodeHeader({ title, docKey, value, onDelete }: {
  title: React.ReactNode;
  /** Function name, "input" or "output"; no info icon without a description. */
  docKey?: string;
  value?: React.ReactNode;
  onDelete(): void;
}) {
  const { messages, locale } = useI18n();
  const doc = docKey ? (flowNodeDocs[locale] ?? flowNodeDocs.de)[docKey] : undefined;
  return (
    <div className={flowNodeStyles.titleBar}>
      <span className={flowNodeStyles.title}>{title}</span>
      {value !== undefined && <span className={flowNodeStyles.titleValue}>{value}</span>}
      <div className="ml-auto flex items-center gap-0.5">
        {doc && (
          <div className="group/info relative">
            <button className={flowNodeStyles.iconButton} aria-label={messages.flowNode.info}>
              <InfoIcon />
            </button>
            <div role="tooltip" className={flowNodeStyles.infoPopover}>
              <p className="text-zinc-100">{doc.summary}</p>
              {doc.details?.map((d) => <p key={d} className="mt-1.5 text-zinc-300">{d}</p>)}
              <p className="mt-2 pt-2 border-t border-zinc-700 text-zinc-300">
                <span className="font-semibold text-zinc-200">{messages.flowNode.example}: </span>
                {doc.example}
              </p>
            </div>
          </div>
        )}
        <button
          className={`${flowNodeStyles.iconButton} hover:text-red-300 hover:bg-red-950/60`}
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title={messages.flowNode.deleteNode}
          aria-label={messages.flowNode.deleteNode}
        >
          <TrashIcon />
        </button>
      </div>
    </div>
  );
}
