"use client";
// Telemetry diagnostics: what this client requests, from whom, and what
// arrived – and, on request, the server's view (telemetry-debug), so a missing
// value can be placed on the server or the client side. Collapsed by default;
// while collapsed it holds nothing.
import React, { useEffect, useMemo, useReducer, useState } from "react";
import { useI18n } from "@/i18n/provider";
import { LIDAR_FIELDS, sharedSourceHub, type CarSourceProvider, type HubState, type LidarGridSummary } from "../sources";
import type { IntegrationMessages } from "./messages";
import {
  TelemetryDiagnosticsSession, diagnosticsRows, fetchServerDebug, formatMs, stateText, truncate, wallTime,
  type DiagnosticsRow, type ServerDebugResult, type StateTone,
} from "./telemetry-diagnostics";

type Messages = IntegrationMessages["telemetryDiagnostics"];

export interface TelemetryDiagnosticsPanelProps {
  carId: number;
  /** A provider the page already holds (editor); otherwise the shared one is acquired while open. */
  provider?: CarSourceProvider;
  className?: string;
  summaryClassName?: string;
}

const toneClass: Record<StateTone, string> = {
  valid: "text-emerald-300",
  unchecked: "text-amber-300",
  invalid: "text-red-300",
};

export function TelemetryDiagnosticsPanel({ carId, provider, className, summaryClassName }: TelemetryDiagnosticsPanelProps) {
  const { messages } = useI18n();
  const m = messages.overlay.telemetryDiagnostics;
  const [open, setOpen] = useState(false);
  return (
    <details
      className={className ?? "rounded border border-zinc-800 p-1"}
      data-ovl-telemetry-diagnostics={carId}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className={summaryClassName ?? "cursor-pointer select-none text-xs font-semibold text-zinc-300"}>{m.title}</summary>
      {open && <DiagnosticsBody carId={carId} provider={provider} m={m} />}
    </details>
  );
}

function DiagnosticsBody({ carId, provider: given, m }: { carId: number; provider?: CarSourceProvider; m: Messages }) {
  const [acquired, setAcquired] = useState<CarSourceProvider | undefined>(undefined);
  useEffect(() => {
    if (given) return;
    const car = sharedSourceHub().acquire(carId);
    setAcquired(car.provider);
    return () => {
      setAcquired(undefined);
      car.release();
    };
  }, [carId, given]);
  const provider = given ?? acquired;
  if (!provider) return null;
  return <DiagnosticsView provider={provider} m={m} />;
}

