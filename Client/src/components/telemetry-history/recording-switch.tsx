import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/i18n/provider";
import { useControlFlowStore } from "@/components/control-flow-store";
import { historyApi } from "./api";
import type { RecordingState } from "./types";

const POLL_MS = 5000;

/**
 * Main page section: shows whether the telemetry history records and lets the
 * driver who controls the vehicle stop or resume it (stored per vehicle).
 */
export default function RecordingSwitch({ carId }: { carId: number }) {
  const t = useI18n().messages.telemetryHistory;
  // Taking or releasing control changes who may switch.
  const carSession = useControlFlowStore(state => state.carSession);
  const [state, setState] = useState<RecordingState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setState(await historyApi.recording(carId));
    } catch {
      // keep the last state; the next poll retries
    }
  }, [carId]);

  useEffect(() => {
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [load, carSession]);

  const toggle = async () => {
    if (!state) return;
    setBusy(true);
    setError(null);
    try {
      setState(await historyApi.setRecordingStopped(carId, !state.stopped));
    } catch (e) {
      setError((e as Error).message);
      void load();
    } finally {
      setBusy(false);
    }
  };

  if (!state) return <div className="text-xs text-zinc-500">{t.loading}</div>;

  const status = state.stopped
    ? t.recordingStopped
    : state.channels === 0
      ? t.recordingNoChannels
      : state.recording ? t.recordingRuns(state.channels) : t.recordingIdle(state.channels);
  const dot = state.stopped ? "bg-zinc-500" : state.recording ? "bg-red-500 animate-pulse" : "bg-amber-400";

  return (
    <div className="text-xs space-y-2 p-2">
      <div className="flex items-center gap-2 text-zinc-200">
        <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />
        <span>{status}</span>
      </div>
      {state.canChange ? (
        <button
          className={`px-2 py-1 rounded text-xs text-white border disabled:opacity-50 ${state.stopped ? "bg-green-700 hover:bg-green-600 border-green-600" : "bg-amber-700 hover:bg-amber-600 border-amber-600"}`}
          disabled={busy}
          onClick={toggle}
        >
          {state.stopped ? t.resumeRecording : t.stopRecording}
        </button>
      ) : (
        <div className="text-[11px] text-zinc-400">{t.onlyDriver}</div>
      )}
      {error && <div className="text-red-300">{t.error(error)}</div>}
      <Link href={`/car/${carId}/telemetry`} className="text-blue-400 hover:underline block">{t.openHistory}</Link>
    </div>
  );
}
