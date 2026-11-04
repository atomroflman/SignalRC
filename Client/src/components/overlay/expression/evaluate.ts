// Runtime evaluation (Shared/Overlay/expression/README.md §4). Plain tree
// walking: no eval, no Function constructor, no generated code.
import type { Analysis } from "./analyze";
import type { Node } from "./parser";
import type { TextValue } from "./text";
import { canonical } from "./text";

export type ValueState = "valid" | "unchecked" | "invalid";

export interface SourceValue {
  state: ValueState;
  paused?: boolean;
  /** tel: the raw telemetry text; out/sig: a number. */
  value?: unknown;
}

export interface ValueSource {
  get(kind: "tel" | "out" | "sig", name: string): SourceValue;
  driverActive(): boolean;
}

export type Value = number | boolean | TextValue;

export interface RuntimeValue {
  state: ValueState;
  paused: boolean;
  value?: Value;
  /** Why the result is invalid, when a computation or parse failed. */
  diagnostic?: string;
}

const NUMBER_TEXT = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

const invalid = (diagnostic?: string): RuntimeValue =>
  diagnostic ? { state: "invalid", paused: false, diagnostic } : { state: "invalid", paused: false };

const worst = (a: ValueState, b: ValueState): ValueState =>
  a === "invalid" || b === "invalid" ? "invalid" : a === "unchecked" || b === "unchecked" ? "unchecked" : "valid";

/** Strict combination: any invalid argument makes the result invalid without computing. */
function strict(args: RuntimeValue[], compute: (values: Value[]) => Value | RuntimeValue): RuntimeValue {
  const bad = args.find((a) => a.state === "invalid");
  if (bad) return invalid(bad.diagnostic);
  const result = compute(args.map((a) => a.value!));
  const state = args.reduce<ValueState>((s, a) => worst(s, a.state), "valid");
  const paused = args.some((a) => a.paused);
  if (typeof result === "object" && result !== null && "state" in result) return result;
  return { state, paused, value: result as Value };
}

/** Numeric results must be finite: NaN is a domain error, infinity an overflow. */
function num(x: number): number | RuntimeValue {
  if (Number.isNaN(x)) return invalid("OVL_EXPR_DOMAIN");
  if (!Number.isFinite(x)) return invalid("OVL_EXPR_NOT_FINITE");
  return x;
}

const domain = () => invalid("OVL_EXPR_DOMAIN");

function roundHalfAway(x: number): number {
  const a = Math.abs(x);
  const f = Math.floor(a);
  const r = a - f >= 0.5 ? f + 1 : f;
  return x < 0 ? -r : r;
}

function mod(a: number, b: number): number {
  const r = a % b;
  return r !== 0 && (r < 0) !== (b < 0) ? r + b : r;
}

function map(x: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  return outMin + ((x - inMin) * (outMax - outMin)) / (inMax - inMin);
}

const MATH: Record<string, (...a: number[]) => number | RuntimeValue> = {
  abs: (x) => Math.abs(x),
  sign: (x) => (x > 0 ? 1 : x < 0 ? -1 : 0),
  min: (...a) => Math.min(...a),
  max: (...a) => Math.max(...a),
  clamp: (x, lo, hi) => (lo > hi ? domain() : Math.min(Math.max(x, lo), hi)),
  map: (x, a, b, c, d) => (a === b ? domain() : num(map(x, a, b, c, d))),
  mapClamped: (x, a, b, c, d) => {
    if (a === b) return domain();
    const v = num(map(x, a, b, c, d));
    return typeof v === "number" ? Math.min(Math.max(v, Math.min(c, d)), Math.max(c, d)) : v;
  },
  round: roundHalfAway,
  floor: Math.floor,
  ceil: Math.ceil,
  mod: (a, b) => (b === 0 ? invalid("OVL_EXPR_DIV_ZERO") : num(mod(a, b))),
  wrap: (x, lo, hi) => (hi <= lo ? domain() : num(lo + mod(x - lo, hi - lo))),
  sqrt: (x) => (x < 0 ? domain() : Math.sqrt(x)),
  pow: (b, e) => num(Math.pow(b, e)),
  hypot: (a, b) => num(Math.hypot(a, b)),
  sin: Math.sin,
  cos: Math.cos,
  tan: (x) => num(Math.tan(x)),
  asin: (x) => (Math.abs(x) > 1 ? domain() : Math.asin(x)),
  acos: (x) => (Math.abs(x) > 1 ? domain() : Math.acos(x)),
  atan: Math.atan,
  atan2: Math.atan2,
  rad: (x) => (x * Math.PI) / 180,
  deg: (x) => num((x * 180) / Math.PI),
  pi: () => Math.PI,
};

function equals(a: Value, b: Value): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return canonical(a) === canonical(b);
  return a === b;
}

class Evaluator {
  constructor(private readonly analysis: Analysis, private readonly source: ValueSource) {}

