import React, { useState } from "react";
import { useRouter } from "next/router";
import { pillButtonClass } from "@/components/status-pill";
import { useI18n } from "@/i18n/provider";
import { hasStoredVehicleKey, openConfigSessionWithStoredKey, useVehicleAccess } from "./vehicle-access";

/**
 * Title bar button into the vehicle configuration (Docs/VehicleKeyAuth.md). Shown when
 * this browser may configure (control or config session) or holds the vehicle key, so
 * it can open a config session itself; a click without a session opens one first.
 */
export default function ConfigButton({ carId }: { carId: number | undefined }) {
  const { messages } = useI18n();
  const router = useRouter();
  const { access } = useVehicleAccess(carId);
  const [busy, setBusy] = useState(false);
  if (!carId || !access) return null;
  const canOpen = hasStoredVehicleKey(carId) && access.ownerKeyKnown;
  if (!access.configure && !canOpen) return null;

  const onClick = async () => {
    if (!access.configure) {
      setBusy(true);
      const result = await openConfigSessionWithStoredKey(carId);
      setBusy(false);
      if (!result.ok) {
        const m = messages.configGuard;
        window.alert(result.reason === "signature" ? m.signatureRejected
          : result.reason === "noOwnerKey" ? m.noOwnerKey
          : m.sessionFailed(result.message || result.reason));
        return;
      }
    }
    void router.push(`/car/${carId}/setup`);
  };

  return (
    <button type="button" onClick={onClick} disabled={busy} className={`${pillButtonClass} disabled:opacity-60`} title={messages.home.configureTitle(carId)}>
      <svg aria-hidden viewBox="0 0 24 24" className={`h-3.5 w-3.5 text-slate-300 ${busy ? "animate-spin" : ""}`} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
      {messages.home.configure}
    </button>
  );
}
