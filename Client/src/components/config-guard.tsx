"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { useI18n } from "@/i18n/provider";
import { hasStoredVehicleKey, openConfigSessionWithStoredKey, useVehicleAccess } from "./vehicle-access";

interface ConfigGuardProps {
  children: React.ReactNode;
  carId: number;
}

/**
 * Configuration pages need a control or config session (Docs/VehicleKeyAuth.md); the
 * server checks every request, this only decides what to show. With the vehicle key
 * stored in this browser a config session is opened right away, also while the
 * vehicle is offline.
 */
export default function ConfigGuard({ children, carId }: ConfigGuardProps) {
  const { messages } = useI18n();
  const m = messages.configGuard;
  const router = useRouter();
  const { access, loading, refresh } = useVehicleAccess(carId);
  const [opening, setOpening] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // One automatic attempt per lost session; reset once access is there again.
  const attempted = useRef(false);

  useEffect(() => {
    if (access?.configure) {
      attempted.current = false;
      setFailure(null);
      return;
    }
    if (!access || attempted.current || !hasStoredVehicleKey(carId)) return;
    attempted.current = true;
    if (!access.ownerKeyKnown) {
      setFailure(m.noOwnerKey);
      return;
    }
    setOpening(true);
    void openConfigSessionWithStoredKey(carId).then(result => {
      setOpening(false);
      if (result.ok) {
        refresh();
        return;
      }
      setFailure(result.reason === "signature" ? m.signatureRejected
        : result.reason === "noOwnerKey" ? m.noOwnerKey
        : m.sessionFailed(result.message || result.reason));
    });
  }, [access, carId, refresh, m]);

  // A session ends after 2 h idle or with a server restart: look again when the tab comes back.
  useEffect(() => {
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  if (access?.configure) return <>{children}</>;

  const willOpen = !!access && !attempted.current && hasStoredVehicleKey(carId) && access.ownerKeyKnown;
  if (loading || opening || willOpen) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-zinc-950 text-white p-8">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-300">{opening || willOpen ? m.openingSession : m.checkingAccess}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-zinc-950 text-white p-8">
      <div className="text-center max-w-md">
        <h1 className="text-2xl font-bold mb-4 text-red-400">{m.accessDenied}</h1>
        <p className="text-gray-300 mb-6">{failure ?? m.authenticationRequired}</p>
        <p className="text-sm text-gray-400 mb-8">{m.returnToMainHint}</p>
        <button
          onClick={() => router.push("/")}
          className="px-6 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
        >
          {m.goToMainPage}
        </button>
      </div>
    </div>
  );
}
