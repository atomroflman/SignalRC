"use client";

import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";
import { useI18n } from "@/i18n/provider";
import { useControlFlowStore } from "./control-flow-store";

// Lets the version badge bring a dismissed banner back: every request counts up.
export const useVersionBannerReopen = create<{ requests: number; reopen(): void }>((set) => ({
  requests: 0,
  reopen: () => set((s) => ({ requests: s.requests + 1 })),
}));

type VersionInfo = { branch: string; commit: string | null };
// Mirrors SignalRC.Shared.Update.OnboardUpdateStatus (Docs/OnboardAutoUpdate.md).
type UpdateStatus = {
  state: string;
  autoUpdateEnabled: boolean;
  targetCommit: string | null;
  progressPercent: number | null;
  message: string | null;
  canUpdateManually: boolean;
  changedAtUtc: string;
};
export type VersionSync = {
  server: VersionInfo;
  onboard: VersionInfo | null;
  mismatch: boolean;
  update: UpdateStatus | null;
};
type UpdateRequestResult = { accepted: boolean; message: string | null };

// States in which the update runs; the controls stay locked meanwhile.
const RUNNING_STATES = new Set(["downloading", "installing", "restarting"]);
// States worth showing even when the versions match.
const NOTEWORTHY_STATES = new Set([...RUNNING_STATES, "failed", "rolledBack", "blocked", "runtimeMissing", "noPackage"]);

function fingerprint(payload: VersionSync | null, update: UpdateStatus | null): string {
  if (!payload) return "none";
  const onboard = payload.onboard ?? { branch: "?", commit: "?" };
  return [
    payload.server.branch,
    payload.server.commit ?? "?",
    onboard.branch,
    onboard.commit ?? "?",
    payload.onboard ? "ok" : "pending",
    update?.state ?? "-",
  ].join("|");
}

