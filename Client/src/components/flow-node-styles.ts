// Shared look of the flow editor nodes: neutral grays with high-contrast text.
// Handles, edges and canvas controls are styled in globals.css.
export const flowNodeStyles = {
  card: "bg-zinc-800 border border-zinc-600 rounded-lg shadow-lg shadow-black/40 text-zinc-100 p-3 flex flex-col relative",
  header: "flex items-center justify-between gap-2 pb-2 mb-2 border-b border-zinc-700",
  // Header of a node without body (input/output channels).
  headerBare: "flex items-center justify-between gap-2",
  title: "truncate text-[13px] font-semibold text-zinc-50",
  headerValue: "truncate text-xs font-mono tabular-nums text-zinc-300",
  deleteButton: "shrink-0 w-5 h-5 grid place-items-center rounded text-[11px] text-zinc-400 hover:text-red-300 hover:bg-red-950/60 transition-colors",
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
