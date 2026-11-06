import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useControlFlowStore } from "@/components/control-flow-store";
import { pillButtonClass } from "@/components/status-pill";
import { useI18n } from "@/i18n/provider";

/**
 * Whether the server lets the signed-in user configure the vehicle (a user setup,
 * created when the user took control with the vehicle key). Checked again when a
 * control session starts, since that is when the server grants it.
 */
export function useConfigAccess(carId: number | undefined): boolean {
  const carSession = useControlFlowStore(s => s.carSession);
  const [access, setAccess] = useState<{ carId: number; ok: boolean } | null>(null);
  useEffect(() => {
    if (!carId) return;
    let cancelled = false;
    fetch(`/api/userconfig/has-config-access/${carId}`)
      .then(r => (r.ok ? r.json() : { hasAccess: false }))
      .then(d => { if (!cancelled) setAccess({ carId, ok: d?.hasAccess === true }); })
      .catch(() => { if (!cancelled) setAccess({ carId, ok: false }); });
    return () => { cancelled = true; };
  }, [carId, carSession]);
  return !!carId && access?.carId === carId && access.ok;
}

/** Title bar button into the vehicle configuration; only shown with access. */
export default function ConfigButton({ carId }: { carId: number | undefined }) {
  const { messages } = useI18n();
  const allowed = useConfigAccess(carId);
  if (!carId || !allowed) return null;
  return (
    <Link href={`/car/${carId}/setup`} className={pillButtonClass} title={messages.home.configureTitle(carId)}>
      <svg aria-hidden viewBox="0 0 24 24" className="h-3.5 w-3.5 text-slate-300" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
      {messages.home.configure}
    </Link>
  );
}
