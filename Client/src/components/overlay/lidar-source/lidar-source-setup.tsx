"use client";

// Isolated helper for the LiDAR HUD source (D17, lidar/README.md §7): sets up
// the grid channel after an explicit confirmation and edits its source
// options. AP13 places it on the channel management / HUD pages.
import React, { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/i18n/provider";
import { lidarSourceMessages } from "./messages";
import { loadGridChannel, saveGridOptions, setupGridSource, type Failure, type Fetch } from "./api";
import { parseZoneLimits, readOptions, validateOptions, type LidarGridOptions, type TelemetryChannelItem } from "./options";

const inputClass = "bg-zinc-800 text-zinc-100 border border-zinc-700 rounded px-2 py-1 text-xs";
const btnPrimary = "px-2 py-1 bg-green-900 hover:bg-green-800 text-green-100 rounded text-xs border border-green-800 disabled:opacity-50";
const btnGhost = "px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-xs border border-zinc-700";

type Props = {
  carId: number;
  /** Called after the channel was created or its options saved. */
  onChanged?: () => void;
  /** Injected in tests and previews; the browser fetch otherwise. */
  fetchImpl?: Fetch;
};

type Load = { state: "loading" } | { state: "failed" } | { state: "missing" } | { state: "present"; channel: TelemetryChannelItem };

export default function LidarSourceSetup({ carId, onChanged, fetchImpl }: Props) {
  const { locale } = useI18n();
  const m = lidarSourceMessages[locale] ?? lidarSourceMessages.de;
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [options, setOptions] = useState<LidarGridOptions>(readOptions(null));
  const [zonesText, setZonesText] = useState("");

  const reload = useCallback(async () => {
    const r = await loadGridChannel(carId, fetchImpl);
    if (!r.ok) { setLoad({ state: "failed" }); return; }
    if (!r.channel) { setLoad({ state: "missing" }); return; }
    const o = readOptions(r.channel.options);
    setOptions(o);
    setZonesText(o.zoneLimitsMm.join(", "));
    setLoad({ state: "present", channel: r.channel });
  }, [carId, fetchImpl]);

  useEffect(() => { reload(); }, [reload]);

  const deniedText = (f: Failure) =>
    m.denied[f.code && f.code in m.denied ? (f.code as keyof typeof m.denied) : "other"];

  const setup = async () => {
    setBusy(true);
    try {
      const r = await setupGridSource(carId, fetchImpl);
      if (!r.ok) { setNotice(deniedText(r)); return; }
      setNotice(r.created ? m.created : m.alreadyPresent);
      setConfirming(false);
      await reload();
      if (r.created) onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  const edited: LidarGridOptions = { ...options, zoneLimitsMm: parseZoneLimits(zonesText) };
  const errors = validateOptions(edited);

  const save = async () => {
    if (load.state !== "present" || errors.length > 0) return;
    setBusy(true);
    try {
      const r = await saveGridOptions(carId, load.channel, edited, fetchImpl);
      setNotice(r.ok ? m.saved : m.saveFailed);
      if (r.ok) { await reload(); onChanged?.(); }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-2 p-2 border border-zinc-700 rounded bg-zinc-950 text-xs text-zinc-200">
      <h3 className="text-sm font-semibold text-zinc-100">{m.title}</h3>
      {load.state === "loading" && <p className="text-zinc-400">{m.loading}</p>}
      {load.state === "failed" && <p className="text-red-300">{m.loadFailed}</p>}

      {load.state === "missing" && (
        <div className="flex flex-col gap-2">
          <p className="text-zinc-300">{m.missing}</p>
          {!confirming ? (
            <div><button className={btnPrimary} onClick={() => setConfirming(true)}>{m.setup}</button></div>
          ) : (
            <div className="flex flex-col gap-2 p-2 border border-amber-800 rounded">
              <p>{m.confirmQuestion}</p>
              <div className="flex gap-2">
                <button className={btnPrimary} disabled={busy} onClick={setup}>{m.confirm}</button>
                <button className={btnGhost} disabled={busy} onClick={() => setConfirming(false)}>{m.cancel}</button>
              </div>
            </div>
          )}
        </div>
      )}

      {load.state === "present" && (
        <div className="grid grid-cols-2 gap-2">
          <p className="col-span-2 text-zinc-400">{m.present}</p>
          <label className="flex flex-col gap-1">
            <span className="text-zinc-400">{m.mountYaw}</span>
            <input className={inputClass} type="number" step="0.25" value={Number.isFinite(options.mountYawDeg) ? options.mountYawDeg : ""}
              onChange={e => setOptions(o => ({ ...o, mountYawDeg: e.target.value === "" ? NaN : Number(e.target.value) }))} />
            <span className="text-zinc-500 text-[10px]">{m.mountYawHint}</span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-zinc-400">{m.zoneLimits}</span>
            <input className={inputClass} value={zonesText} onChange={e => setZonesText(e.target.value)} />
            <span className="text-zinc-500 text-[10px]">{m.zoneLimitsHint}</span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-zinc-400">{m.neighborMax}</span>
            <input className={inputClass} type="number" min={1} value={Number.isFinite(options.neighborMaxMm) ? options.neighborMaxMm : ""}
              onChange={e => setOptions(o => ({ ...o, neighborMaxMm: e.target.value === "" ? NaN : Number(e.target.value) }))} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-zinc-400">{m.minGroupPoints}</span>
            <input className={inputClass} type="number" min={1} value={Number.isFinite(options.minGroupPoints) ? options.minGroupPoints : ""}
              onChange={e => setOptions(o => ({ ...o, minGroupPoints: e.target.value === "" ? NaN : Number(e.target.value) }))} />
          </label>
          <label className="col-span-2 flex items-center gap-2">
            <input type="checkbox" checked={options.scannerClockwise}
              onChange={e => setOptions(o => ({ ...o, scannerClockwise: e.target.checked }))} />
            <span>{m.scannerClockwise}</span>
            <span className="text-zinc-500 text-[10px]">{m.scannerClockwiseHint}</span>
          </label>
          {errors.length > 0 && (
            <ul className="col-span-2 text-red-300 list-disc pl-4">
              {errors.map(e => <li key={e}>{m.errors[e]}</li>)}
            </ul>
          )}
          <div className="col-span-2 flex justify-end">
            <button className={btnPrimary} disabled={busy || errors.length > 0} onClick={save}>{m.save}</button>
          </div>
        </div>
      )}

      {notice && <p className="text-zinc-300" role="status">{notice}</p>}
    </section>
  );
}