export function DiagnosticsView({ provider, m }: { provider: CarSourceProvider; m: Messages }) {
  const session = useMemo(() => new TelemetryDiagnosticsSession(provider), [provider]);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [server, setServer] = useState<ServerDebugResult | undefined>(undefined);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const unsubscribe = provider.subscribe(() => {
      session.refresh();
      rerender();
    });
    // Ages move without messages.
    const timer = setInterval(rerender, 1000);
    return () => {
      unsubscribe();
      clearInterval(timer);
      session.close();
    };
  }, [provider, session]);

  const loadServer = async () => {
    setLoading(true);
    setServer(await fetchServerDebug(provider.carId));
    setLoading(false);
  };

  const d = session.snapshot();
  const hubState: HubState = sharedSourceHub().state;
  const serverState = server?.ok ? server.state : undefined;
  const rows = diagnosticsRows(d, serverState);
  const names = new Map(d.channels.map((c) => [c.id, c.name ?? `#${c.id}`]));
  const idList = (ids: number[] | undefined) => (ids && ids.length > 0 ? ids.map((id) => names.get(id) ?? `#${id}`).join(", ") : m.none);
  const lastAgo = d.stream.lastMessageAt === undefined ? undefined : d.now - d.stream.lastMessageAt;

  return (
    <div className="mt-1 flex max-h-[60vh] flex-col gap-2 overflow-auto text-[11px] text-zinc-300" data-ovl-diagnostics-body="">
      <div className="text-zinc-500">{m.readOnlyHint}</div>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5">
        <dt className="text-zinc-500">{m.hub}</dt>
        <dd data-ovl-diag-hub={hubState}>{m.hubState[hubState]}</dd>
        <dt className="text-zinc-500">{m.vehicle}</dt>
        <dd>{d.vehicleOnline ? m.online : m.offline}</dd>
        <dt className="text-zinc-500">{m.metadata}</dt>
        <dd>{m.metadataState[d.metadata]}</dd>
        <dt className="text-zinc-500">{m.lastMessage}</dt>
        <dd>
          {d.stream.lastSeq === undefined ? m.never : `seq ${d.stream.lastSeq}, ${m.ago(formatMs(lastAgo))}`}
          {" · "}{m.stream(d.stream.messages, d.stream.droppedOldSeq, d.stream.ignoredChanges)}
        </dd>
        <dt className="text-zinc-500">{m.requestedIds}</dt>
        <dd>{idList(d.sent)}</dd>
        <dt className="text-zinc-500">{m.consumers}</dt>
        <dd>{d.consumers.length === 0 ? m.none : d.consumers.map((c) => `${c.id} (${c.channels.join(", ") || "–"}${c.control ? ", out/sig" : ""})`).join("; ")}</dd>
      </dl>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={`rounded border px-2 py-0.5 ${session.requestingAll ? "border-amber-600 bg-amber-900 text-amber-100" : "border-zinc-600 bg-zinc-800 hover:bg-zinc-700"}`}
          title={m.requestAllHint}
          aria-pressed={session.requestingAll}
          onClick={() => { session.setRequestAll(!session.requestingAll); rerender(); }}
        >
          {session.requestingAll ? m.releaseAll : m.requestAll}
        </button>
        <button type="button" className="rounded border border-zinc-600 bg-zinc-800 px-2 py-0.5 hover:bg-zinc-700" disabled={loading} onClick={() => void loadServer()}>
          {loading ? m.loadingServer : server ? m.reloadServer : m.loadServer}
        </button>
        {server && !server.ok && <span className="text-red-300" role="alert">{m.serverError(server.status)}</span>}
        {server?.ok && <span className="text-zinc-500">{m.serverLoaded(new Date(server.loadedAt).toLocaleTimeString())}</span>}
      </div>

      {serverState && (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 rounded border border-zinc-800 p-1" data-ovl-diag-server="">
          <dt className="text-zinc-500">{m.onboard}</dt>
          <dd>{serverState.onboardConnected ? m.connected : m.disconnected}{serverState.epoch ? ` · epoch ${serverState.epoch} seq ${serverState.seq ?? "–"}` : ""}</dd>
          <dt className="text-zinc-500">{m.lastOnboard}</dt>
          <dd>{serverState.lastMessageAgoMs == null ? m.never : m.ago(formatMs(serverState.lastMessageAgoMs))} · {m.deltas(serverState.acceptedDeltas, serverState.droppedOldSeq)}</dd>
          <dt className="text-zinc-500">{m.demand}</dt>
          <dd>{idList(serverState.demand)} · {m.interested(serverState.interestedConnections)}{serverState.legacyClients > 0 ? ` · ${m.legacy(serverState.legacyClients)}` : ""}</dd>
        </dl>
      )}

      {rows.length === 0 ? (
        <div className="text-zinc-500">{m.noChannels}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left font-mono">
            <thead className="text-zinc-500">
              <tr>
                <th className="pr-2">{m.col.id}</th>
                <th className="pr-2">{m.col.name}</th>
                <th className="pr-2">{m.col.type}</th>
                <th className="pr-2">{m.col.value}</th>
                <th className="pr-2">{m.col.state}</th>
                <th className="pr-2">{m.col.age}</th>
                <th className="pr-2">{m.col.arrival}</th>
                <th className="pr-2">{m.col.counts}</th>
                <th className="pr-2">{m.col.requested}</th>
                <th className="pr-2">{m.col.consumers}</th>
                {serverState && <th className="pr-2">{m.col.server}</th>}
                {serverState && <th className="pr-2">{m.col.serverDemand}</th>}
                {serverState && <th className="pr-2">{m.col.serverCounts}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => <Row key={row.id} row={row} now={d.now} withServer={!!serverState} m={m} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Row({ row, now, withServer, m }: { row: DiagnosticsRow; now: number; withServer: boolean; m: Messages }) {
  const c = row.client;
  const state = stateText(c?.value, m.reasons);
  const s = row.server;
  const lidar = c?.lidar;
  const cols = withServer ? 13 : 10;
  return (
    <>
      <tr className="border-t border-zinc-800 align-top" data-ovl-diag-channel={row.id}>
        <td className="pr-2">{row.id}</td>
        <td className="pr-2">{row.name ?? "?"}</td>
        <td className="pr-2">{row.dataType ?? "?"}</td>
        <td className="pr-2 break-all" title={c?.raw}>{truncate(c?.raw)}</td>
        <td className={`pr-2 ${toneClass[state.tone]}`}>{state.text}</td>
        <td className="pr-2">{formatMs(c?.value?.ageMs)}</td>
        <td className="pr-2">{c?.lastArrival === undefined ? "–" : `${wallTime(c.lastArrival, now)} (${formatMs(now - c.lastArrival)})`}</td>
        <td className="pr-2">{c ? `${c.changes}/${c.confirmations}` : "–"}</td>
        <td className="pr-2">{[c?.wanted && m.wanted, c?.sent && m.sent].filter(Boolean).join(", ") || "–"}</td>
        <td className="pr-2">{c && c.consumers.length > 0 ? c.consumers.join(", ") : "–"}</td>
        {withServer && <td className="pr-2 break-all" title={s?.value ?? undefined}>{s ? `${truncate(s.value ?? undefined, 24) || "–"} / ${s.state ?? "–"} / ${formatMs(s.ageMs)}` : "–"}</td>}
        {withServer && <td className="pr-2">{s ? `${s.inDemand ? m.inDemand : "–"} / ${s.interested}` : "–"}</td>}
        {withServer && <td className="pr-2">{s ? `${s.changes}/${s.touches}` : "–"}</td>}
      </tr>
      {(lidar || s?.lidar) && (
        <tr data-ovl-diag-lidar={row.id}>
          <td />
          <td colSpan={cols - 1} className="pb-1 text-zinc-400">
            {lidar && <LidarLine summary={lidar} quality={state.text} ageMs={c?.value?.ageMs} m={m} />}
            {s?.lidar && <span className="block">{m.server}: <LidarLine summary={s.lidar} quality={s.state ?? "–"} ageMs={s.ageMs ?? undefined} m={m} /></span>}
          </td>
        </tr>
      )}
    </>
  );
}

function LidarLine({ summary, quality, ageMs, m }: { summary: LidarGridSummary; quality: string; ageMs?: number; m: Messages }) {
  const parts = summary.error
    ? [m.lidar.error[summary.error], `${summary.length} chars`]
    : [
        m.lidar.occupied(summary.occupied, LIDAR_FIELDS),
        summary.complete ? m.lidar.complete : m.lidar.incomplete,
        summary.encoding ?? "",
        `${summary.length} chars`,
      ];
  return (
    <span data-ovl-diag-lidar-error={summary.error ?? ""}>
      LiDAR: {parts.filter(Boolean).join(" · ")} · {m.lidar.quality} {quality} · {m.lidar.scanAge} {formatMs(ageMs)}
    </span>
  );
}

export default TelemetryDiagnosticsPanel;
