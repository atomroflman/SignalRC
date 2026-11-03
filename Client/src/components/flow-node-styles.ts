// Shared look of the flow editor nodes: neutral grays with high-contrast text.
// Handles, edges and canvas controls are styled in globals.css.
export const flowNodeStyles = {
  card: "bg-zinc-800 border border-zinc-600 rounded-lg shadow-lg shadow-black/40 text-zinc-100 flex flex-col relative",
  // Title bar (flow-node-header.tsx): a lighter gray strip over the card body.
  titleBar: "flex items-center gap-2 pl-3 pr-1.5 py-1 bg-zinc-700 border-b border-zinc-600 rounded-t-lg",
  title: "truncate text-[13px] font-semibold text-zinc-50",
  titleValue: "shrink-0 font-mono tabular-nums text-[11px] text-zinc-100 bg-zinc-800/80 rounded px-1.5 py-0.5",
  iconButton: "shrink-0 w-6 h-6 grid place-items-center rounded text-zinc-300 hover:text-zinc-50 hover:bg-zinc-600 transition-colors",
  infoPopover: "invisible opacity-0 group-hover/info:visible group-hover/info:opacity-100 group-focus-within/info:visible group-focus-within/info:opacity-100 transition-opacity absolute right-0 top-full mt-1.5 z-50 w-72 p-3 rounded-md bg-zinc-950 border border-zinc-600 shadow-xl shadow-black/60 text-xs leading-relaxed font-normal whitespace-normal cursor-default",
  body: "p-3 flex flex-col",
  panel: "bg-zinc-900/70 border border-zinc-700 rounded-md p-2 mb-2",
  label: "text-[11px] text-zinc-400",
  primaryValue: "text-lg font-semibold font-mono tabular-nums text-zinc-50",
  secondaryValue: "text-sm font-mono tabular-nums text-zinc-100",
  hint: "text-[11px] text-zinc-400",
  input: "bg-zinc-900 border border-zinc-600 rounded px-2 py-0.5 text-xs text-zinc-100 focus:border-zinc-400 focus:outline-none",
  button: "px-1.5 py-1 rounded text-xs font-mono bg-zinc-700 hover:bg-zinc-600 text-zinc-100 transition-colors",
  buttonSoft: "px-1.5 py-1 rounded text-xs font-mono bg-zinc-900 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 transition-colors",
  // Port labels sit outside the card, right of the handle, so they never cover content or the edge.
  inputLabel: "absolute left-3 bottom-1 text-[10px] font-mono text-zinc-300 whitespace-nowrap pointer-events-none",
  outputLabel: "absolute left-3 top-1 text-[10px] font-mono text-zinc-300 whitespace-nowrap pointer-events-none",
};

export function handleOffset(index: number, count: number) {
  return { left: `${100 / (count + 1) * (index + 1)}%` };
}
