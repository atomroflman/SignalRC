import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import LanguageSwitcher from "@/components/language-switcher";
import ConfigGuard from "@/components/config-guard";
import { useI18n } from "@/i18n/provider";
import { historyApi } from "@/components/telemetry-history/api";
import HistoryChart, { type ChartSeries } from "@/components/telemetry-history/history-chart";
import PanelEditor from "@/components/telemetry-history/panel-editor";
import SettingsPanel from "@/components/telemetry-history/settings-panel";
import {
  appendSamples, compile, defaultLayout, evaluateSeries, formatValue, isLayout, MIN_HOLD_MS, newId, newestTime, stats, telemetryTypes,
} from "@/components/telemetry-history/series";
import type { ChannelData, DashboardLayout, HistoryChannel, PanelDef, SessionDetail, SessionSummary } from "@/components/telemetry-history/types";

const btnGhost = "px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-xs border border-zinc-700 disabled:opacity-50";
const btnPrimary = "px-2 py-1 bg-sky-700 hover:bg-sky-600 text-white rounded text-xs border border-sky-600 disabled:opacity-50";

const SESSIONS_POLL_MS = 5000;
const LIVE_POLL_MS = 1000;
const POINTS = 1500;
/** Live samples appended before the drive is fetched again in reduced form. */
const MAX_LIVE_POINTS = 30_000;
const SYNC_KEY = "telemetry-history";

type Range = { from: number; to: number };

