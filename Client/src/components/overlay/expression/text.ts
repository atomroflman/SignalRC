// Text values and number formatting (Shared/Overlay/expression/README.md §6).

/** Text is kept as segments so numbers can be localized only when displayed (D48). */
export type Segment = { text: string } | { number: number; decimals: number };
export type TextValue = Segment[];

/**
 * Rounds `x` to `decimals` places in decimal, starting from the shortest
 * round-trip representation (JS String(x), .NET "R"), half away from zero.
 * format(1.005, 2) is therefore 1.01 on every platform. Never "-0".
 */
export function formatDecimal(x: number, decimals: number): string {
  const [mantissa, exponent] = String(Math.abs(x)).split("e");
  const [intPart, fracPart = ""] = mantissa.split(".");
  let digits = intPart + fracPart;
  let point = intPart.length + (exponent ? Number(exponent) : 0);
  if (point < 0) {
    digits = "0".repeat(-point) + digits;
    point = 0;
  }
  const keep = point + decimals;
  let kept = digits.slice(0, keep).padEnd(keep, "0");
  if (digits.length > keep && digits[keep] >= "5") {
    const carried = increment(kept);
    if (carried.length > kept.length) point++;
    kept = carried;
  }
  const whole = kept.slice(0, point).replace(/^0+(?=\d)/, "") || "0";
  const fraction = kept.slice(point);
  const text = decimals > 0 ? `${whole}.${fraction}` : whole;
  return x < 0 && /[1-9]/.test(text) ? `-${text}` : text;
}

function increment(digits: string): string {
  const chars = digits.split("");
  for (let i = chars.length - 1; i >= 0; i--) {
    if (chars[i] !== "9") {
      chars[i] = String(Number(chars[i]) + 1);
      return chars.join("");
    }
    chars[i] = "0";
  }
  return "1" + chars.join("");
}

/** Language-independent form used for comparisons and tests. */
export function canonical(text: TextValue): string {
  return text.map((s) => ("text" in s ? s.text : formatDecimal(s.number, s.decimals))).join("");
}

/** Display form: number segments use the viewer's decimal separator, no grouping. */
export function localized(text: TextValue, locale: "de" | "en"): string {
  return text.map((s) => {
    if ("text" in s) return s.text;
    const n = formatDecimal(s.number, s.decimals);
    return locale === "de" ? n.replace(".", ",") : n;
  }).join("");
}
