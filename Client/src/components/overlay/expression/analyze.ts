// Static analysis (Shared/Overlay/expression/README.md §3, §5, §7).
import { depth, parse, SyntaxError, type Node } from "./parser";

export type ExprType = "number" | "bool" | "text" | "unknown";
export type SourceKind = "tel" | "out" | "sig" | "driver";
export type TelemetryDataType = "String" | "Integer" | "Number" | "Boolean" | "LidarGrid";

export interface Dependency { kind: SourceKind; name: string }

export interface ExprDiagnostic {
  code: string;
  category: "structure" | "publish";
  offset: number;
  message: string;
}

/**
 * Known sources. A missing telemetry or outputs list means "not known here":
 * those references are then neither checked nor typed (type unknown).
 */
export interface AnalysisEnv {
  telemetry?: Record<string, TelemetryDataType>;
  outputs?: string[];
  signals: string[];
}

export interface Analysis {
  source: string;
  ast?: Node;
  type: ExprType;
  dependencies: Dependency[];
  diagnostics: ExprDiagnostic[];
  /** Static type of every node, used by the evaluator. */
  types: Map<Node, ExprType>;
}

export const MAX_LENGTH = 1000;
export const MAX_DEPTH = 32;

/** Fixed signatures: argument types and result type. */
const FIXED: Record<string, { args: ExprType[]; result: ExprType }> = {
  abs: { args: ["number"], result: "number" },
  sign: { args: ["number"], result: "number" },
  clamp: { args: ["number", "number", "number"], result: "number" },
  map: { args: ["number", "number", "number", "number", "number"], result: "number" },
  mapClamped: { args: ["number", "number", "number", "number", "number"], result: "number" },
  round: { args: ["number"], result: "number" },
  floor: { args: ["number"], result: "number" },
  ceil: { args: ["number"], result: "number" },
  mod: { args: ["number", "number"], result: "number" },
  wrap: { args: ["number", "number", "number"], result: "number" },
  sqrt: { args: ["number"], result: "number" },
  pow: { args: ["number", "number"], result: "number" },
  hypot: { args: ["number", "number"], result: "number" },
  sin: { args: ["number"], result: "number" },
  cos: { args: ["number"], result: "number" },
  tan: { args: ["number"], result: "number" },
  asin: { args: ["number"], result: "number" },
  acos: { args: ["number"], result: "number" },
  atan: { args: ["number"], result: "number" },
  atan2: { args: ["number", "number"], result: "number" },
  rad: { args: ["number"], result: "number" },
  deg: { args: ["number"], result: "number" },
  pi: { args: [], result: "number" },
  driverActive: { args: [], result: "bool" },
};
const VARIADIC: Record<string, { arg: ExprType; result: ExprType }> = {
  min: { arg: "number", result: "number" },
  max: { arg: "number", result: "number" },
  concat: { arg: "text", result: "text" },
};
const SPECIAL = ["tel", "out", "sig", "if", "valid", "fallback", "format", "formatDate", "formatDateUtc", "formatDuration"];

/** Longest date/duration format literal (§6a). */
export const MAX_DATE_FORMAT_LENGTH = 64;

export const FUNCTIONS = new Set([...Object.keys(FIXED), ...Object.keys(VARIADIC), ...SPECIAL]);

/** Result type a property kind requires (§3); undefined = any type. */
export function requiredType(expected: string): ExprType | undefined {
  switch (expected) {
    case "number": case "length": case "angle": case "factor": case "opacity": case "integer":
      return "number";
    case "bool":
      return "bool";
    case "text": case "color":
      return "text";
    default:
      return undefined;
  }
}

const telemetryType = (t: TelemetryDataType): ExprType =>
  t === "Integer" || t === "Number" ? "number" : t === "Boolean" ? "bool" : t === "String" ? "text" : "unknown";

class Analyzer {
  readonly diagnostics: ExprDiagnostic[] = [];
  readonly dependencies: Dependency[] = [];
  readonly types = new Map<Node, ExprType>();

  constructor(private readonly env: AnalysisEnv) {}

  private error(code: string, offset: number, message: string): void {
    this.diagnostics.push({ code, category: "publish", offset, message });
  }

