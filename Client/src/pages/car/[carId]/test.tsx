import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import CollapsibleSection from "@/components/collapsible-section";
import LanguageSwitcher from "@/components/language-switcher";
import ConfigGuard from "@/components/config-guard";
import CarVideoPanel from "@/components/car-video-panel";
import AudioChat from "@/components/audio-chat";
import OnboardDiagnostics from "@/components/onboard-diagnostics";
import { useControlFlowStore } from "@/components/control-flow-store";
import { useI18n } from "@/i18n/provider";

type HubConnection = any;

type ControlChannel = {
  channelName: string;
  controlType: string;
  pinManager?: string | null;
  address?: number | null;
  isEnabled: boolean;
  requiresAxis: boolean;
};

type TelemetryChannel = {
  id: number;
  channelName: string;
  dataType: string;
  unit?: string | null;
  decimals?: number | null;
  subscribed: boolean;
};

type ChannelIds = {
  control: Record<string, number>;
  telemetry: Record<string, number>;
  video: Record<string, number>;
};

const inputClass = "bg-zinc-800 text-zinc-100 border border-zinc-700 rounded px-2 py-1 text-xs";
const btnPrimary = "px-2 py-1 bg-green-900 hover:bg-green-800 text-green-100 rounded text-xs border border-green-800";
const btnGhost = "px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-xs border border-zinc-700";

function isAxisLike(channel: ControlChannel): boolean {
  return channel.requiresAxis || /steer|throttle|brake|axis/i.test(channel.controlType);
}

function formatTelemetryValue(value: string, dataType: string, decimals?: number | null): string {
  if (dataType === "boolean") return value === "true" || value === "1" ? "true" : "false";
  if (dataType === "float" || dataType === "integer") {
    const num = Number(value);
    if (Number.isNaN(num)) return value;
    if (decimals != null && decimals >= 0) return num.toFixed(decimals);
    return String(num);
  }
  return value;
}

