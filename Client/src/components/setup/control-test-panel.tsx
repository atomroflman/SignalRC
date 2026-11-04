import React, { useEffect, useMemo, useState } from "react";
import { useControlFlowStore } from "@/components/control-flow-store";
import { useI18n } from "@/i18n/provider";

type HubConnection = any;

export type TestableControl = {
  channelName: string;
  controlType: string;
  pinManager?: string | null;
  address?: number | null;
  isEnabled: boolean;
  requiresAxis: boolean;
};

const btnPrimary = "px-2 py-1 bg-green-900 hover:bg-green-800 text-green-100 rounded text-xs border border-green-800 disabled:opacity-40";
const btnGhost = "px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-xs border border-zinc-700";

function isAxisLike(channel: TestableControl): boolean {
  return channel.requiresAxis || /steer|throttle|brake|axis/i.test(channel.controlType);
}

/** Sends values to the control channels directly, past the flow. The vehicle needs an active control session. */
export default function ControlTestPanel({ carId, channels }: { carId: number; channels: TestableControl[] }) {
  const { messages } = useI18n();
  const m = messages.setupPage.controlTest;
  const carSession = useControlFlowStore(state => state.carSession);
  const [connection, setConnection] = useState<HubConnection | undefined>(undefined);
  const [ids, setIds] = useState<Record<string, number>>({});
  const [values, setValues] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    let conn: HubConnection | undefined;
    (async () => {
      try {
        const signalR = await import("@microsoft/signalr");
        conn = new signalR.HubConnectionBuilder().withUrl("/hubs/connection").withAutomaticReconnect().build();
        await conn.start();
        if (!mounted) { try { await conn.stop(); } catch {} return; }
        setConnection(conn);
      } catch (e: any) {
        if (mounted) setError(e?.message ?? "Unknown error");
      }
    })();
    return () => {
      mounted = false;
      if (conn) { try { conn.stop(); } catch {} }
      setConnection(undefined);
    };
  }, []);

  // Refetched when the list changes: a new channel gets its server id on save.
  const signature = channels.map(c => c.channelName).join("|");
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/cars/${carId}/channels/ids`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`channels/ids: ${r.status}`)))
      .then(body => { if (!cancelled) setIds(body.control ?? {}); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [carId, signature]);

  const send = async (channelName: string, value: number) => {
    const id = ids[channelName];
    if (!connection || id === undefined) return;
    try {
      await connection.invoke("UpdateChannel", carId, carSession ?? "test-session", id, value);
    } catch (e) {
      console.error(`Failed to update channel ${channelName}:`, e);
    }
  };

  const sorted = useMemo(() => [...channels].sort((a, b) => a.channelName.localeCompare(b.channelName)), [channels]);

  return (
    <div className="space-y-2 text-xs">
      {error && <div className="p-2 border border-red-800 bg-red-950 text-red-200 rounded">{error}</div>}
      {!carSession && <div className="p-2 border border-amber-800 bg-amber-950 text-amber-200 rounded">{m.noSession}</div>}
      {sorted.length === 0 && <div className="text-zinc-500">{m.empty}</div>}
      {sorted.map(c => {
        const value = values[c.channelName] ?? 0;
        return (
          <div key={c.channelName} className="border border-zinc-800 rounded p-2 bg-zinc-950">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="font-mono text-zinc-100">{c.channelName}</span>
              <span className="text-zinc-500 truncate">{c.controlType || "?"} @ {c.pinManager ?? "-"}#{c.address ?? "-"}</span>
            </div>
            {isAxisLike(c) ? (
              <div className="flex items-center gap-2">
                <input
                  type="range" min={-1} max={1} step={0.01} value={value} disabled={!c.isEnabled}
                  aria-label={c.channelName}
                  onChange={e => {
                    const v = Number(e.target.value);
                    setValues(prev => ({ ...prev, [c.channelName]: v }));
                    void send(c.channelName, v);
                  }}
                  className="flex-1 h-1 bg-zinc-600 rounded-lg appearance-none cursor-pointer"
                />
                <span className="text-zinc-300 w-12 text-right">{value.toFixed(2)}</span>
                <button
                  type="button"
                  className={btnGhost}
                  onClick={() => {
                    setValues(prev => ({ ...prev, [c.channelName]: 0 }));
                    void send(c.channelName, 0);
                  }}
                >
                  {m.reset}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className={btnPrimary}
                  disabled={!c.isEnabled}
                  onMouseDown={() => void send(c.channelName, 1)}
                  onMouseUp={() => void send(c.channelName, 0)}
                  onMouseLeave={() => void send(c.channelName, 0)}
                  onTouchStart={() => void send(c.channelName, 1)}
                  onTouchEnd={() => void send(c.channelName, 0)}
                >
                  {m.trigger}
                </button>
                <span className="text-zinc-500">{m.triggerHint}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
