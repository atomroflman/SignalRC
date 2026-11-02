// Function catalog of the formula editor (expression §5): signatures and
// short descriptions for completion, signature help and hover. The types are
// those of AP06 (analyze.ts); a test keeps both lists in step.
import type { Locale } from "../../runtime/types";

/** Parameter type as shown: a static type, `T` (same type), a text literal or a digit literal. */
export type ParamType = "number" | "bool" | "text" | "T" | "name" | "0–6";

export interface FunctionDoc {
  name: string;
  params: { name: string; type: ParamType }[];
  /** The last parameter repeats (2–16 arguments). */
  variadic?: boolean;
  result: "number" | "bool" | "text" | "T";
  group: "source" | "control" | "math" | "text";
  doc: Record<Locale, string>;
}

const n = (name: string) => ({ name, type: "number" as const });
const math = (name: string, params: string[], de: string, en: string): FunctionDoc =>
  ({ name, params: params.map(n), result: "number", group: "math", doc: { de, en } });

export const FUNCTION_DOCS: FunctionDoc[] = [
  { name: "tel", params: [{ name: "kanal", type: "name" }], result: "T", group: "source",
    doc: { de: "Telemetriekanal; Typ aus dem Kanal (Integer/Number → number, Boolean → bool, String → text).", en: "Telemetry channel; type from the channel (Integer/Number → number, Boolean → bool, String → text)." } },
  { name: "out", params: [{ name: "ausgang", type: "name" }], result: "number", group: "source",
    doc: { de: "Wert eines Steuerausgangs.", en: "Value of a control output." } },
  { name: "sig", params: [{ name: "signal", type: "name" }], result: "number", group: "source",
    doc: { de: "Signal des Dokuments.", en: "Signal of the document." } },
  { name: "driverActive", params: [], result: "bool", group: "source",
    doc: { de: "true, solange ein Fahrer steuert.", en: "true while a driver is in control." } },
  { name: "if", params: [{ name: "bedingung", type: "bool" }, { name: "dann", type: "T" }, { name: "sonst", type: "T" }], result: "T", group: "control",
    doc: { de: "Wählt je nach Bedingung einen Zweig; nur der gewählte Zweig wird ausgewertet.", en: "Picks a branch by the condition; only the chosen branch is evaluated." } },
  { name: "valid", params: [{ name: "x", type: "T" }], result: "bool", group: "control",
    doc: { de: "true, wenn x gültig oder ungeprüft ist; nie selbst ungültig.", en: "true if x is valid or unchecked; never invalid itself." } },
  { name: "fallback", params: [{ name: "x", type: "T" }, { name: "ersatz", type: "T" }], result: "T", group: "control",
    doc: { de: "x, solange x nicht ungültig ist, sonst der Ersatz.", en: "x unless it is invalid, otherwise the replacement." } },
  math("abs", ["x"], "Betrag.", "Absolute value."),
  math("sign", ["x"], "Vorzeichen: −1, 0 oder 1.", "Sign: −1, 0 or 1."),
  { name: "min", params: [n("a"), n("b")], variadic: true, result: "number", group: "math",
    doc: { de: "Kleinster Wert (2–16 Argumente).", en: "Smallest value (2–16 arguments)." } },
  { name: "max", params: [n("a"), n("b")], variadic: true, result: "number", group: "math",
    doc: { de: "Größter Wert (2–16 Argumente).", en: "Largest value (2–16 arguments)." } },
  math("clamp", ["x", "lo", "hi"], "Begrenzt x auf [lo, hi].", "Limits x to [lo, hi]."),
  math("map", ["x", "inMin", "inMax", "outMin", "outMax"], "Linear umrechnen, ohne Begrenzung.", "Linear mapping without limits."),
  math("mapClamped", ["x", "inMin", "inMax", "outMin", "outMax"], "Linear umrechnen, auf den Zielbereich begrenzt.", "Linear mapping limited to the output range."),
  math("round", ["x"], "Kaufmännisch runden (0,5 von null weg).", "Round half away from zero."),
  math("floor", ["x"], "Abrunden.", "Round down."),
  math("ceil", ["x"], "Aufrunden.", "Round up."),
  math("mod", ["a", "b"], "Rest; Vorzeichen von b.", "Remainder with the sign of b."),
  math("wrap", ["x", "lo", "hi"], "Faltet x in [lo, hi), z. B. Winkel.", "Wraps x into [lo, hi), e.g. angles."),
  math("sqrt", ["x"], "Quadratwurzel.", "Square root."),
  math("pow", ["basis", "exponent"], "Potenz.", "Power."),
  math("hypot", ["a", "b"], "√(a² + b²).", "√(a² + b²)."),
  math("sin", ["rad"], "Sinus (Bogenmaß).", "Sine (radians)."),
  math("cos", ["rad"], "Kosinus (Bogenmaß).", "Cosine (radians)."),
  math("tan", ["rad"], "Tangens (Bogenmaß).", "Tangent (radians)."),
  math("asin", ["x"], "Arkussinus, Ergebnis im Bogenmaß.", "Arc sine in radians."),
  math("acos", ["x"], "Arkuskosinus, Ergebnis im Bogenmaß.", "Arc cosine in radians."),
  math("atan", ["x"], "Arkustangens, Ergebnis im Bogenmaß.", "Arc tangent in radians."),
  math("atan2", ["y", "x"], "Winkel des Punkts (x, y) im Bogenmaß.", "Angle of point (x, y) in radians."),
  math("rad", ["grad"], "Grad → Bogenmaß.", "Degrees → radians."),
  math("deg", ["rad"], "Bogenmaß → Grad.", "Radians → degrees."),
  math("pi", [], "Die Zahl π.", "The number π."),
  { name: "format", params: [n("x"), { name: "stellen", type: "0–6" }], result: "text", group: "text",
    doc: { de: "Zahl als Text mit festen Nachkommastellen (Literal 0–6).", en: "Number as text with fixed decimals (literal 0–6)." } },
  { name: "concat", params: [{ name: "a", type: "text" }, { name: "b", type: "text" }], variadic: true, result: "text", group: "text",
    doc: { de: "Texte verbinden (2–16 Argumente); Zahlen über format().", en: "Joins texts (2–16 arguments); numbers via format()." } },
];

export const FUNCTION_DOC = new Map(FUNCTION_DOCS.map((f) => [f.name, f]));

/** `name(a: number, b: number, …) → number` */
export function signature(f: FunctionDoc): string {
  const params = f.params.map((p) => `${p.name}: ${p.type}`);
  if (f.variadic) params.push("…");
  return `${f.name}(${params.join(", ")}) → ${f.result}`;
}

export const LITERAL_DOCS: Record<"true" | "false", Record<Locale, string>> = {
  true: { de: "Wahrheitswert wahr.", en: "Boolean true." },
  false: { de: "Wahrheitswert falsch.", en: "Boolean false." },
};

export const formulaTexts: Record<Locale, { unknownSource: string; decimals: string; noSources: string }> = {
  de: { unknownSource: "unbekannte Quelle", decimals: "Nachkommastellen", noSources: "keine Quellen bekannt" },
  en: { unknownSource: "unknown source", decimals: "decimals", noSources: "no sources known" },
};
