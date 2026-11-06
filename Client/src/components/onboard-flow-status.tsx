import React, { useState } from "react";
import { useControlFlowStore } from "./control-flow-store";
import { useI18n } from "@/i18n/provider";

// Which flow serves the vehicle right now (OnboardFlow-Arbeitspakete.md OF10/OF11):
// browser → hardware, browser → vehicle flow (mixed), or web detached. With
// `showToggle` the session holder can detach and reattach the web (E13).
export default function OnboardFlowStatusBanner({ showToggle, className = "" }: { showToggle?: boolean; className?: string }) {
  const { messages } = useI18n();
  const t = messages.onboardFlow;
  const status = useControlFlowStore(s => s.flowStatus);
  const carSession = useControlFlowStore(s => s.carSession);
  const setWebDetached = useControlFlowStore(s => s.setWebDetached);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mode = status?.mode;
  const text = mode === "detached" ? t.modeDetached : mode === "mixed" ? t.modeMixed : mode === "off" ? t.modeOff : t.modeUnknown;
  const tone = mode === "detached"
    ? "border-amber-600 bg-amber-950/60 text-amber-100"
    : mode === "mixed"
      ? "border-sky-700 bg-sky-950/50 text-sky-100"
      : "border-zinc-700 bg-zinc-900 text-zinc-200";

  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      const wanted = mode !== "detached";
      const result = await setWebDetached(wanted);
      if (wanted && !result) setError(t.detachFailed);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`rounded-lg border px-3 py-2 text-xs flex flex-wrap items-center gap-x-4 gap-y-1 ${tone} ${className}`} title={t.modeHint}>
      <span className="font-semibold">{text}</span>
      {mode && mode !== "off" && (
        <span className={status?.handoffConnected ? "text-emerald-300" : "text-zinc-400"}>
          {status?.handoffConnected ? t.handoffConnected : t.handoffDisconnected}
        </span>
      )}
      {(status?.devices ?? []).map(d => (
        <span key={d.key} className={d.connected ? "text-emerald-300" : "text-zinc-500"}>
          🎮 {d.name}: {d.connected ? t.controllerConnected : t.controllerDisconnected}
        </span>
      ))}
      {showToggle && carSession && mode && mode !== "off" && (
        <button
          className={`ml-auto px-2 py-1 rounded border text-[11px] transition-colors disabled:opacity-50 ${mode === "detached"
            ? "bg-zinc-800 border-zinc-600 hover:bg-zinc-700"
            : "bg-amber-900 border-amber-700 hover:bg-amber-800 text-amber-50"}`}
          disabled={busy}
          title={t.detachHint}
          onClick={toggle}
        >
          {mode === "detached" ? t.attach : t.detach}
        </button>
      )}
      {error && <span className="w-full text-red-300">{error}</span>}
    </div>
  );
}