  eval(node: Node): RuntimeValue {
    switch (node.kind) {
      case "number": return { state: "valid", paused: false, value: node.value };
      case "text": return { state: "valid", paused: false, value: [{ text: node.value }] };
      case "bool": return { state: "valid", paused: false, value: node.value };
      case "unary": {
        const operand = this.eval(node.operand);
        return strict([operand], ([v]) => (node.op === "-" ? -(v as number) : !(v as boolean)));
      }
      case "binary": return this.binary(node);
      case "call": return this.call(node);
    }
  }

  private binary(node: Extract<Node, { kind: "binary" }>): RuntimeValue {
    if (node.op === "&&" || node.op === "||") {
      const left = this.eval(node.left);
      if (left.state === "invalid") return invalid(left.diagnostic);
      // The left side decides: the right side is not evaluated at all (D20, D27).
      if ((node.op === "&&") !== left.value) return left;
      const right = this.eval(node.right);
      if (right.state === "invalid") return invalid(right.diagnostic);
      return { state: worst(left.state, right.state), paused: left.paused || right.paused, value: right.value };
    }
    const args = [this.eval(node.left), this.eval(node.right)];
    return strict(args, ([a, b]) => {
      switch (node.op) {
        case "+": return num((a as number) + (b as number));
        case "-": return num((a as number) - (b as number));
        case "*": return num((a as number) * (b as number));
        case "/": return b === 0 ? invalid("OVL_EXPR_DIV_ZERO") : num((a as number) / (b as number));
        case "<": return (a as number) < (b as number);
        case "<=": return (a as number) <= (b as number);
        case ">": return (a as number) > (b as number);
        case ">=": return (a as number) >= (b as number);
        case "==": return equals(a, b);
        case "!=": return !equals(a, b);
      }
      throw new Error(`unreachable operator ${node.op}`);
    });
  }

  private call(node: Extract<Node, { kind: "call" }>): RuntimeValue {
    const { name, args } = node;
    switch (name) {
      case "tel": case "out": case "sig":
        return this.readSource(node);
      case "driverActive":
        return { state: "valid", paused: false, value: this.source.driverActive() };
      case "if": {
        const c = this.eval(args[0]);
        if (c.state === "invalid") return invalid(c.diagnostic);
        const branch = this.eval(c.value ? args[1] : args[2]);
        if (branch.state === "invalid") return invalid(branch.diagnostic);
        return { state: worst(c.state, branch.state), paused: c.paused || branch.paused, value: branch.value };
      }
      case "valid": {
        const x = this.eval(args[0]);
        return { state: "valid", paused: false, value: x.state !== "invalid" };
      }
      case "fallback": {
        const x = this.eval(args[0]);
        return x.state !== "invalid" ? x : this.eval(args[1]);
      }
      case "format": {
        const decimals = (args[1] as Extract<Node, { kind: "number" }>).value;
        return strict([this.eval(args[0])], ([x]) => [{ number: x as number, decimals }]);
      }
      case "concat":
        return strict(args.map((a) => this.eval(a)), (values) => (values as TextValue[]).flat());
    }
    const fn = MATH[name];
    return strict(args.map((a) => this.eval(a)), (values) => fn(...(values as number[])));
  }

  private readSource(node: Extract<Node, { kind: "call" }>): RuntimeValue {
    const name = (node.args[0] as Extract<Node, { kind: "text" }>).value;
    const kind = node.name as "tel" | "out" | "sig";
    const v = this.source.get(kind, name);
    if (v.state === "invalid") return invalid();
    const paused = kind !== "tel" && v.paused === true;
    if (kind !== "tel") {
      return typeof v.value === "number" && Number.isFinite(v.value)
        ? { state: v.state, paused, value: v.value }
        : invalid();
    }
    const raw = typeof v.value === "string" ? v.value : "";
    const parsed = parseTelemetry(raw, this.analysis.types.get(node) ?? "unknown");
    return parsed === undefined
      ? invalid("OVL_EXPR_SOURCE_PARSE")
      : { state: v.state, paused: false, value: parsed };
  }
}

/** Telemetry texts are culture-invariant; empty or malformed text is not a value. */
function parseTelemetry(raw: string, type: string): Value | undefined {
  switch (type) {
    case "number": {
      if (!NUMBER_TEXT.test(raw)) return undefined;
      const n = Number(raw);
      return Number.isFinite(n) ? n : undefined;
    }
    case "bool": {
      const t = raw.toLowerCase();
      return t === "1" || t === "true" ? true : t === "0" || t === "false" ? false : undefined;
    }
    case "text":
      return [{ text: raw }];
    default:
      return undefined;
  }
}

/**
 * Evaluates an analysis without diagnostics. With diagnostics the formula is
 * not usable and the result is invalid, carrying the first diagnostic code.
 */
export function evaluate(analysis: Analysis, source: ValueSource): RuntimeValue {
  if (!analysis.ast || analysis.diagnostics.length > 0) return invalid(analysis.diagnostics[0]?.code);
  return new Evaluator(analysis, source).eval(analysis.ast);
}
