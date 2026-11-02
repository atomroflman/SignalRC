// Test double for the expression port until AP06 exists: it only reports
// unknown sources, found by a plain pattern match.
import type { ExpressionAnalyzer } from "../document/types";

const SOURCE = /\b(tel|out|sig)\(\s*"([^"\\]*)"\s*\)/g;

export const fakeExpressionAnalyzer: ExpressionAnalyzer = {
  analyze(expr, env) {
    const diagnostics = [];
    for (const match of expr.matchAll(SOURCE)) {
      const [, kind, name] = match;
      const known =
        kind === "sig" ? env.signals.includes(name)
        : kind === "out" ? env.outputs.includes(name)
        : Object.keys(env.telemetry).length === 0 || env.telemetry[name] !== undefined;
      if (!known && (kind !== "out" || env.outputs.length > 0)) {
        diagnostics.push({ code: "OVL_REF_UNKNOWN_SOURCE", category: "publish" as const, offset: match.index ?? 0 });
      }
    }
    return { diagnostics };
  },
};
