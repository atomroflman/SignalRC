// AP12 – explicit unit conversions for template slots (D-rule: no automatic
// conversion; the user confirms the factor when inserting).
import { quote } from "../exchange/references";
import type { Conversion, ConversionPreset, TemplateSlot } from "./types";

export const IDENTITY: Conversion = { factor: 1, offset: 0 };

export const ANGLE_PRESETS: ConversionPreset[] = [
  { id: "deg", label: { de: "Grad", en: "degrees" }, from: ["°", "deg", "grad", "degree", "degrees"], factor: 1, offset: 0 },
  { id: "rad", label: { de: "Radiant → Grad", en: "radians → degrees" }, from: ["rad", "radian", "radians"], factor: 180 / Math.PI, offset: 0 },
];

export const SPEED_PRESETS: ConversionPreset[] = [
  { id: "mps", label: { de: "m/s", en: "m/s" }, from: ["m/s", "mps"], factor: 1, offset: 0 },
  { id: "kmh", label: { de: "km/h → m/s", en: "km/h → m/s" }, from: ["km/h", "kmh", "kph"], factor: 1 / 3.6, offset: 0 },
  { id: "cms", label: { de: "cm/s → m/s", en: "cm/s → m/s" }, from: ["cm/s"], factor: 0.01, offset: 0 },
  { id: "mms", label: { de: "mm/s → m/s", en: "mm/s → m/s" }, from: ["mm/s"], factor: 0.001, offset: 0 },
];

export const DISTANCE_PRESETS: ConversionPreset[] = [
  { id: "m", label: { de: "m", en: "m" }, from: ["m"], factor: 1, offset: 0 },
  { id: "cm", label: { de: "cm → m", en: "cm → m" }, from: ["cm"], factor: 0.01, offset: 0 },
  { id: "mm", label: { de: "mm → m", en: "mm → m" }, from: ["mm"], factor: 0.001, offset: 0 },
];

/** Preset matching the channel unit, else the first preset (or identity). */
export function suggestConversion(slot: TemplateSlot, channelUnit: string | null | undefined): Conversion {
  const unit = (channelUnit ?? "").trim().toLowerCase();
  const presets = slot.presets ?? [];
  const match = unit ? presets.find((p) => p.from.includes(unit)) : undefined;
  const p = match ?? presets[0];
  return p ? { factor: p.factor, offset: p.offset } : IDENTITY;
}

/** Number literal for formulas, rounded to 10 significant digits. */
export function formatNumber(x: number): string {
  if (!Number.isFinite(x)) throw new RangeError("Zahl ist nicht endlich");
  const v = Number(x.toPrecision(10));
  return Object.is(v, -0) ? "0" : String(v);
}

export function isIdentity(c: Conversion | undefined): boolean {
  return !c || (c.factor === 1 && c.offset === 0);
}

/** `tel("name")` with the conversion; parenthesized when not the identity. */
export function convertedRef(channel: string, conversion: Conversion | undefined): string {
  const tel = `tel(${quote(channel)})`;
  if (isIdentity(conversion)) return tel;
  const { factor, offset } = conversion!;
  let expr = factor === 1 ? tel : `${tel} * ${formatNumber(factor)}`;
  if (offset > 0) expr += ` + ${formatNumber(offset)}`;
  else if (offset < 0) expr += ` - ${formatNumber(-offset)}`;
  return `(${expr})`;
}
