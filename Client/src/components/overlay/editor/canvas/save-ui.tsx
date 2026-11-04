"use client";
// Save status, conflict / local-only notices, backup offers and the delete confirmation.
import React from "react";
import type { DeletionImpact } from "../../document/deletion";
import { downloadPackage, type BackupEntry } from "../persistence/backup";
import type { SaveController } from "../persistence/autosave";
import { useSaveState } from "./hooks";
import type { EditorMessages } from "./messages";

const btn = "px-2 py-0.5 rounded text-xs border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 disabled:opacity-40";
const COLORS: Record<string, string> = {
  loading: "text-zinc-400", unsaved: "text-amber-300", saving: "text-sky-300", saved: "text-emerald-400",
  error: "text-red-400", conflict: "text-red-300", localOnly: "text-orange-300",
};

export function SaveStatus({ save, m, carId }: { save: SaveController; m: EditorMessages; carId: number }) {
  const s = useSaveState(save);
  return (
    <div className="flex items-center gap-2 text-xs" data-ovl-save-status={s.status}>
      <span className={COLORS[s.status]} title={s.error?.message}>● {m.status[s.status]}</span>
      {s.baseRevision !== undefined && <span className="text-zinc-500">r{s.baseRevision}</span>}
      {s.status === "error" && <button className={btn} onClick={() => void save.flush()}>{m.retry}</button>}
      {s.status === "unsaved" && <button className={btn} onClick={() => void save.flush()}>{m.saveNow}</button>}
      {s.status === "error" && s.error?.diagnostics && <span className="text-red-400">{m.diagnostics(s.error.diagnostics.length)}</span>}
      {s.backupFailed && <span className="text-orange-300">{m.backupFailed}</span>}
      {(s.status === "conflict" || s.status === "localOnly") && (
        <button className={btn} onClick={() => downloadPackage(carId, save.backupPackage())}>{m.download}</button>
      )}
    </div>
  );
}

export function SaveNotices({ save, m, carId }: { save: SaveController; m: EditorMessages; carId: number }) {
  const s = useSaveState(save);
  return (
    <>
      {s.status === "conflict" && (
        <div className="rounded border border-red-800 bg-red-950/60 p-2 text-xs text-red-100 flex flex-col gap-1" role="alert">
          <strong>{m.conflictTitle}</strong>
          <span>{m.conflictText}</span>
          <div className="flex gap-1">
            <button className={btn} onClick={() => downloadPackage(carId, save.backupPackage())}>{m.download}</button>
            <button className={btn} disabled={!s.hasControl} onClick={() => void save.loadServerState()}>{m.loadServer}</button>
          </div>
        </div>
      )}
      {s.status === "localOnly" && (
        <div className="rounded border border-orange-800 bg-orange-950/50 p-2 text-xs text-orange-100" role="status">{m.localOnlyText}</div>
      )}
      {s.status === "error" && s.baseRevision === undefined && (
        <div className="rounded border border-red-800 bg-red-950/50 p-2 text-xs text-red-100 flex gap-2 items-center">
          {m.loadFailed}: {s.error?.message}
          <button className={btn} onClick={() => void save.open()}>{m.retry}</button>
        </div>
      )}
      {s.backups.length > 0 && (
        <div className="rounded border border-sky-800 bg-sky-950/50 p-2 text-xs text-sky-100 flex flex-col gap-1">
          <strong>{m.backupsTitle}</strong>
          {s.backups.map(({ entry, canContinue }: { entry: BackupEntry; canContinue: boolean }) => (
            <div key={entry.savedAt} className="flex items-center gap-2">
              <span>{new Date(entry.savedAt).toLocaleString()} · r{entry.package.baseRevision ?? "–"}</span>
              {canContinue
                ? <button className={btn} onClick={() => save.continueFromBackup(entry)}>{m.backupContinue}</button>
                : <span className="text-zinc-400">{m.backupOnlyDownload}</span>}
              <button className={btn} onClick={() => downloadPackage(carId, entry.package)}>{m.download}</button>
            </div>
          ))}
          <div><button className={btn} onClick={() => save.dismissBackups()}>{m.dismiss}</button></div>
        </div>
      )}
    </>
  );
}

export function DeleteDialog({ impact, m, onConfirm, onCancel }: { impact: DeletionImpact; m: EditorMessages; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60" role="dialog" aria-modal="true">
      <div className="max-w-md rounded border border-zinc-700 bg-zinc-900 p-3 text-xs text-zinc-200 flex flex-col gap-2">
        <strong>{m.deleteTitle}</strong>
        <ul className="list-disc pl-4">
          <li>{m.deleteElements(impact.elements.length)}</li>
          {impact.clips.length > 0 && <li>{m.deleteClips(impact.clips.length)}</li>}
          {impact.variants.map((v) => {
            const parts = [
              v.overrides.length ? `${v.overrides.length} ${m.overridden}` : "",
              v.addedElements.length ? `${v.addedElements.length} ${m.addedInVariant}` : "",
              v.structureEntries.length ? `${v.structureEntries.length} ${m.movedInVariant}` : "",
              v.clips.length ? m.deleteClips(v.clips.length) : "",
            ].filter(Boolean).join(", ");
            return <li key={v.streamId}>{m.deleteVariant(v.streamId, parts)}</li>;
          })}
        </ul>
        <div className="flex justify-end gap-1">
          <button className={btn} onClick={onCancel}>{m.cancel}</button>
          <button className="px-2 py-0.5 rounded text-xs border border-red-800 bg-red-900 hover:bg-red-800 text-red-100" onClick={onConfirm} autoFocus>{m.confirmDelete}</button>
        </div>
      </div>
    </div>
  );
}
