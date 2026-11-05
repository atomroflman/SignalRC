// Suggested data type, unit and decimals for a telemetry channel, from what its
// reader declares (onboard TelemetryValueAttribute, reported in the option schema).
import type { ChannelTypeSchema, TelemetryValueHint } from "./options-language";

/** Order of TelemetryDataType (Shared/Channels/TelemetryDataType.cs). */
const DATA_TYPE_NAMES = ["String", "Integer", "Number", "Boolean", "LidarGrid"];

export interface TelemetrySuggestion {
  /** TelemetryDataType index. */
  dataType: number;
  unit: string;
  decimals: number | null;
}

function dataTypeIndex(x: number | string): number | undefined {
  if (typeof x === "number") return x >= 0 && x < DATA_TYPE_NAMES.length ? x : undefined;
  const i = DATA_TYPE_NAMES.findIndex(n => n.toLowerCase() === x.toLowerCase());
  return i >= 0 ? i : undefined;
}

function optionsObject(json: string): Record<string, unknown> {
  try {
    const o = JSON.parse(json);
    return o && typeof o === "object" && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}

function conditionHolds(when: string, options: Record<string, unknown>): boolean {
  const eq = when.indexOf("=");
  if (eq <= 0) return false;
  const name = when.slice(0, eq).trim().toLowerCase();
  const expected = when.slice(eq + 1).trim().toLowerCase();
  const entry = Object.entries(options).find(([k]) => k.toLowerCase() === name);
  return entry !== undefined && String(entry[1]).toLowerCase() === expected;
}

/**
 * The suggestion for a channel, resolved like the onboard picks a value: the full
 * channel name, else the part after the last dot; a reader with one value (empty
 * key) fits every name. A hint whose option condition holds wins over the default.
 */
export function suggestTelemetryValue(schema: ChannelTypeSchema | undefined, channelName: string, optionsJson: string): TelemetrySuggestion | undefined {
  const hints = schema?.values ?? [];
  if (hints.length === 0) return undefined;
  const name = channelName.trim();
  const dot = name.lastIndexOf(".");
  const suffix = dot > 0 && dot < name.length - 1 ? name.slice(dot + 1) : undefined;
  const options = optionsObject(optionsJson);
  const pick = (list: TelemetryValueHint[]) =>
    list.find(h => h.when && conditionHolds(h.when, options)) ?? list.find(h => !h.when);
  const hint = pick(hints.filter(h => h.key === name))
    ?? (suffix !== undefined ? pick(hints.filter(h => h.key === suffix)) : undefined)
    ?? pick(hints.filter(h => h.key === ""));
  if (!hint) return undefined;
  const dataType = dataTypeIndex(hint.dataType);
  if (dataType === undefined) return undefined;
  return { dataType, unit: hint.unit ?? "", decimals: hint.decimals ?? null };
}
