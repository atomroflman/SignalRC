import React from "react";
import { flowNodeStyles } from "./flow-node-styles";
import { useControlFlowStore } from "./control-flow-store";
import { useI18n } from "@/i18n/provider";

/** A FlowValueReader telemetry channel: TelemetryOut publishes under its Key. */
export type FlowValueChannel = { channel: string; key: string };

/** FlowValueReader channels of a channel map (GET /api/cars/{id}/channels), sorted by key. */
export function flowValueChannels(map: any): FlowValueChannel[] {
  const channels = map?.telemetryChannels ?? {};
  const result: FlowValueChannel[] = [];
  for (const [channel, item] of Object.entries<any>(channels)) {
    if (item?.telemetryType !== "FlowValueReader") continue;
    const options = item?.options ?? {};
    const entry = Object.entries<any>(options).find(([k]) => k.toLowerCase() === "key");
    const key = String(entry?.[1] ?? "").trim();
    if (key) result.push({ channel, key });
  }
  return result.sort((a, b) => a.key.localeCompare(b.key) || a.channel.localeCompare(b.channel));
}

// One request per vehicle while the editor is open; reloaded when the list is opened.
const cache = new Map<number, Promise<FlowValueChannel[]>>();
function load(carId: number, fresh = false): Promise<FlowValueChannel[]> {
  if (fresh || !cache.has(carId))
    cache.set(carId, fetch(`/api/cars/${carId}/channels`).then(r => r.ok ? r.json() : null).then(flowValueChannels).catch(() => []));
  return cache.get(carId)!;
}

/** The key of a TelemetryOut node, chosen from the vehicle's FlowValueReader channels. */
export function FlowTelemetryKeySelect({ name, value, onChange }: { name: string; value: string; onChange: (key: string, value: any) => void }) {
  const { messages } = useI18n();
  const t = messages.onboardFlow;
  const carId = useControlFlowStore(s => s.carId);
  const [channels, setChannels] = React.useState<FlowValueChannel[] | null>(null);
  const refresh = React.useCallback((fresh: boolean) => {
    if (carId) load(carId, fresh).then(setChannels);
  }, [carId]);
  React.useEffect(() => refresh(false), [refresh]);

  const current = String(value ?? "").trim();
  const known = channels?.some(c => c.key === current) ?? true;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-row items-center justify-between gap-2">
        <span className="text-zinc-300 text-xs text-left flex-1">{name}</span>
        <select
          className={`nodrag ${flowNodeStyles.input} max-w-[160px] py-0.5`}
          value={current}
          onFocus={() => refresh(true)}
          onMouseDown={e => e.stopPropagation()}
          onChange={e => onChange(name, e.target.value)}
        >
          <option value="" className="bg-zinc-900">{t.telemetryKeyNone}</option>
          {channels?.map(c => (
            <option key={`${c.channel}/${c.key}`} value={c.key} className="bg-zinc-900">{c.channel} ({c.key})</option>
          ))}
          {!known && current && <option value={current} className="bg-zinc-900">{current} – {t.telemetryKeyMissing}</option>}
        </select>
      </div>
      {channels && channels.length === 0 && <div className={flowNodeStyles.hint}>{t.telemetryKeyNoChannels}</div>}
      {!known && current && <div className="text-[11px] text-amber-300">{t.telemetryKeyMissingHint}</div>}
    </div>
  );
}
