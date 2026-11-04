import React, { useEffect, useMemo, useState } from "react";
import { useTelemetryStore } from "@/components/telemetry-store";
import { useI18n } from "@/i18n/provider";

type TelemetryChannel = {
  id: number;
  channelName: string;
  dataType: string;
  unit?: string | null;
  decimals?: number | null;
};

function formatValue(value: string, dataType: string, decimals?: number | null): string {
  if (dataType === "boolean") return value === "true" || value === "1" ? "true" : "false";
  if (dataType === "float" || dataType === "integer") {
    const num = Number(value);
    if (Number.isFinite(num)) return decimals != null ? num.toFixed(decimals) : num.toString();
  }
  return value;
}

/** Live values of the telemetry channels, from the personal selection of the telemetry store. */
export default function TelemetryTestPanel({ carId, refreshKey }: { carId: number; refreshKey: string }) {
  const { messages } = useI18n();
  const m = messages.setupPage.telemetryTest;
  const [channels, setChannels] = useState<TelemetryChannel[]>([]);
  const subscribed = useTelemetryStore(s => s.subscribedChannels);
  const entries = useTelemetryStore(s => s.entries);
  const connect = useTelemetryStore(s => s.connect);
  const disconnect = useTelemetryStore(s => s.disconnect);
  const subscribe = useTelemetryStore(s => s.subscribeChannel);
  const unsubscribe = useTelemetryStore(s => s.unsubscribeChannel);

  useEffect(() => {
    void connect(carId);
    return () => { void disconnect(); };
  }, [carId, connect, disconnect]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/car/${carId}/telemetry`)
      .then(r => r.ok ? r.json() : [])
      .then((list: TelemetryChannel[]) => { if (!cancelled) setChannels(Array.isArray(list) ? list : []); })
      .catch(() => { if (!cancelled) setChannels([]); });
    return () => { cancelled = true; };
  }, [carId, refreshKey]);

  const sorted = useMemo(() => [...channels].sort((a, b) => a.channelName.localeCompare(b.channelName)), [channels]);

  if (sorted.length === 0) return <div className="text-zinc-500 text-xs">{m.empty}</div>;
  return (
    <div className="space-y-1 text-xs">
      <div className="text-zinc-500">{m.hint}</div>
      {sorted.map(t => {
        const isSubscribed = subscribed.has(t.channelName);
        const entry = entries.find(e => e.name === t.channelName);
        const value = entry && entry.state !== "invalid" ? entry.value : undefined;
        return (
          <label key={t.channelName} className="flex items-center justify-between gap-2 border border-zinc-800 rounded p-2 bg-zinc-950 cursor-pointer">
            <span className="flex items-center gap-2 min-w-0">
              <input type="checkbox" className="accent-green-600" checked={isSubscribed} onChange={() => void (isSubscribed ? unsubscribe(t.channelName) : subscribe(t.channelName))} />
              <span className="font-mono text-zinc-100 truncate">{t.channelName}</span>
              <span className="text-zinc-500 shrink-0">{t.dataType} {t.unit ? `(${t.unit})` : ""}</span>
            </span>
            <span className="font-mono text-green-300 shrink-0">
              {isSubscribed && value !== undefined
                ? `${entry?.state === "unchecked" ? "⚠ " : ""}${formatValue(value, t.dataType, t.decimals)}`
                : "—"}
            </span>
          </label>
        );
      })}
    </div>
  );
}
