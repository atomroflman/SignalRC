"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/i18n/provider";

type VersionInfo = { branch: string; commit: string | null };
type VersionSync = {
  server: VersionInfo;
  onboard: VersionInfo | null;
  mismatch: boolean;
};

function fingerprint(payload: VersionSync | null): string {
  if (!payload) return "none";
  const onboard = payload.onboard ?? { branch: "?", commit: "?" };
  return [
    payload.server.branch,
    payload.server.commit ?? "?",
    onboard.branch,
    onboard.commit ?? "?",
    payload.onboard ? "ok" : "pending",
  ].join("|");
}

export default function VersionBanner({ carId }: { carId: number }) {
  const { messages } = useI18n();
  const t = messages.versionBanner;
  const [data, setData] = useState<VersionSync | null>(null);
  const [dismissedFor, setDismissedFor] = useState<string>("none");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/cars/${carId}/version-sync`);
        if (!res.ok) return;
        const body = (await res.json()) as VersionSync;
        if (!cancelled) setData(body);
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

  const currentFingerprint = useMemo(() => fingerprint(data), [data]);
  const dismiss = () => {
    setDismissedFor(currentFingerprint);
    window.localStorage.setItem(`versionBanner:dismissed:${carId}`, currentFingerprint);
  };

  if (!data) return null;

  if (!data.onboard) {
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

  if (!data.mismatch) return null;
  if (dismissedFor === currentFingerprint) return null;

  const s = data.server;
  const o = data.onboard;
  return (
    <div className="pointer-events-auto fixed left-1/2 top-4 z-50 max-w-md -translate-x-1/2 rounded-lg border border-red-700/60 bg-red-900/90 px-4 py-3 text-xs text-red-100 shadow-lg backdrop-blur">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold">{t.title}</div>
          <div className="mt-1 opacity-90">
            {t.mismatchDetail(s.branch, s.commit ?? "?", o.branch, o.commit ?? "?")}
          </div>
          <div className="mt-1 opacity-80">{t.hint}</div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t.dismiss}
          className="rounded p-1 text-red-200 hover:bg-red-800/60"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
