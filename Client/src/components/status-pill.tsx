import React from "react";

/** Shared look of the status badges: dark pill, same height everywhere, state by a coloured dot. */
export const pillBase =
  "inline-flex h-8 shrink-0 items-center rounded-full bg-slate-800/90 text-[11px] font-medium text-slate-200 shadow-sm ring-1 ring-white/10";
export const pillClass = `${pillBase} gap-1.5 px-3`;
/** For pills that are buttons. */
export const pillButtonClass = `${pillClass} cursor-pointer transition hover:bg-slate-700/90 hover:text-white`;

export type DotTone = "ok" | "info" | "busy" | "error" | "off";

const DOT: Record<DotTone, string> = {
  ok: "bg-emerald-400",
  info: "bg-sky-400",
  busy: "bg-amber-400 animate-pulse",
  error: "bg-red-400",
  off: "bg-slate-500",
};

export function StatusDot({ tone }: { tone: DotTone }) {
  return <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[tone]}`} />;
}
