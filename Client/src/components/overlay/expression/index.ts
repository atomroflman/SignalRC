// AP06 – expression system (Shared/Overlay/expression/README.md).
import type { ExpressionAnalyzer } from "../document/types";
import { analyze } from "./analyze";

export { analyze, requiredType, FUNCTIONS, MAX_DEPTH, MAX_LENGTH } from "./analyze";
export type { Analysis, AnalysisEnv, Dependency, ExprDiagnostic, ExprType } from "./analyze";
export { evaluate } from "./evaluate";
export type { RuntimeValue, SourceValue, ValueSource, ValueState, Value } from "./evaluate";
export { canonical, formatDecimal, localized } from "./text";
export type { Segment, TextValue } from "./text";

/** The expression port of the document validation (AP01). */
export const expressionAnalyzer: ExpressionAnalyzer = {
  analyze(expr, env, expected) {
    return { diagnostics: analyze(expr, env, expected).diagnostics };
  },
};