export default function TestPage() {
  const { messages } = useI18n();
  const router = useRouter();
  const carId = router.query.carId as string;
  const carIdNum = carId ? parseInt(carId) : undefined;

  const carSession = useControlFlowStore(state => state.carSession);

  const [connection, setConnection] = useState<HubConnection | undefined>(undefined);
  const [connectionState, setConnectionState] = useState<"connecting" | "connected" | "error">("connecting");
  const [controlChannels, setControlChannels] = useState<ControlChannel[]>([]);
  const [telemetryChannels, setTelemetryChannels] = useState<TelemetryChannel[]>([]);
  const [channelIds, setChannelIds] = useState<ChannelIds | undefined>(undefined);
  const [telemetryValues, setTelemetryValues] = useState<Record<string, string>>({});
  const [subscribedChannels, setSubscribedChannels] = useState<Set<string>>(new Set());
  const [controlValues, setControlValues] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const carIdStr = carIdNum?.toString() ?? "";

  useEffect(() => {
    if (!carIdNum) return;

    let mounted = true;
    let conn: HubConnection | undefined;

    (async () => {
      try {
        const signalR = await import("@microsoft/signalr");
        conn = new signalR.HubConnectionBuilder()
          .withUrl("/hubs/connection")
          .withAutomaticReconnect()
          .build();

        conn.on("UpdateTelemetry", (valueName: string, value: string) => {
          if (!mounted) return;
          setTelemetryValues(prev => ({ ...prev, [valueName]: value }));
        });

        conn.onreconnected(async () => {
          if (!mounted || !carIdStr) return;
          await conn!.invoke("SubscribeToCarTelemetry", carIdStr);
          for (const ch of subscribedChannels) {
            await conn!.invoke("SubscribeToChannel", carIdStr, ch).catch(() => {});
          }
        });

        await conn.start();
        if (!mounted) {
          try { await conn.stop(); } catch {}
          return;
        }

        setConnection(conn);
        setConnectionState("connected");

        const [idsRes, controlsRes, telemetryRes] = await Promise.all([
          fetch(`/api/cars/${carIdNum}/channels/ids`),
          fetch(`/api/cars/${carIdNum}/channels`),
          fetch(`/api/car/${carIdNum}/telemetry`),
        ]);

        if (!idsRes.ok) throw new Error(`channels/ids: ${await idsRes.text()}`);
        if (!controlsRes.ok) throw new Error(`channels: ${await controlsRes.text()}`);

        const ids: ChannelIds = await idsRes.json();
        const controlsMap = controlsRes.ok ? await controlsRes.json() : {};
        const telemetryList: TelemetryChannel[] = telemetryRes.ok ? await telemetryRes.json() : [];

        const controls = Object.entries(controlsMap.controlChannels ?? {}).map(([name, c]: [string, any]) => ({
          channelName: name,
          controlType: c.controlType ?? "",
          pinManager: c.pinManager ?? null,
          address: c.address ?? null,
          isEnabled: c.isEnabled ?? false,
          requiresAxis: c.requiresAxis ?? false,
        }));

        setChannelIds(ids);
        setControlChannels(controls);
        setTelemetryChannels(telemetryList);

        const initialSubs = new Set(telemetryList.filter(t => t.subscribed).map(t => t.channelName));
        setSubscribedChannels(initialSubs);

        await conn.invoke("SubscribeToCarTelemetry", carIdStr);
        for (const ch of initialSubs) {
          await conn.invoke("SubscribeToChannel", carIdStr, ch).catch(() => {});
        }
      } catch (e: any) {
        console.error("Failed to load test page:", e);
        if (mounted) {
          setError(e.message ?? "Unknown error");
          setConnectionState("error");
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
      if (conn) {
        try { conn.stop(); } catch {}
      }
      setConnection(undefined);
    };
  }, [carIdNum]);

  const sendControlValue = async (channelName: string, value: number) => {
    if (!connection || !carIdNum || !channelIds) return;
    const id = channelIds.control[channelName];
    if (id === undefined) {
      console.warn(`No server id for control channel ${channelName}`);
      return;
    }
    const sessionId = carSession ?? "test-session";
    try {
      await connection.invoke("UpdateChannel", carIdNum, sessionId, id, value);
    } catch (e) {
      console.error(`Failed to update channel ${channelName}:`, e);
    }
  };

  const toggleTelemetry = async (channel: TelemetryChannel) => {
    if (!connection || !carIdStr) return;
    const next = new Set(subscribedChannels);
    if (next.has(channel.channelName)) {
      next.delete(channel.channelName);
      await connection.invoke("UnsubscribeFromChannel", carIdStr, channel.channelName).catch(() => {});
    } else {
      next.add(channel.channelName);
      await connection.invoke("SubscribeToChannel", carIdStr, channel.channelName).catch(() => {});
    }
    setSubscribedChannels(next);
  };

  const sortedTelemetry = useMemo(() => {
    return [...telemetryChannels].sort((a, b) => a.channelName.localeCompare(b.channelName));
  }, [telemetryChannels]);

  const sortedControls = useMemo(() => {
    return [...controlChannels].sort((a, b) => a.channelName.localeCompare(b.channelName));
  }, [controlChannels]);

  if (!carIdNum) return <div className="p-8 text-zinc-300">{messages.common.loading}</div>;
  if (loading) return <div className="p-8 text-zinc-300">{messages.common.loading}</div>;

  return (
    <ConfigGuard carId={carIdNum}>
      <div className="min-h-screen bg-zinc-950 text-zinc-100 p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Link href={`/car/${carIdNum}`} className="text-blue-400 hover:underline text-sm">&larr; Back</Link>
            <h1 className="text-lg">Test — car {carIdNum}</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2 py-1 rounded border ${connectionState === "connected" ? "border-green-800 text-green-200 bg-green-950" : "border-red-800 text-red-200 bg-red-950"}`}>
              {connectionState === "connected" ? messages.common.connected : messages.common.disconnected}
            </span>
            <LanguageSwitcher />
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 border border-red-800 bg-red-950 text-red-200 text-xs rounded">
            {error}
          </div>
        )}

        {!carSession && (
          <div className="mb-4 p-3 border border-amber-800 bg-amber-950 text-amber-200 text-xs rounded">
            No active control session. Input values will be sent but the vehicle will ignore them until you authenticate on the main control page.
          </div>
        )}

        <CollapsibleSection title={`Inputs (${sortedControls.length})`} defaultCollapsed={false}>
          {sortedControls.length === 0 ? (
            <div className="text-zinc-500 text-xs">No control channels configured.</div>
          ) : (
            <div className="space-y-3">
              {sortedControls.map(c => {
                const axisLike = isAxisLike(c);
                const value = controlValues[c.channelName] ?? 0;
                return (
                  <div key={c.channelName} className="border border-zinc-800 rounded p-2 bg-zinc-950">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-xs text-zinc-100">{c.channelName}</span>
                      <span className="text-zinc-500 text-xs">{c.controlType || "?"} @ {c.pinManager ?? "-"}#{c.address ?? "-"}</span>
                    </div>
                    {axisLike ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="range"
                          min={-1}
                          max={1}
                          step={0.01}
                          value={value}
                          disabled={!c.isEnabled}
                          onChange={e => {
                            const v = Number(e.target.value);
                            setControlValues(prev => ({ ...prev, [c.channelName]: v }));
                            sendControlValue(c.channelName, v);
                          }}
                          className="flex-1 h-1 bg-zinc-600 rounded-lg appearance-none cursor-pointer"
                        />
                        <span className="text-xs text-zinc-300 w-12 text-right">{value.toFixed(2)}</span>
                        <button
                          className={btnGhost}
                          onClick={() => {
                            setControlValues(prev => ({ ...prev, [c.channelName]: 0 }));
                            sendControlValue(c.channelName, 0);
                          }}
                        >
                          Reset
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <button
                          className={btnPrimary}
                          disabled={!c.isEnabled}
                          onMouseDown={() => sendControlValue(c.channelName, 1)}
                          onMouseUp={() => sendControlValue(c.channelName, 0)}
                          onMouseLeave={() => sendControlValue(c.channelName, 0)}
                          onTouchStart={() => sendControlValue(c.channelName, 1)}
                          onTouchEnd={() => sendControlValue(c.channelName, 0)}
                        >
                          Trigger
                        </button>
                        <span className="text-xs text-zinc-500">Hold to activate, release to deactivate</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CollapsibleSection>

        <CollapsibleSection title={`Telemetry (${sortedTelemetry.length})`} defaultCollapsed={false}>
          {sortedTelemetry.length === 0 ? (
            <div className="text-zinc-500 text-xs">No telemetry channels configured.</div>
          ) : (
            <div className="space-y-1 max-h-96 overflow-y-auto">
              {sortedTelemetry.map(t => {
                const isSubscribed = subscribedChannels.has(t.channelName);
                const value = telemetryValues[t.channelName];
                return (
                  <div key={t.channelName} className="flex items-center justify-between border border-zinc-800 rounded p-2 bg-zinc-950">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={isSubscribed}
                        onChange={() => toggleTelemetry(t)}
                      />
                      <span className="font-mono text-xs text-zinc-100">{t.channelName}</span>
                      <span className="text-zinc-500 text-xs">{t.dataType} {t.unit ? `(${t.unit})` : ""}</span>
                    </div>
                    <div className="text-xs font-mono text-green-300">
                      {isSubscribed && value !== undefined
                        ? formatTelemetryValue(value, t.dataType, t.decimals)
                        : "—"}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CollapsibleSection>

        <CollapsibleSection title="Video" defaultCollapsed={false}>
          <div className="h-[400px]">
            <CarVideoPanel carId={carIdNum} />
          </div>
        </CollapsibleSection>

        <CollapsibleSection title="Audio" defaultCollapsed={false}>
          <AudioChat carId={carIdNum} />
        </CollapsibleSection>

        <OnboardDiagnostics carId={carIdNum} />
      </div>
    </ConfigGuard>
  );
}