  /** Reports a type mismatch at `node` unless either side is unknown. */
  private expect(node: Node, actual: ExprType, wanted: ExprType): void {
    if (actual !== "unknown" && actual !== wanted) {
      this.error("OVL_EXPR_TYPE", node.start, `${wanted} erwartet, ${actual} gefunden`);
    }
  }

  visit(node: Node): ExprType {
    const type = this.typeOf(node);
    this.types.set(node, type);
    return type;
  }

  private typeOf(node: Node): ExprType {
    switch (node.kind) {
      case "number": return "number";
      case "text": return "text";
      case "bool": return "bool";
      case "unary": {
        const t = this.visit(node.operand);
        const wanted = node.op === "-" ? "number" : "bool";
        this.expect(node.operand, t, wanted);
        return wanted;
      }
      case "binary":
        return this.binary(node);
      case "call":
        return this.call(node);
    }
  }

  private binary(node: Extract<Node, { kind: "binary" }>): ExprType {
    const l = this.visit(node.left);
    const r = this.visit(node.right);
    switch (node.op) {
      case "+": case "-": case "*": case "/":
        this.expect(node.left, l, "number");
        this.expect(node.right, r, "number");
        return "number";
      case "<": case "<=": case ">": case ">=":
        this.expect(node.left, l, "number");
        this.expect(node.right, r, "number");
        return "bool";
      case "&&": case "||":
        this.expect(node.left, l, "bool");
        this.expect(node.right, r, "bool");
        return "bool";
      case "==": case "!=":
        if (l !== "unknown") this.expect(node.right, r, l);
        return "bool";
    }
  }

  private arity(node: Extract<Node, { kind: "call" }>, min: number, max = min): boolean {
    if (node.args.length >= min && node.args.length <= max) return true;
    this.error("OVL_EXPR_ARITY", node.start, `${node.name} erwartet ${min === max ? min : `${min}–${max}`} Argumente`);
    return false;
  }

  private call(node: Extract<Node, { kind: "call" }>): ExprType {
    const { name, args } = node;
    const fixed = FIXED[name];
    const variadic = VARIADIC[name];
    if (!FUNCTIONS.has(name)) {
      this.error("OVL_EXPR_UNKNOWN_FUNCTION", node.start, `unbekannte Funktion ${name}`);
      args.forEach((a) => this.visit(a));
      return "unknown";
    }
    if (name === "tel" || name === "out" || name === "sig") return this.source(node);
    if (fixed) {
      const types = args.map((a) => this.visit(a));
      if (name === "driverActive" && this.arity(node, 0)) this.dependencies.push({ kind: "driver", name: "" });
      else if (name !== "driverActive" && this.arity(node, fixed.args.length)) {
        args.forEach((a, i) => this.expect(a, types[i], fixed.args[i]));
      }
      return fixed.result;
    }
    if (variadic) {
      const types = args.map((a) => this.visit(a));
      if (this.arity(node, 2, 16)) args.forEach((a, i) => this.expect(a, types[i], variadic.arg));
      return variadic.result;
    }
    const types = args.map((a) => this.visit(a));
    switch (name) {
      case "if":
        if (!this.arity(node, 3)) return "unknown";
        this.expect(args[0], types[0], "bool");
        if (types[1] !== "unknown") this.expect(args[2], types[2], types[1]);
        return types[1] !== "unknown" ? types[1] : types[2];
      case "valid":
        this.arity(node, 1);
        return "bool";
      case "fallback":
        if (!this.arity(node, 2)) return "unknown";
        if (types[0] !== "unknown") this.expect(args[1], types[1], types[0]);
        return types[0] !== "unknown" ? types[0] : types[1];
      case "format": {
        if (!this.arity(node, 2)) return "text";
        this.expect(args[0], types[0], "number");
        const d = args[1];
        if (d.kind !== "number") this.error("OVL_EXPR_LITERAL_REQUIRED", d.start, "Dezimalstellen müssen eine feste Zahl sein");
        else if (!Number.isInteger(d.value) || d.value < 0 || d.value > 6) {
          this.error("OVL_EXPR_ARGUMENT_RANGE", d.start, "Dezimalstellen 0–6 erwartet");
        }
        return "text";
      }
      case "formatDate": case "formatDateUtc": case "formatDuration": {
        if (!this.arity(node, 2)) return "text";
        this.expect(args[0], types[0], "number");
        const f = args[1];
        if (f.kind !== "text") this.error("OVL_EXPR_LITERAL_REQUIRED", f.start, "Format muss ein Textliteral sein");
        else if (f.value.length === 0 || f.value.length > MAX_DATE_FORMAT_LENGTH) {
          this.error("OVL_EXPR_ARGUMENT_RANGE", f.start, `Format mit 1–${MAX_DATE_FORMAT_LENGTH} Zeichen erwartet`);
        }
        return "text";
      }
    }
    return "unknown";
  }

