"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/i18n/provider";
import { useCarUiStore } from "./car-ui-store";
import { useVersionBannerReopen, type VersionSync } from "./version-banner";

// States of OnboardUpdateStatus in which the update runs (Docs/OnboardAutoUpdate.md).
const RUNNING_STATES = new Set(["downloading", "installing", "restarting"]);

function short(commit: string | null | undefined): string {
  return commit ? commit.slice(0, 7) : "?";
}

/**
 * Small version indicator for the status bar. The banner only appears on a mismatch;
 * this shows the matching case too, so "nothing visible" no longer means "unknown".
 */
export default function VersionBadge({ carId }: { carId: number }) {
  const { messages } = useI18n();
  const t = messages.versionBanner;
  const [data, setData] = useState<VersionSync | null>(null);
  const reopenBanner = useVersionBannerReopen((s) => s.reopen);
  // Pushed by the server when the onboard reports its version; the poll is only the fallback.
  const versionEpoch = useCarUiStore((s) => s.versionEpoch);
  const connectCarUi = useCarUiStore((s) => s.connect);
  useEffect(() => { void connectCarUi(); }, [connectCarUi]);

  useEffect(() => setData(null), [carId]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/cars/${carId}/version-sync`);
        if (!res.ok) return;
        const body = (await res.json()) as VersionSync;
        if (!cancelled) setData(body);
      } catch {
        // keep the last good state
      }
    };
    void load();
    const id = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [carId, versionEpoch]);

  if (!data) return null;

  const server = `${data.server.branch} @ ${short(data.server.commit)}`;
  const onboard = data.onboard ? `${data.onboard.branch} @ ${short(data.onboard.commit)}` : "?";
  const title = t.badgeTitle(server, onboard);

  let tone: string;
  // Every state but "synced" has a banner; clicking the badge brings it back after dismissing.
  let opensBanner = true;
  let dot: string;
  let label: string;
  if (data.update && RUNNING_STATES.has(data.update.state)) {
    tone = "bg-amber-900/60 text-amber-200 ring-amber-500/30";
    dot = "bg-amber-400 animate-pulse";
    label = t.badgeUpdating;
  } else if (!data.onboard) {
    tone = "bg-slate-800/90 text-slate-400 ring-white/10";
    dot = "bg-slate-500";
    label = t.badgeUnknown;
  } else if (data.mismatch) {
    tone = "bg-red-900/60 text-red-200 ring-red-500/30";
    dot = "bg-red-400";
    label = t.badgeMismatch;
  } else {
    tone = "bg-emerald-900/50 text-emerald-200 ring-emerald-500/30";
    dot = "bg-emerald-400";
    label = t.badgeSynced(short(data.server.commit));
    opensBanner = false;
  }

  const className = `flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-[11px] font-medium shadow-sm ring-1 ${tone}`;
  const content = (
    <>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      <span className="font-mono">{label}</span>
    </>
  );
  if (!opensBanner) return <div title={title} className={className}>{content}</div>;
  return (
    <button
      type="button"
      title={`${title}\n${t.badgeShowBanner}`}
      className={`${className} cursor-pointer hover:brightness-125 transition`}
      onClick={reopenBanner}
    >
      {content}
    </button>
  );
}
