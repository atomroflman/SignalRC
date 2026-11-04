import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import LanguageSwitcher from "@/components/language-switcher";
import ConfigGuard from "@/components/config-guard";

/** One forwarded onboard log line (Shared/Logs/OnboardLogEntry.cs); level is Microsoft.Extensions.Logging.LogLevel. */
type LogEntry = { seq: number; timestampUtc: string; level: number; category: string; message: string; exception?: string | null };

const POLL_MS = 2000;
// The server keeps 5000 per car; the page keeps as many.
const MAX_ENTRIES = 5000;
const LEVELS = ["Trace", "Debug", "Info", "Warning", "Error", "Critical"];
const LEVEL_CLASS = ["text-zinc-500", "text-zinc-400", "text-sky-300", "text-amber-300", "text-red-300", "text-red-200 font-bold"];

const inputClass = "bg-zinc-800 text-zinc-100 border border-zinc-700 rounded px-2 py-1 text-xs";
const btnGhost = "px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-xs border border-zinc-700";

const shortCategory = (category: string) => category.slice(category.lastIndexOf(".") + 1);
const time = (utc: string) => {
  const d = new Date(utc);
  return `${d.toLocaleTimeString([], { hour12: false })}.${String(d.getMilliseconds()).padStart(3, "0")}`;
};

/** The onboard log, forwarded through the server (Information and up unless LogForwarding:MinLevel says otherwise). */
export default function LogsPage() {
  const router = useRouter();
  const carId = router.query.carId as string;
  const carIdNum = carId ? parseInt(carId) : undefined;

  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [minLevel, setMinLevel] = useState(2);
  const [filter, setFilter] = useState("");
  const [paused, setPaused] = useState(false);
  const [follow, setFollow] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lastSeq = useRef(0);
  const bottom = useRef<HTMLDivElement>(null);

  // ?q=<channel> from the channel page's status line.
  useEffect(() => {
    if (typeof router.query.q === "string") setFilter(router.query.q);
  }, [router.query.q]);

  useEffect(() => {
    if (!carIdNum || paused) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const r = await fetch(`/api/cars/${carIdNum}/logs?after=${lastSeq.current}`);
        if (cancelled) return;
        if (!r.ok) { setError(r.status === 401 ? "No access to this vehicle's log." : `Server answered ${r.status}.`); return; }
        const data = await r.json();
        setError(null);
        const fresh: LogEntry[] = Array.isArray(data.entries) ? data.entries : [];
        // A smaller lastSeq means the server restarted: start over.
        const restarted = typeof data.lastSeq === "number" && data.lastSeq < lastSeq.current;
        if (typeof data.lastSeq === "number") lastSeq.current = data.lastSeq;
        if (restarted) { setEntries(fresh); return; }
        if (fresh.length > 0) setEntries(prev => [...prev, ...fresh].slice(-MAX_ENTRIES));
      } catch {
        if (!cancelled) setError("Server not reachable.");
      }
    };
    void poll();
    const timer = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [carIdNum, paused]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return entries.filter(e => e.level >= minLevel
      && (!q || e.message.toLowerCase().includes(q) || e.category.toLowerCase().includes(q) || (e.exception?.toLowerCase().includes(q) ?? false)));
  }, [entries, minLevel, filter]);

  useEffect(() => {
    if (follow) bottom.current?.scrollIntoView({ block: "end" });
  }, [visible, follow]);

  const clear = async () => {
    if (!carIdNum || !confirm("Delete the stored log of this vehicle on the server?")) return;
    await fetch(`/api/cars/${carIdNum}/logs`, { method: "DELETE" });
    setEntries([]);
  };

  const errors = entries.filter(e => e.level >= 4).length;

  return (
    <ConfigGuard carId={carIdNum!}>
      <div className="min-h-screen bg-zinc-950 text-zinc-100 p-4 flex flex-col">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-3">
            <Link href={`/car/${carIdNum}`} className="text-blue-400 hover:underline text-sm">&larr; Back</Link>
            <h1 className="text-lg">Onboard log — car {carIdNum}</h1>
            <Link href={`/car/${carIdNum}/channels`} className="text-blue-400 hover:underline text-xs">Channels</Link>
          </div>
          <LanguageSwitcher />
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-2 text-xs">
          <select className={inputClass} value={minLevel} onChange={e => setMinLevel(Number(e.target.value))}>
            {LEVELS.map((l, i) => <option key={l} value={i}>{l} and up</option>)}
          </select>
          <input className={inputClass + " w-64"} placeholder="Filter: channel, module, text" value={filter} onChange={e => setFilter(e.target.value)} />
          <label className="flex items-center gap-1 text-zinc-300">
            <input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} /> Follow
          </label>
          <button className={btnGhost} onClick={() => setPaused(p => !p)}>{paused ? "Resume" : "Pause"}</button>
          <button className={btnGhost} onClick={clear}>Clear</button>
          <span className="text-zinc-500 ml-auto">
            {visible.length} of {entries.length} entries{errors > 0 ? ` · ${errors} errors` : ""}{paused ? " · paused" : ""}
          </span>
        </div>
        {error && <div className="mb-2 text-xs text-red-300">{error}</div>}

        <div className="flex-1 overflow-auto border border-zinc-800 rounded bg-zinc-900 font-mono text-[11px] leading-snug">
          {entries.length === 0 && !error && (
            <div className="p-3 text-zinc-500">
              No log yet. The vehicle sends its log once connected; an older onboard build does not send one.
            </div>
          )}
          {visible.map(e => (
            <div key={e.seq} className="px-2 py-0.5 border-b border-zinc-800/60 hover:bg-zinc-800/40">
              <div className="flex gap-2">
                <span className="text-zinc-500 shrink-0">{time(e.timestampUtc)}</span>
                <span className={`shrink-0 w-14 ${LEVEL_CLASS[e.level] ?? ""}`}>{LEVELS[e.level] ?? e.level}</span>
                <span className="text-zinc-400 shrink-0 w-48 truncate" title={e.category}>{shortCategory(e.category)}</span>
                <span className="text-zinc-100 whitespace-pre-wrap break-words min-w-0">{e.message}</span>
              </div>
              {e.exception && (
                <details className="ml-[17rem] text-red-300/80">
                  <summary className="cursor-pointer text-zinc-500">exception</summary>
                  <pre className="whitespace-pre-wrap break-words">{e.exception}</pre>
                </details>
              )}
            </div>
          ))}
          <div ref={bottom} />
        </div>
      </div>
    </ConfigGuard>
  );
}
