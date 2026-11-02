"use client";
// AP13 – publish (with note and server warnings), version history and restore
// as draft with confirmation. Logic in publish-model.ts; saving stays with the
// AP09 SaveController.
import React, { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { Diagnostic } from "../document/types";
import { useEditorState } from "../editor/canvas/hooks";
import type { EditorStore } from "../editor/core/store";
import type { SaveController } from "../editor/persistence/autosave";
import type { OverlayPersistence, PublicationInfo } from "../editor/persistence/types";
import { describeLocation } from "../exchange/package-exchange";
import type { Locale } from "../runtime/types";
import type { ControlReason } from "./editor-control";
import type { IntegrationMessages } from "./messages";
import {
  activePublication, noControlHint, NOTE_MAX, publishBlockers, publishDraft, publishUnavailable, restorePublication, sortHistory,
  type ActionFailure,
} from "./publish-model";

const btn = "px-2 py-0.5 rounded text-xs border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 disabled:opacity-40";
const primary = "px-2 py-1 rounded text-xs border border-sky-700 bg-sky-800 hover:bg-sky-700 text-white disabled:opacity-40";

function useSaveState(save: SaveController) {
  return useSyncExternalStore((l) => save.subscribe(l), () => save.getState(), () => save.getState());
}

function DiagnosticList({ store, diagnostics }: { store: EditorStore; diagnostics: Diagnostic[] }) {
  return (
    <ul className="max-h-32 overflow-auto space-y-0.5 text-[11px]">
      {diagnostics.slice(0, 20).map((d, i) => (
        <li key={i} className={d.category === "warning" ? "text-amber-300" : "text-red-300"}>
          <button className="text-left hover:underline" onClick={() => d.location.element && store.select([d.location.element])}>
            {d.message}{describeLocation(store.document, d) ? ` – ${describeLocation(store.document, d)}` : ""}
          </button>
        </li>
      ))}
      {diagnostics.length > 20 && <li className="text-zinc-500">… +{diagnostics.length - 20}</li>}
    </ul>
  );
}

export interface PublishPanelProps {
  carId: number;
  store: EditorStore;
  save: SaveController;
  persistence: OverlayPersistence;
  locale: Locale;
  m: IntegrationMessages["publish"];
  /** Client view of the administrator role (controlReason); explains a disabled button. */
  reason?: ControlReason;
}

type Notice = { tone: "ok" | "error"; text: string; diagnostics?: Diagnostic[] };

export function PublishPanel({ carId, store, save, persistence, locale, m, reason = "control" }: PublishPanelProps) {
  const editor = useEditorState(store);
  const saveState = useSaveState(save);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"publish" | "restore" | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [history, setHistory] = useState<PublicationInfo[] | null>(null);
  const [historyFailed, setHistoryFailed] = useState(false);
  const [confirm, setConfirm] = useState<PublicationInfo | null>(null);

  // The store caches diagnostics per document and resolve context.
  const blockers = publishBlockers(store.diagnostics());
  const unavailable = publishUnavailable(saveState, blockers, note);
  const deps = { carId, save, persistence };

  const loadHistory = useCallback(async () => {
    if (!save.getState().hasControl) return;
    try {
      setHistory(await persistence.listPublications(carId));
      setHistoryFailed(false);
    } catch {
      setHistoryFailed(true);
    }
  }, [carId, persistence, save]);

  // History needs management rights; reload when control comes (back) and after publishing elsewhere.
  useEffect(() => {
    if (saveState.hasControl && saveState.status !== "loading") void loadHistory();
  }, [saveState.hasControl, saveState.status === "loading", saveState.publishedNumber, loadHistory]); // eslint-disable-line react-hooks/exhaustive-deps

  const failText = (f: ActionFailure): Notice => {
    switch (f.kind) {
      case "blocked": return { tone: "error", text: m.failed.blocked, diagnostics: f.diagnostics };
      case "failed": return { tone: "error", text: m.failed.failed(f.message) };
      default: return { tone: "error", text: m.failed[f.kind] };
    }
  };

  const doPublish = async () => {
    setBusy("publish");
    setNotice(null);
    const r = await publishDraft(deps, note);
    setBusy(null);
    if (r.kind === "published") {
      setNote("");
      setNotice({ tone: "ok", text: m.published(r.number), diagnostics: r.warnings });
      void loadHistory();
    } else setNotice(failText(r));
  };

  const doRestore = async (p: PublicationInfo) => {
    setConfirm(null);
    setBusy("restore");
    setNotice(null);
    const r = await restorePublication(deps, p.id);
    setBusy(null);
    setNotice(r.kind === "restored" ? { tone: "ok", text: m.restored(p.number) } : failText(r));
  };

  const active = history ? activePublication(history) : undefined;
  const dateFormat = new Intl.DateTimeFormat(locale === "de" ? "de-DE" : "en-US", { dateStyle: "short", timeStyle: "short" });
  const writable = saveState.hasControl && saveState.status !== "localOnly";

  return (
    <div className="flex flex-col gap-2 text-xs text-zinc-200" data-ovl-publish="">
      <div className="font-semibold text-zinc-300">{m.title}</div>
      <textarea
        className="bg-zinc-900 border border-zinc-700 rounded px-1 py-0.5 text-xs text-zinc-100 resize-y min-h-[3rem]"
        placeholder={m.notePlaceholder}
        aria-label={m.note}
        value={note}
        maxLength={NOTE_MAX + 50}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="flex items-center justify-between gap-2">
        <span className={note.trim().length > NOTE_MAX ? "text-red-300" : "text-zinc-500"}>{m.noteCount(note.trim().length, NOTE_MAX)}</span>
        <button className={primary} disabled={unavailable !== null || busy !== null} onClick={() => void doPublish()}>
          {busy === "publish" ? m.publishing : m.publish}
        </button>
      </div>
      <div className="text-zinc-500">{m.hint}</div>
      {editor.document.disabled && <div className="text-amber-300">{m.vehicleDisabled}</div>}
      {unavailable && unavailable !== "blocked" && <div className="text-zinc-400">{m.unavailable[unavailable]}</div>}
      {unavailable === "noControl" && <div className="text-zinc-400" data-ovl-no-control={noControlHint(reason, saveState)}>{m.noControlHint[noControlHint(reason, saveState)]}</div>}
      {unavailable === "blocked" && (
        <div className="text-red-300">{m.unavailable.blocked}<DiagnosticList store={store} diagnostics={blockers} /></div>
      )}
      {notice && (
        <div className={notice.tone === "ok" ? "text-emerald-300" : "text-red-300"} role="status">
          {notice.text}
          {notice.diagnostics && notice.diagnostics.length > 0 && (
            <>{notice.tone === "ok" && <div className="text-zinc-400">{m.warnings}</div>}<DiagnosticList store={store} diagnostics={notice.diagnostics} /></>
          )}
        </div>
      )}

      <div className="mt-1 flex items-center justify-between">
        <span className="font-semibold text-zinc-300">{m.history}</span>
        <button className={btn} disabled={!writable} onClick={() => void loadHistory()}>{m.historyLoad}</button>
      </div>
      {historyFailed && <div className="text-red-300">{m.historyFailed}</div>}
      {history && history.length === 0 && <div className="text-zinc-500">{m.historyEmpty}</div>}
      {history && history.length > 0 && (
        <ul className="max-h-48 overflow-auto space-y-1" data-ovl-history="">
          {sortHistory(history).map((p) => (
            <li key={p.id} className="rounded border border-zinc-800 p-1">
              <div className="flex items-center gap-1">
                <span className="font-medium">{m.version(p.number)}</span>
                {active?.id === p.id && <span className="rounded bg-emerald-800 px-1 text-[10px] text-emerald-100">{m.active}</span>}
                <span className="ml-auto text-zinc-500">{(() => { try { return dateFormat.format(new Date(p.publishedAt)); } catch { return p.publishedAt; } })()}</span>
              </div>
              {p.publishedBy && <div className="text-zinc-500">{m.by(p.publishedBy)}</div>}
              {p.note && <div className="text-zinc-300 whitespace-pre-wrap break-words">{p.note}</div>}
              <button className={`${btn} mt-1`} disabled={!writable || busy !== null} onClick={() => setConfirm(p)}>{m.restore}</button>
            </li>
          ))}
        </ul>
      )}

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" role="dialog" aria-modal="true">
          <div className="max-w-md rounded border border-zinc-700 bg-zinc-900 p-4 text-sm text-zinc-100 space-y-3">
            <div className="font-semibold">{m.restoreTitle(confirm.number)}</div>
            <div className="text-zinc-300 text-xs">{m.restoreText}</div>
            <div className="flex justify-end gap-2">
              <button className={btn} onClick={() => setConfirm(null)}>{m.cancel}</button>
              <button className={primary} onClick={() => void doRestore(confirm)}>{m.restoreConfirm}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
