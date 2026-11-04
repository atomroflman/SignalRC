// AP10 – formula field logic on top of AP06: live analysis of the text being
// typed, simple channel bindings without a hand-written formula and the live
// value shown in the property editor (also in design mode, runtime §7).
// There is no second formula engine here: analyze/evaluate come from AP06.
import { checkLiteral, kindDef, type PropDef } from "../../document/catalog";
import { analyze, canonical, evaluate, localized, type Analysis, type AnalysisEnv, type ExprDiagnostic, type RuntimeValue, type ValueSource } from "../../expression";
import type { TextValue } from "../../expression";
import type { Locale } from "../../runtime/types";
import { roundHalfAway } from "../../runtime/values";

export type SourceKind = "tel" | "out" | "sig";

export interface SimpleSource {
  kind: SourceKind;
  name: string;
}

const SIMPLE = /^\s*(tel|out|sig)\(\s*"((?:[^"\\]|\\["\\])*)"\s*\)\s*$/;

/** Recognizes a plain source reference such as `tel("speed")` (simple binding). */
export function simpleSource(expr: string): SimpleSource | undefined {
  const m = SIMPLE.exec(expr);
  if (!m || m[2] === "") return undefined;
  return { kind: m[1] as SourceKind, name: m[2].replace(/\\(["\\])/g, "$1") };
}

/** The formula of a simple binding; text literal escaping per expression §1. */
export function sourceExpr(kind: SourceKind, name: string): string {
  return `${kind}("${name.replace(/[\\"]/g, (c) => `\\${c}`)}")`;
}

export interface FormulaCheck {
  analysis: Analysis;
  /** The one diagnostic of the analysis (expression §7), if any. */
  diagnostic?: ExprDiagnostic;
}

/**
 * Live check of a formula with the result kind of the property (`bool` for
 * clip conditions, `number` for rates).
 */
export function checkFormula(expr: string, env: AnalysisEnv, expected: string): FormulaCheck {
  const analysis = analyze(expr, env, expected);
  return { analysis, diagnostic: analysis.diagnostics[0] };
}

export interface LiveValue {
  state: RuntimeValue["state"] | "none";
  paused: boolean;
  /** Displayed value; undefined when there is none. */
  text?: string;
  /** Runtime diagnostic code (OVL_EXPR_DIV_ZERO …, OVL_RUNTIME_INVALID_VALUE). */
  diagnostic?: string;
}

function show(value: RuntimeValue["value"], locale: Locale): string {
  if (typeof value === "number") {
    const s = String(Math.round(value * 1e6) / 1e6);
    return locale === "de" ? s.replace(".", ",") : s;
  }
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return localized(value as TextValue, locale);
  return "";
}

/**
 * Evaluates a checked formula against the source. Formulas with a static
 * diagnostic are not evaluated. With `def`, a value the property cannot show
 * (invalid color text, outside the catalog limits) is marked like the runtime
 * does (runtime §8, OVL_RUNTIME_INVALID_VALUE); opacity is clamped.
 */
export function liveValue(check: FormulaCheck, source: ValueSource | undefined, locale: Locale, def?: PropDef): LiveValue {
  if (check.diagnostic || !source) return { state: "none", paused: false };
  let result: RuntimeValue;
  try {
    result = evaluate(check.analysis, source);
  } catch {
    return { state: "invalid", paused: false, diagnostic: "OVL_RUNTIME_ERROR" };
  }
  const out: LiveValue = { state: result.state, paused: result.paused };
  if (result.state === "invalid") {
    if (result.diagnostic) out.diagnostic = result.diagnostic;
    return out;
  }
  out.text = show(result.value, locale);
  if (def && result.value !== undefined) {
    const kind = kindDef(def);
    let v: unknown = Array.isArray(result.value) ? canonical(result.value as TextValue) : result.value;
    if (kind.integer && typeof v === "number") v = roundHalfAway(v);
    if (kind.clamp && typeof v === "number") v = Math.min(kind.max ?? v, Math.max(kind.min ?? v, v));
    if (kind.valueType !== "any" && checkLiteral(def, v) !== null) out.diagnostic = "OVL_RUNTIME_INVALID_VALUE";
    if (typeof v === "number" && v !== result.value) out.text = show(v, locale);
  }
  return out;
}
