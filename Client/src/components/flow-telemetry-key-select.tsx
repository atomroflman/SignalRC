import React from "react";
import { flowNodeStyles } from "./flow-node-styles";
import { useControlFlowStore } from "./control-flow-store";
import { useI18n } from "@/i18n/provider";

/** A FlowValueReader telemetry channel: TelemetryOut publishes under its Key. */
export type FlowValueChannel = { channel: string; key: string };

const isFlowValueReader = (type: unknown) => {
  // Stored short ("FlowValueReader") or with its namespace (SignalRC.Onboard.Telemetry.FlowValueReader).
  const t = String(type ?? "");
  return t === "FlowValueReader" || t.endsWith(".FlowValueReader");
};

/** FlowValueReader channels of a channel map (GET /api/cars/{id}/channels), sorted by key. */
export function flowValueChannels(map: any): FlowValueChannel[] {
  const channels = map?.telemetryChannels ?? {};
  const result: FlowValueChannel[] = [];
  for (const [channel, item] of Object.entries<any>(channels)) {
    if (!isFlowValueReader(item?.telemetryType)) continue;
    const options = item?.options ?? {};
    const entry = Object.entries<any>(options).find(([k]) => k.toLowerCase() === "key");
    const key = String(entry?.[1] ?? "").trim();
    if (key) result.push({ channel, key });
  }
  return result.sort((a, b) => a.key.localeCompare(b.key) || a.channel.localeCompare(b.channel));
}

/** Names of all telemetry channels of a channel map, sorted. */
export function telemetryChannelNames(map: any): string[] {
  return Object.keys(map?.telemetryChannels ?? {}).sort((a, b) => a.localeCompare(b));
}

// One request per vehicle while the editor is open; reloaded when a list is opened.
const cache = new Map<number, Promise<any>>();
function loadMap(carId: number, fresh = false): Promise<any> {
  if (fresh || !cache.has(carId))
    cache.set(carId, fetch(`/api/cars/${carId}/channels`).then(r => r.ok ? r.json() : null).catch(() => null));
  return cache.get(carId)!;
}

type Option = { value: string; label: string };

/** A parameter chosen from a list derived from the vehicle's channel map; an unknown value stays selectable and is marked. */
function ChannelMapParamSelect({ name, value, onChange, options, texts }: {
  name: string;
  value: string;
  onChange: (key: string, value: any) => void;
  options: (map: any) => Option[];
  texts: { none: string; missing: string; missingHint: string; empty: string };
}) {
  const carId = useControlFlowStore(s => s.carId);
  const [list, setList] = React.useState<Option[] | null>(null);
  const refresh = React.useCallback((fresh: boolean) => {
    if (carId) loadMap(carId, fresh).then(map => setList(options(map)));
  }, [carId, options]);
  React.useEffect(() => refresh(false), [refresh]);

  const current = String(value ?? "").trim();
  const known = list?.some(o => o.value === current) ?? true;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-row items-center justify-between gap-2">
        <span className="text-zinc-300 text-xs text-left flex-1">{name}</span>
        <select
          className={`nodrag ${flowNodeStyles.input} max-w-[180px] py-0.5`}
          value={current}
          onFocus={() => refresh(true)}
          onMouseDown={e => e.stopPropagation()}
          onChange={e => onChange(name, e.target.value)}
        >
          <option value="" className="bg-zinc-900">{texts.none}</option>
          {list?.map(o => <option key={o.value} value={o.value} className="bg-zinc-900">{o.label}</option>)}
          {!known && current && <option value={current} className="bg-zinc-900">{current} – {texts.missing}</option>}
        </select>
      </div>
      {list && list.length === 0 && <div className={flowNodeStyles.hint}>{texts.empty}</div>}
      {!known && current && <div className="text-[11px] text-amber-300">{texts.missingHint}</div>}
    </div>
  );
}

const keyOptions = (map: any): Option[] => {
  const seen = new Set<string>();
  return flowValueChannels(map)
    .filter(c => !seen.has(c.key) && seen.add(c.key))
    .map(c => ({ value: c.key, label: c.channel === c.key ? c.key : `${c.channel} (${c.key})` }));
};
const channelOptions = (map: any): Option[] => telemetryChannelNames(map).map(n => ({ value: n, label: n }));

/** The key of a TelemetryOut node, chosen from the vehicle's FlowValueReader channels. */
export function FlowTelemetryKeySelect(props: { name: string; value: string; onChange: (key: string, value: any) => void }) {
  const t = useI18n().messages.onboardFlow;
  return <ChannelMapParamSelect {...props} options={keyOptions}
    texts={{ none: t.telemetryKeyNone, missing: t.telemetryKeyMissing, missingHint: t.telemetryKeyMissingHint, empty: t.telemetryKeyNoChannels }} />;
}

/** The channel of a Telemetry node, chosen from all telemetry channels of the vehicle. */
export function FlowTelemetryChannelSelect(props: { name: string; value: string; onChange: (key: string, value: any) => void }) {
  const t = useI18n().messages.onboardFlow;
  return <ChannelMapParamSelect {...props} options={channelOptions}
    texts={{ none: t.telemetryKeyNone, missing: t.telemetryKeyMissing, missingHint: t.telemetryChannelMissingHint, empty: t.telemetryChannelNone }} />;
}
