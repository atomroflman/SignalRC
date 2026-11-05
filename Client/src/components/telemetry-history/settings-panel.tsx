import React, { useEffect, useState } from "react";
import { useI18n } from "@/i18n/provider";
import { historyApi } from "./api";
import type { HistorySettings } from "./types";

const inputClass = "bg-zinc-800 text-zinc-100 border border-zinc-700 rounded px-2 py-1 text-xs";
const btn = "px-2 py-1 rounded text-xs border";

/** Which channels are recorded and how long the history is kept. */
export default function SettingsPanel({ carId, onClose, onSaved }: { carId: number; onClose: () => void; onSaved: (s: HistorySettings) => void }) {
  const t = useI18n().messages.telemetryHistory;
  const [settings, setSettings] = useState<HistorySettings | null>(null);
  const [days, setDays] = useState(7);
  const [recorded, setRecorded] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    historyApi.settings(carId).then(s => {
      setSettings(s);
      setDays(s.retentionDays);
      setRecorded(new Set(s.channels.filter(c => c.record).map(c => c.id)));
    }).catch(e => setError(String(e.message ?? e)));
  }, [carId]);

  const toggle = (id: number) => setRecorded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const s = await historyApi.saveSettings(carId, days, [...recorded]);
      setSettings(s);
      onSaved(s);
      onClose();
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-3 text-xs space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm text-zinc-100">{t.recording}</h2>
        <button className={`${btn} bg-zinc-800 border-zinc-700 text-zinc-300`} onClick={onClose}>{t.cancel}</button>
      </div>
      {error && <div className="text-red-300">{t.error(error)}</div>}
      {!settings && !error && <div className="text-zinc-500">{t.loading}</div>}
      {settings && (
        <>
          <label className="flex items-center gap-2 text-zinc-300">
            {t.retention}
            <input type="number" min={1} max={365} className={inputClass + " w-20"} value={days}
              onChange={e => setDays(Math.max(1, Math.min(365, Number(e.target.value) || 1)))} />
          </label>
          <div className="text-zinc-500">{t.retentionHint}</div>
          <div>
            <div className="text-zinc-300 mb-1">{t.channelsToRecord}</div>
            {settings.channels.length === 0 && <div className="text-zinc-500">{t.noChannels}</div>}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1">
              {settings.channels.map(c => (
                <label key={c.id} className={`flex items-center gap-2 px-2 py-1 rounded border border-zinc-800 ${c.recordable ? "text-zinc-200" : "text-zinc-600"}`}>
                  <input type="checkbox" disabled={!c.recordable} checked={recorded.has(c.id)} onChange={() => toggle(c.id)} />
                  <span className="font-mono">{c.name}</span>
                  {c.unit && <span className="text-zinc-500">[{c.unit}]</span>}
                  {!c.recordable && <span className="ml-auto text-[10px]">{t.notRecordable}</span>}
                </label>
              ))}
            </div>
          </div>
          <div className="text-zinc-500">{t.rateHint}</div>
          <button className={`${btn} bg-sky-700 hover:bg-sky-600 border-sky-600 text-white disabled:opacity-50`} disabled={busy} onClick={save}>
            {busy ? t.saving : t.save}
          </button>
        </>
      )}
    </div>
  );
}
