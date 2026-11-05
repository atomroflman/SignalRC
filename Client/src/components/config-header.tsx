import React from "react";
import Link from "next/link";
import LanguageSwitcher from "@/components/language-switcher";
import { useControlFlowStore } from "@/components/control-flow-store";
import { sendState } from "@/components/overlay/integration/editor-control";
import { useI18n } from "@/i18n/provider";

/** The configuration areas of a vehicle, switched in the shared title bar. */
export const CONFIG_SECTIONS = ["setup", "hud", "flow", "logs", "telemetry"] as const;
export type ConfigSection = typeof CONFIG_SECTIONS[number];

const sectionHref = (carId: number, section: ConfigSection) => {
  switch (section) {
    case "setup": return `/car/${carId}/setup`;
    case "hud": return `/car/${carId}/overlay`;
    case "flow": return `/car/${carId}/flow`;
    case "logs": return `/car/${carId}/logs`;
    case "telemetry": return `/car/${carId}/telemetry`;
  }
};

type Props = {
  carId: number;
  active: ConfigSection;
  /** Page specific buttons on the right. */
  actions?: React.ReactNode;
  className?: string;
};

/** Shared title bar of the setup, HUD, flow engine, log and telemetry pages. */
export default function ConfigHeader({ carId, active, actions, className = "" }: Props) {
  const { messages } = useI18n();
  const m = messages.configHeader;
  const live = useControlFlowStore(s => sendState(s, carId) === "live");

  // Opening the HUD editor pauses sending; ask first while the vehicle is driven.
  const onHudClick = (e: React.MouseEvent) => {
    if (live && !window.confirm(m.confirmHudWhileLive)) e.preventDefault();
  };

  return (
    <div className={`flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-zinc-800 ${className}`.trim()}>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-1 min-w-0">
        <div className="flex items-center gap-3 pb-2">
          <Link href="/" className="text-blue-400 hover:underline text-sm">&larr; {m.back}</Link>
          <h1 className="text-lg whitespace-nowrap">{m.vehicle(carId)}</h1>
        </div>
        <nav aria-label={m.sectionsLabel} className="flex gap-1 overflow-x-auto overflow-y-hidden">
          {CONFIG_SECTIONS.map(section => {
            const isActive = section === active;
            return (
              <Link
                key={section}
                href={sectionHref(carId, section)}
                aria-current={isActive ? "page" : undefined}
                onClick={section === "hud" && !isActive ? onHudClick : undefined}
                className={`shrink-0 px-3 py-2 text-sm border-b-2 -mb-px ${isActive ? "border-green-500 text-zinc-100" : "border-transparent text-zinc-400 hover:text-zinc-200"}`}
              >
                {m.sections[section]}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="flex flex-wrap items-center gap-2 pb-2">
        {actions}
        <LanguageSwitcher />
      </div>
    </div>
  );
}
