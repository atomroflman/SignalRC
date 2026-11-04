"use client";
// D75 – inspector section for a clickable element or SVG part: kind, HUD input
// name (offered from the driver's flow), value / range and the public flag.
// Edits go through setInteraction; interactions are not overridable, so this
// always edits the element itself, also while a variant is active.
import React, { useState } from "react";
import { SIGNAL_NAME } from "../../document/schema";
import type { EffectiveElement, Interaction } from "../../document/types";
import type { EditorStore } from "../core/store";
import type { ChannelDirectory } from "./channels";
import { input } from "./formula-field";
import type { DynamicsMessages } from "./messages";
import { NumberField } from "./property-inspector";

const KINDS: Interaction["kind"][] = ["button", "toggle", "value", "slider"];

export function InteractionEditor({ store, el, part, dir, m }: { store: EditorStore; el: EffectiveElement; part?: string; dir: ChannelDirectory; m: DynamicsMessages }) {
  const current = part === undefined ? el.interaction : el.parts[part]?.interaction;
  const set = (interaction: Interaction | undefined) => store.dispatch({ type: "setInteraction", element: el.id, part, interaction });
  const update = (patch: Partial<Interaction>) => {
    if (!current) return;
    const next: Interaction = { ...current, ...patch };
    for (const key of Object.keys(next) as (keyof Interaction)[]) if (next[key] === undefined) delete next[key];
    set(next);
  };
  const flowInputs = dir.flowInputs ?? [];
  const listId = `ovl-hud-inputs-${el.id}-${part ?? ""}`;

  return (
    <div className="flex flex-col gap-1" data-ovl-interaction-editor={part ?? el.id}>
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{m.interaction}</div>
      <label className="flex items-center gap-1">
        <select
          className={input}
          value={current?.kind ?? ""}
          onChange={(e) => {
            const kind = e.target.value as Interaction["kind"] | "";
            if (!kind) return set(undefined);
            set(current ? { ...current, kind } : { input: flowInputs[0] ?? "hudInput", kind });
          }}
        >
          <option value="">{m.interactionNone}</option>
          {KINDS.map((k) => <option key={k} value={k}>{m.interactionKinds[k]}</option>)}
        </select>
      </label>
      {current && (
        <>
          <InputName value={current.input} flowInputs={flowInputs} listId={listId} m={m} onCommit={(name) => update({ input: name })} />
          {current.kind !== "slider" && (
            <label className="flex items-center gap-1">
              <span className="w-24 shrink-0 text-zinc-400">{m.interactionValue}</span>
              <NumberField value={current.value ?? 1} onCommit={(v) => update({ value: v === 1 ? undefined : v })} className="w-20" />
            </label>
          )}
          {current.kind === "slider" && (
            <label className="flex items-center gap-1">
              <span className="w-24 shrink-0 text-zinc-400">{m.min} / {m.max}</span>
              <NumberField value={current.min ?? 0} onCommit={(v) => update({ min: v === 0 ? undefined : v })} className="w-14" title={m.min} />
              <NumberField value={current.max ?? 1} onCommit={(v) => update({ max: v === 1 ? undefined : v })} className="w-14" title={m.max} />
              <NumberField value={current.step ?? 0} onCommit={(v) => update({ step: v > 0 ? v : undefined })} className="w-14" title="step" />
            </label>
          )}
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={current.public === true} onChange={(e) => update({ public: e.target.checked ? true : undefined })} />
            <span>{m.interactionPublic}</span>
          </label>
          <span className="text-[11px] text-zinc-500">{m.interactionHint}</span>
        </>
      )}
    </div>
  );
}

function InputName({ value, flowInputs, listId, m, onCommit }: { value: string; flowInputs: string[]; listId: string; m: DynamicsMessages; onCommit(name: string): void }) {
  const [draft, setDraft] = useState(value);
  const trimmed = draft.trim();
  const valid = SIGNAL_NAME.test(trimmed);
  const commit = () => { if (valid && trimmed !== value) onCommit(trimmed); };
  return (
    <div className="flex flex-col gap-0.5">
      <label className="flex items-center gap-1">
        <span className="w-24 shrink-0 text-zinc-400">{m.interactionInput}</span>
        <input
          className={`${input} font-mono`}
          key={value}
          defaultValue={value}
          list={listId}
          maxLength={64}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") commit(); }}
          onBlur={commit}
        />
        <datalist id={listId}>{flowInputs.map((n) => <option key={n} value={n} />)}</datalist>
      </label>
      {!valid && <span className="text-[11px] text-amber-400">{m.interactionNameInvalid}</span>}
      {valid && flowInputs.length > 0 && !flowInputs.includes(trimmed) && <span className="text-[11px] text-amber-400">{m.interactionNotInFlow}</span>}
    </div>
  );
}