  private source(node: Extract<Node, { kind: "call" }>): ExprType {
    node.args.forEach((a) => this.visit(a));
    if (!this.arity(node, 1)) return "unknown";
    const arg = node.args[0];
    if (arg.kind !== "text") {
      this.error("OVL_EXPR_LITERAL_REQUIRED", arg.start, "Quellname muss ein Textliteral sein");
      return "unknown";
    }
    const kind = node.name as "tel" | "out" | "sig";
    this.dependencies.push({ kind, name: arg.value });
    const unknown = () => {
      this.error("OVL_REF_UNKNOWN_SOURCE", node.start, `unbekannte Quelle ${kind}("${arg.value}")`);
      return "unknown" as const;
    };
    switch (kind) {
      case "tel": {
        if (!this.env.telemetry) return "unknown";
        const t = Object.hasOwn(this.env.telemetry, arg.value) ? this.env.telemetry[arg.value] : undefined;
        if (t === "LidarGrid") {
          this.error("OVL_EXPR_TYPE", node.start, "Ein LiDAR-Raster ist kein Formelwert");
          return "unknown";
        }
        return t === undefined ? unknown() : telemetryType(t);
      }
      case "out":
        if (!this.env.outputs) return "number";
        return this.env.outputs.includes(arg.value) ? "number" : unknown();
      case "sig":
        return this.env.signals.includes(arg.value) ? "number" : unknown();
    }
  }
}

const codePoints = (s: string) => {
  let n = 0;
  for (const _ of s) n++;
  return n;
};

/**
 * Analyzes a formula. At most one diagnostic is reported, chosen in this
 * order: length, syntax, depth, the first semantic error in source order,
 * finally a wrong result type (which sits at offset 0 and would otherwise
 * hide every real error).
 */
export function analyze(source: string, env: AnalysisEnv, expected = "any"): Analysis {
  const empty = (d: ExprDiagnostic): Analysis =>
    ({ source, type: "unknown", dependencies: [], diagnostics: [d], types: new Map() });
  if (codePoints(source) > MAX_LENGTH) {
    return empty({ code: "OVL_LIMIT_EXCEEDED", category: "structure", offset: 0, message: "Formel länger als 1000 Zeichen" });
  }
  if (source.trim() === "") return empty({ code: "OVL_EXPR_EMPTY", category: "publish", offset: 0, message: "Formel ist leer" });
  let ast: Node;
  try {
    ast = parse(source);
  } catch (e) {
    if (!(e instanceof SyntaxError)) throw e;
    return empty({ code: "OVL_EXPR_SYNTAX", category: "publish", offset: e.offset, message: e.message });
  }
  if (depth(ast) > MAX_DEPTH) {
    return empty({ code: "OVL_LIMIT_EXCEEDED", category: "structure", offset: 0, message: "Formel tiefer als 32 Ebenen" });
  }
  const analyzer = new Analyzer(env);
  const type = analyzer.visit(ast);
  let diagnostics: ExprDiagnostic[] = [];
  if (analyzer.diagnostics.length > 0) {
    const first = analyzer.diagnostics.reduce((a, b) => (b.offset < a.offset ? b : a));
    diagnostics = [first];
  } else {
    const required = requiredType(expected);
    if (required && type !== "unknown" && type !== required) {
      diagnostics = [{ code: "OVL_EXPR_RESULT_TYPE", category: "publish", offset: 0, message: `Ergebnis muss ${required} sein, ist ${type}` }];
    }
  }
  return { source, ast, type, dependencies: analyzer.dependencies, diagnostics, types: analyzer.types };
}
