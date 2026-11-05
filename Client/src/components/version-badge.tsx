"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/i18n/provider";
import { useCarUiStore } from "./car-ui-store";
import { useVersionBannerReopen, type VersionSync } from "./version-banner";
import { pillButtonClass, pillClass, StatusDot, type DotTone } from "./status-pill";

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

  // Every state but "synced" has a banner; clicking the badge brings it back after dismissing.
  let opensBanner = true;
  let tone: DotTone;
  let label: string;
  if (data.update && RUNNING_STATES.has(data.update.state)) {
    tone = "busy";
    label = t.badgeUpdating;
  } else if (!data.onboard) {
    tone = "off";
    label = t.badgeUnknown;
  } else if (data.mismatch) {
    tone = "error";
    label = t.badgeMismatch;
  } else {
    tone = "ok";
    label = t.badgeSynced(short(data.server.commit));
    opensBanner = false;
  }

  const content = (
    <>
      <StatusDot tone={tone} />
      <span className="font-mono">{label}</span>
    </>
  );
  if (!opensBanner) return <div title={title} className={pillClass}>{content}</div>;
  return (
    <button
      type="button"
      title={`${title}\n${t.badgeShowBanner}`}
      className={pillButtonClass}
      onClick={reopenBanner}
    >
      {content}
    </button>
  );
}