/** Recorded telemetry of a vehicle: drives, charts with formulas, recording settings. */
export default function TelemetryHistoryPage() {
  const router = useRouter();
  const carId = router.query.carId as string;
  const carIdNum = carId ? parseInt(carId) : undefined;
  const t = useI18n().messages.telemetryHistory;

  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [settingsChannels, setSettingsChannels] = useState<HistoryChannel[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [data, setData] = useState<Record<string, ChannelData>>({});
  const [resolution, setResolution] = useState(0);
  const [loading, setLoading] = useState(false);
  const [range, setRange] = useState<Range | undefined>();
  const [follow, setFollow] = useState(true);
  const [reload, setReload] = useState(0);
  const livePoints = useRef(0);
  const dataRef = useRef(data);
  dataRef.current = data;

  const [layout, setLayout] = useState<DashboardLayout | null>(null);
  const [draft, setDraft] = useState<DashboardLayout | null>(null);
  const [savingLayout, setSavingLayout] = useState(false);

  // --- loading ---

  const loadSessions = useCallback(async () => {
    if (!carIdNum) return;
    try {
      const list = await historyApi.sessions(carIdNum);
      setSessions(list);
      setError(null);
      setSessionId(prev => {
        if (prev !== null && list.some(s => s.id === prev)) return prev;
        const fromQuery = Number(router.query.session);
        return list.find(s => s.id === fromQuery)?.id ?? list[0]?.id ?? null;
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }, [carIdNum, router.query.session]);

  useEffect(() => {
    void loadSessions();
    const timer = setInterval(loadSessions, SESSIONS_POLL_MS);
    return () => clearInterval(timer);
  }, [loadSessions]);

  useEffect(() => {
    if (!carIdNum) return;
    historyApi.settings(carIdNum).then(s => setSettingsChannels(s.channels)).catch(() => {});
    historyApi.dashboard(carIdNum).then(d => setLayout(isLayout(d.layout) ? d.layout : null)).catch(() => {});
  }, [carIdNum]);

  useEffect(() => {
    if (!carIdNum || sessionId === null) { setSession(null); return; }
    setRange(undefined);
    historyApi.session(carIdNum, sessionId).then(setSession).catch(e => setError((e as Error).message));
  }, [carIdNum, sessionId]);

  // Ended while watching: refresh so the header and live state follow.
  const summary = sessions?.find(s => s.id === sessionId);
  useEffect(() => {
    if (!carIdNum || !session || !summary || summary.active === session.active) return;
    historyApi.session(carIdNum, session.id).then(setSession).catch(() => {});
  }, [carIdNum, session, summary]);

  const idToName = useMemo(() => new Map(session?.channels.map(c => [String(c.id), c.name]) ?? []), [session]);
  const byName = useCallback((channels: Record<string, ChannelData>) => {
    const out: Record<string, ChannelData> = {};
    for (const [id, d] of Object.entries(channels)) {
      const name = idToName.get(id);
      if (name) out[name] = d;
    }
    return out;
  }, [idToName]);

  useEffect(() => {
    if (!carIdNum || !session) return;
    let cancelled = false;
    setLoading(true);
    historyApi.samples(carIdNum, session.id, { from: range?.from, to: range?.to, points: POINTS })
      .then(r => {
        if (cancelled) return;
        setData(byName(r.channels));
        setResolution(r.resolutionMs);
        livePoints.current = 0;
        setError(null);
      })
      .catch(e => { if (!cancelled) setError((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [carIdNum, session, range, byName, reload]);

  const live = !!session?.active && follow && !range;
  useEffect(() => {
    if (!carIdNum || !session || !live) return;
    let busy = false;
    const timer = setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        const after = newestTime(dataRef.current);
        const r = await historyApi.samples(carIdNum, session.id, { after: after ?? session.startedAt - 1 });
        const fresh = byName(r.channels);
        const added = Object.values(fresh).reduce((n, d) => n + d.t.length, 0);
        if (added > 0) setData(prev => appendSamples(prev, fresh));
        livePoints.current += added;
        if (livePoints.current > MAX_LIVE_POINTS) setReload(x => x + 1);
      } catch {
        // the next tick retries
      } finally {
        busy = false;
      }
    }, LIVE_POLL_MS);
    return () => clearInterval(timer);
  }, [carIdNum, session, live, byName]);

  // --- dashboard ---

  const channels = useMemo(() => {
    const merged = new Map<string, HistoryChannel>();
    for (const c of settingsChannels) if (c.dataType !== "String" && c.dataType !== "LidarGrid") merged.set(c.name, c);
    for (const c of session?.channels ?? []) merged.set(c.name, c);
    return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [settingsChannels, session]);
  const telemetry = useMemo(() => telemetryTypes(channels), [channels]);

  const shown = draft ?? layout ?? defaultLayout(session?.channels ?? []);
  const hold = Math.max(MIN_HOLD_MS, resolution * 3);
  const extent: Range | undefined = range ?? (session ? { from: session.startedAt, to: newestTime(data) ?? session.lastSampleAt ?? session.startedAt } : undefined);

  const panels = useMemo(() => shown.panels.map(panel => ({
    panel,
    series: panel.series.map(def => {
      const compiled = compile(def.expr, telemetry);
      const values = extent ? evaluateSeries(compiled, data, hold, extent) : { t: [], v: [] };
      return { def, compiled, values };
    }),
  })), [shown, telemetry, data, hold, extent?.from, extent?.to]); // eslint-disable-line react-hooks/exhaustive-deps

  const updatePanel = (p: PanelDef) => setDraft(d => d && { ...d, panels: d.panels.map(x => (x.id === p.id ? p : x)) });

  const saveLayout = async () => {
    if (!carIdNum || !draft) return;
    setSavingLayout(true);
    try {
      await historyApi.saveDashboard(carIdNum, draft);
      setLayout(draft);
      setDraft(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingLayout(false);
    }
  };

  const deleteSession = async (id: number) => {
    if (!carIdNum || !confirm(t.confirmDelete)) return;
    try {
      await historyApi.deleteSession(carIdNum, id);
      if (id === sessionId) setSessionId(null);
      await loadSessions();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const zoom = useCallback((from: number, to: number) => setRange({ from: Math.min(from, to), to: Math.max(from, to) }), []);
  const resetZoom = useCallback(() => setRange(undefined), []);

  return (
    <ConfigGuard carId={carIdNum!}>
      <div className="min-h-screen bg-zinc-950 text-zinc-100 p-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <Link href={`/car/${carIdNum}`} className="text-blue-400 hover:underline text-sm">&larr; {t.back}</Link>
            <h1 className="text-lg">{carIdNum !== undefined ? t.title(carIdNum) : ""}</h1>
            <Link href={`/car/${carIdNum}/setup`} className="text-blue-400 hover:underline text-xs">{t.setup}</Link>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <LanguageSwitcher />
            <button className={btnGhost} onClick={() => setShowSettings(s => !s)}>{t.recording}</button>
          </div>
        </div>

        {error && <div className="text-xs text-red-300">{t.error(error)}</div>}
        {showSettings && carIdNum && (
          <SettingsPanel carId={carIdNum} onClose={() => setShowSettings(false)}
            onSaved={s => { setSettingsChannels(s.channels); void loadSessions(); }} />
        )}

        <div className="flex flex-col lg:flex-row gap-3 flex-1 min-h-0">
          <aside className="lg:w-60 shrink-0 bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-xs space-y-1 lg:max-h-[calc(100vh-7rem)] overflow-auto">
            <div className="text-zinc-400 mb-1">{t.sessions}</div>
            {sessions?.length === 0 && <div className="text-zinc-500">{t.noSessions}</div>}
            {sessions?.map(s => {
              const end = s.endedAt ?? s.lastSampleAt ?? s.startedAt;
              return (
                <div key={s.id}
                  className={`group flex items-center gap-2 px-2 py-1 rounded cursor-pointer ${s.id === sessionId ? "bg-sky-900/60 text-white" : "hover:bg-zinc-800 text-zinc-300"}`}
                  onClick={() => setSessionId(s.id)}>
                  <div className="flex-1 min-w-0">
                    <div>{new Date(s.startedAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</div>
                    <div className="text-zinc-500">{t.duration((end - s.startedAt) / 60000)}</div>
                  </div>
                  {s.active
                    ? <span className="px-1 rounded bg-red-600 text-white text-[10px] uppercase">{t.live}</span>
                    : <button className="opacity-0 group-hover:opacity-100 text-red-300" title={t.deleteSession}
                        onClick={e => { e.stopPropagation(); void deleteSession(s.id); }}>✕</button>}
                </div>
              );
            })}
          </aside>

          <main className="flex-1 min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {session?.active && (
                <label className="flex items-center gap-1 text-zinc-300">
                  <input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} /> {t.follow}
                </label>
              )}
              <button className={btnGhost} disabled={!range} onClick={resetZoom}>{t.resetZoom}</button>
              <span className="text-zinc-500">{t.zoomHint}</span>
              <span className="text-zinc-500">· {resolution > 0 ? t.resolution(resolution) : t.resolutionRaw}</span>
              {loading && <span className="text-zinc-500">· {t.loading}</span>}
              <div className="ml-auto flex gap-2">
                {draft ? (
                  <>
                    <button className={btnGhost} onClick={() => setDraft(d => d && { ...d, panels: [...d.panels, { id: newId("p"), title: t.newPanel, series: [] }] })}>+ {t.addPanel}</button>
                    <button className={btnGhost} onClick={() => { if (confirm(t.confirmReset)) setDraft(defaultLayout(session?.channels ?? channels)); }}>{t.resetLayout}</button>
                    <button className={btnGhost} onClick={() => setDraft(null)}>{t.discard}</button>
                    <button className={btnPrimary} disabled={savingLayout} onClick={saveLayout}>{savingLayout ? t.saving : t.saveLayout}</button>
                  </>
                ) : (
                  <button className={btnGhost} onClick={() => setDraft(structuredClone(shown))}>{t.edit}</button>
                )}
              </div>
            </div>

            {session && Object.keys(data).length === 0 && !loading && <div className="text-xs text-zinc-500">{t.noData}</div>}
            {shown.panels.length === 0 && <div className="text-xs text-zinc-500">{t.emptyLayout}</div>}

            {panels.map(({ panel, series }) => {
              const chartSeries: ChartSeries[] = series.filter(s => !s.compiled.error).map(s => ({
                label: s.def.label,
                color: s.def.color,
                unit: s.def.unit,
                decimals: s.def.decimals,
                stepped: s.compiled.type === "bool",
                data: s.values,
              }));
              return (
                <section key={panel.id} className="bg-zinc-900 border border-zinc-800 rounded-lg p-2">
                  {draft && (
                    <PanelEditor panel={panel} channels={channels} telemetry={telemetry} onChange={updatePanel}
                      onRemove={() => setDraft(d => d && { ...d, panels: d.panels.filter(p => p.id !== panel.id) })} />
                  )}
                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mb-1 text-xs">
                    <h2 className="text-sm text-zinc-100">{panel.title}</h2>
                    {series.map(s => {
                      const st = stats(s.values, extent?.from, extent?.to);
                      return (
                        <span key={s.def.id} className="text-zinc-400">
                          <span style={{ color: s.def.color }}>■</span> {s.def.label}
                          {s.compiled.error
                            ? <span className="text-red-300"> — {s.compiled.error}</span>
                            : st && <> {t.min} {formatValue(st.min, s.def.decimals)} · {t.max} {formatValue(st.max, s.def.decimals)} · {t.last} {formatValue(st.last, s.def.decimals)}{s.def.unit ? ` ${s.def.unit}` : ""}</>}
                        </span>
                      );
                    })}
                  </div>
                  {chartSeries.some(c => c.data.t.length > 0) ? (
                    <HistoryChart series={chartSeries} height={panel.height ?? 220} range={range}
                      syncKey={SYNC_KEY} timeLabel={t.time} onZoom={zoom} onReset={resetZoom} />
                  ) : (
                    !loading && <div className="text-xs text-zinc-500 py-4">{t.noData}</div>
                  )}
                </section>
              );
            })}
          </main>
        </div>
      </div>
    </ConfigGuard>
  );
}