export default function VersionBanner({ carId }: { carId: number }) {
  const { messages } = useI18n();
  const t = messages.versionBanner;
  const [data, setData] = useState<VersionSync | null>(null);
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [dismissedFor, setDismissedFor] = useState<string>("none");
  const [requestError, setRequestError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const connection = useControlFlowStore((s) => s.connection);
  const carSession = useControlFlowStore((s) => s.carSession);
  const sessionCarId = useControlFlowStore((s) => s.carId);
  const onboardUpdating = useControlFlowStore((s) => s.onboardUpdating);
  const setOnboardUpdating = useControlFlowStore((s) => s.setOnboardUpdating);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/cars/${carId}/version-sync`);
        if (!res.ok) return;
        const body = (await res.json()) as VersionSync;
        if (!cancelled) {
          setData(body);
          if (body.update) setUpdate(body.update);
        }
      } catch {
        // ponytail: silent retry, mismatch stays visible from last good response
      }
    };
    void load();
    const id = setInterval(load, 30_000);
    const stored = window.localStorage.getItem(`versionBanner:dismissed:${carId}`) ?? "none";
    setDismissedFor(stored);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [carId]);

  // Live status from the onboard, pushed by the server to every browser.
  useEffect(() => {
    if (!connection) return;
    const handler = (statusCarId: number, status: UpdateStatus) => {
      if (statusCarId === carId) setUpdate(status);
    };
    connection.on("OnboardUpdateStatusChanged", handler);
    return () => connection.off("OnboardUpdateStatusChanged", handler);
  }, [connection, carId]);

  // The driver's update ends the session: once the onboard is no longer busy, the lock goes.
  useEffect(() => {
    if (onboardUpdating && update && !RUNNING_STATES.has(update.state)) setOnboardUpdating(false);
  }, [onboardUpdating, update, setOnboardUpdating]);

  const reopenRequests = useVersionBannerReopen((s) => s.requests);
  useEffect(() => {
    if (reopenRequests === 0) return;
    setDismissedFor("none");
    window.localStorage.removeItem(`versionBanner:dismissed:${carId}`);
  }, [reopenRequests, carId]);

  const currentFingerprint = useMemo(() => fingerprint(data, update), [data, update]);
  const dismiss = () => {
    setDismissedFor(currentFingerprint);
    window.localStorage.setItem(`versionBanner:dismissed:${carId}`, currentFingerprint);
  };

  const isDriver = Boolean(connection && carSession && sessionCarId === carId);
  const canUpdateNow = isDriver && Boolean(update?.canUpdateManually) && !onboardUpdating && !requesting;

  const requestUpdate = async () => {
    if (!connection || !carSession) return;
    setRequesting(true);
    setRequestError(null);
    try {
      const result = (await connection.invoke("RequestOnboardUpdate", carId, carSession)) as UpdateRequestResult;
      if (result?.accepted) setOnboardUpdating(true);
      else setRequestError(t.updateRefused(result?.message ?? "?"));
    } catch (err) {
      console.error("RequestOnboardUpdate failed:", err);
      setRequestError(t.updateRequestFailed);
    } finally {
      setRequesting(false);
    }
  };

  if (!data) return null;

  if (!data.onboard) {
    if (dismissedFor === currentFingerprint) return null;
    return (
      <div className="pointer-events-auto fixed left-1/2 top-4 z-50 max-w-md -translate-x-1/2 rounded-lg border border-amber-700/60 bg-amber-900/90 px-4 py-3 text-xs text-amber-100 shadow-lg backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-semibold">{t.title}</div>
            <div className="mt-1 opacity-90">{t.unknownOnboard}</div>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label={t.dismiss}
            className="rounded p-1 text-amber-200 hover:bg-amber-800/60"
          >
            ✕
          </button>
        </div>
      </div>
    );
  }

  const running = onboardUpdating || (update != null && RUNNING_STATES.has(update.state));
  const noteworthy = update != null && NOTEWORTHY_STATES.has(update.state);
  if (!data.mismatch && !noteworthy && !onboardUpdating) return null;
  // A running update cannot be dismissed: the driver must see why the controls are locked.
  if (!running && dismissedFor === currentFingerprint) return null;

  const s = data.server;
  const o = data.onboard;
  const stateText = update ? t.updateState[update.state] ?? update.state : null;
  return (
    <div className="pointer-events-auto fixed left-1/2 top-4 z-50 max-w-md -translate-x-1/2 rounded-lg border border-red-700/60 bg-red-900/90 px-4 py-3 text-xs text-red-100 shadow-lg backdrop-blur">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold">{t.title}</div>
          {data.mismatch && (
            <div className="mt-1 opacity-90">
              {t.mismatchDetail(s.branch, s.commit ?? "?", o.branch, o.commit ?? "?")}
            </div>
          )}
          {update && (
            <div className="mt-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{stateText}</span>
                <span className="rounded bg-red-950/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wide opacity-80">
                  {update.autoUpdateEnabled ? t.autoUpdateOn : t.autoUpdateOff}
                </span>
              </div>
              {update.message && <div className="mt-1 opacity-80">{update.message}</div>}
              {update.state === "downloading" && update.progressPercent != null && (
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-red-950/60">
                  <div className="h-full bg-red-200" style={{ width: `${Math.min(100, update.progressPercent)}%` }} />
                </div>
              )}
            </div>
          )}
          {!update && data.mismatch && <div className="mt-1 opacity-80">{t.hint}</div>}
          {canUpdateNow && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => void requestUpdate()}
                className="rounded bg-red-200 px-2 py-1 text-[11px] font-semibold text-red-950 hover:bg-white"
              >
                {t.updateNow}
              </button>
              <div className="mt-1 text-[11px] opacity-80">{t.updateNowHint}</div>
            </div>
          )}
          {requestError && <div className="mt-1 font-medium text-amber-200">{requestError}</div>}
        </div>
        {!running && (
          <button
            type="button"
            onClick={dismiss}
            aria-label={t.dismiss}
            className="rounded p-1 text-red-200 hover:bg-red-800/60"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
