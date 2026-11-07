import { describe, expect, it } from "vitest";
import { readContractJson } from "../testing/fixtures";
import { analyze, type AnalysisEnv, type TelemetryDataType } from "./analyze";
import { evaluate, type ValueSource, type ValueState } from "./evaluate";
import { canonical, formatDecimal, localized, type TextValue } from "./text";
import { formatDuration, formatTimestamp } from "./date-format";

interface Expected { code: string; category: string; offset: number }
interface Case {
  id: string;
  expr: string;
  expectedKind?: string;
  analysis: { type?: string; dependencies?: { kind: string; name: string }[]; diagnostics: Expected[] };
  result?: { state: ValueState; value?: unknown; paused?: boolean; runtimeDiagnostic?: string };
}
interface Fixture {
  context: {
    telemetry: Record<string, { dataType: TelemetryDataType; raw: string; state: ValueState }>;
    outputs: Record<string, { value?: number; state: ValueState; paused?: boolean }>;
    signals: Record<string, { value?: number; state: ValueState; paused?: boolean }>;
    driverActive: boolean;
  };
  defaultExpectedKind: string;
  cases: Case[];
}

const fixture = readContractJson<Fixture>("fixtures/expressions/cases.json");
const { context } = fixture;
const env: AnalysisEnv = {
  telemetry: Object.fromEntries(Object.entries(context.telemetry).map(([k, v]) => [k, v.dataType])),
  outputs: Object.keys(context.outputs),
  signals: Object.keys(context.signals),
};
const source: ValueSource = {
  get(kind, name) {
    if (kind === "tel") {
      const t = context.telemetry[name];
      return t ? { state: t.state, value: t.raw } : { state: "invalid" };
    }
    return (kind === "out" ? context.outputs : context.signals)[name] ?? { state: "invalid" };
  },
  driverActive: () => context.driverActive,
};

const TRIG = /\b(sin|cos|tan|asin|acos|atan|atan2|pow|hypot)\(/;

describe("expression fixtures", () => {
  it.each(fixture.cases)("$id", (c) => {
    const analysis = analyze(c.expr, env, c.expectedKind ?? fixture.defaultExpectedKind);
    expect(analysis.diagnostics.map(({ code, category, offset }) => ({ code, category, offset }))).toEqual(c.analysis.diagnostics);
    if (c.analysis.type) expect(analysis.type).toBe(c.analysis.type);
    if (c.analysis.dependencies) expect(analysis.dependencies).toEqual(c.analysis.dependencies);
    if (!c.result) return;
    const result = evaluate(analysis, source);
    expect(result.state).toBe(c.result.state);
    expect(result.paused).toBe(c.result.paused ?? false);
    if (c.result.runtimeDiagnostic) expect(result.diagnostic).toBe(c.result.runtimeDiagnostic);
    if (c.result.state === "invalid") return;
    const value = Array.isArray(result.value) ? canonical(result.value as TextValue) : result.value;
    if (typeof c.result.value === "number" && TRIG.test(c.expr)) {
      expect(Math.abs((value as number) - c.result.value)).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(c.result.value)));
    } else {
      expect(value).toBe(c.result.value);
    }
  });
});

describe("number formatting", () => {
  it.each([
    [1.005, 2, "1.01"], [2.675, 2, "2.68"], [0.5, 0, "1"], [-0.5, 0, "-1"], [-0.04, 1, "0.0"],
    [9.995, 2, "10.00"], [999.96, 1, "1000.0"], [1e21, 0, "1000000000000000000000"], [1.5e-7, 6, "0.000000"],
    [2.5e-7, 6, "0.000000"], [5e-7, 6, "0.000001"], [123.456, 0, "123"], [0, 3, "0.000"], [-0, 2, "0.00"],
  ])("formatDecimal(%s, %s) = %s", (x, d, expected) => {
    expect(formatDecimal(x, d)).toBe(expected);
  });

  it("localizes only number segments", () => {
    const text: TextValue = [{ text: "U: 1.5 V " }, { number: 12.345, decimals: 2 }];
    expect(canonical(text)).toBe("U: 1.5 V 12.35");
    expect(localized(text, "de")).toBe("U: 1.5 V 12,35");
    expect(localized(text, "en")).toBe("U: 1.5 V 12.35");
  });
});

describe("date formatting", () => {
  const ts = 1762611045.123; // 2025-11-08T14:10:45.123Z, a Saturday

  it("localizes names and the date separator of date segments", () => {
    const text: TextValue = [{ date: ts, format: "dddd, d. MMM yyyy, dd/MM", mode: "utc" }];
    expect(canonical(text)).toBe("Saturday, 8. Nov 2025, 08/11");
    expect(localized(text, "de")).toBe("Samstag, 8. Nov. 2025, 08.11");
  });

  it.each([
    ["d", "en", "11/08/2025"], ["d", "de", "08.11.2025"], ["G", "de", "08.11.2025 14:10:45"],
    ["D", "de", "Samstag, 8. November 2025"], ["u", "en", "2025-11-08 14:10:45Z"], ["s", "en", "2025-11-08T14:10:45"],
    ["HH:mm:ss.FFF", "en", "14:10:45.123"], ["ss.FFFFFF", "en", "45.123"], ["hh tt", "en", "02 PM"], ["yyy", "en", "2025"],
    ["%d", "en", "8"], ["zzz", "en", "+00:00"], ['"Uhr" H', "de", "Uhr 14"],
  ] as const)("formatTimestamp(%s, %s)", (format, locale, expected) => {
    expect(formatTimestamp(ts, format, "utc", locale)).toBe(expected);
  });

  it("uses the viewer's time zone for local dates", () => {
    const d = new Date(Math.round(ts * 1000));
    const pad = (n: number) => String(n).padStart(2, "0");
    expect(formatTimestamp(ts, "HH:mm", "local", "en")).toBe(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
    const off = -d.getTimezoneOffset();
    expect(formatTimestamp(ts, "K", "local", "en")).toBe(`${off < 0 ? "-" : "+"}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`);
  });

  it.each([
    [0, "hh:mm:ss", "00:00:00"], [59.9996, "ss.fff", "00.000"], [61, "m\\:ss", "1:01"], [90061.25, "dd\\.hh\\:mm\\:ss\\.ff", "01.01:01:01.25"],
    [90061, "c", "1.01:01:01"], [61.5, "G", "0:00:01:01.5000000"], [3600.1, "g", "1:00:00.1"], [-3.5, "s\\.f", "-3.5"],
    [400000, "ddd'T 'hh'h'", "004T 15h"],
  ])("formatDuration(%s, %s) = %s", (x, format, expected) => {
    expect(formatDuration(x, format)).toBe(expected);
  });
});

describe("analysis rules", () => {
  const codes = (expr: string, e: AnalysisEnv = env, kind = "any") => analyze(expr, e, kind).diagnostics.map((d) => `${d.code}@${d.offset}`);

  it("reports the first semantic error in source order before a result type error", () => {
    expect(codes('"a" + tel("nope")', env, "bool")).toEqual(["OVL_EXPR_TYPE@0"]);
    expect(codes('1 + foo(2)', env, "bool")).toEqual(["OVL_EXPR_UNKNOWN_FUNCTION@4"]);
  });

  it("rejects a LiDAR grid channel as formula value", () => {
    expect(codes('tel("grid") + 1', { telemetry: { grid: "LidarGrid" }, signals: [] })).toEqual(["OVL_EXPR_TYPE@0"]);
  });

  it("does not check sources the environment does not know", () => {
    expect(codes('tel("anything") + out("x")', { signals: [] })).toEqual([]);
    expect(codes('sig("x")', { signals: [] })).toEqual(["OVL_REF_UNKNOWN_SOURCE@0"]);
  });

  it("requires matching types for if, fallback and equality", () => {
    expect(codes('if(true, 1, "a")')).toEqual(["OVL_EXPR_TYPE@12"]);
    expect(codes("if(1, 2, 3)")).toEqual(["OVL_EXPR_TYPE@3"]);
    expect(codes('fallback(1, "x")')).toEqual(["OVL_EXPR_TYPE@12"]);
    expect(codes('1 == "1"')).toEqual(["OVL_EXPR_TYPE@5"]);
  });

  it("rejects syntax at the offending token", () => {
    expect(codes("1 2")).toEqual(["OVL_EXPR_SYNTAX@2"]);
    expect(codes("(1 + 2")).toEqual(["OVL_EXPR_SYNTAX@6"]);
    expect(codes("speed * 2")).toEqual(["OVL_EXPR_SYNTAX@0"]);
    expect(codes('"open')).toEqual(["OVL_EXPR_SYNTAX@0"]);
    expect(codes('"a\\nb"')).toEqual(["OVL_EXPR_SYNTAX@2"]);
    expect(codes("1 # 2")).toEqual(["OVL_EXPR_SYNTAX@2"]);
    expect(codes("1e999")).toEqual(["OVL_EXPR_SYNTAX@0"]);
    expect(codes("1 2 ?")).toEqual(["OVL_EXPR_SYNTAX@2"]);
    expect(codes("speed #")).toEqual(["OVL_EXPR_SYNTAX@0"]);
  });

  it("counts length in code points", () => {
    expect(codes(`"${"😀".repeat(998)}"`)).toEqual([]);
    expect(codes(`"${"😀".repeat(999)}"`)).toEqual(["OVL_LIMIT_EXCEEDED@0"]);
  });

  it("never evaluates an analysis with diagnostics", () => {
    expect(evaluate(analyze("1 +", env), source)).toEqual({ state: "invalid", paused: false, diagnostic: "OVL_EXPR_SYNTAX" });
  });
});

describe("evaluation rules", () => {
  const run = (expr: string) => evaluate(analyze(expr, env), source);

  it("keeps the paused flag only from evaluated parts", () => {
    expect(run('if(true, 1, out("steering"))').paused).toBe(false);
    expect(run('if(false, 1, out("steering"))').paused).toBe(true);
    expect(run('fallback(tel("stale"), out("steering"))')).toMatchObject({ state: "valid", paused: true, value: -0.5 });
  });

  it("implements the documented numeric functions", () => {
    const value = (expr: string) => run(expr).value;
    expect(value("mod(7, -3)")).toBe(-2);
    expect(value("mod(-7, 3)")).toBe(2);
    expect(value("wrap(-190, -180, 180)")).toBe(170);
    expect(value("wrap(180, -180, 180)")).toBe(-180);
    expect(value("round(2.5) + round(-0.4)")).toBe(3);
    expect(value("sign(-3) + sign(0)")).toBe(-1);
    expect(value("min(3, 1, 2) + max(3, 1, 2)")).toBe(4);
    expect(value("clamp(5, 0, 1)")).toBe(1);
    expect(value("deg(pi())")).toBe(180);
    expect(run("asin(2)").diagnostic).toBe("OVL_EXPR_DOMAIN");
    expect(run("map(1, 2, 2, 0, 1)").diagnostic).toBe("OVL_EXPR_DOMAIN");
    expect(run("mod(1, 0)").diagnostic).toBe("OVL_EXPR_DIV_ZERO");
    expect(run("wrap(1, 2, 2)").diagnostic).toBe("OVL_EXPR_DOMAIN");
  });

  it("compares text by canonical form", () => {
    expect(run('concat("a", format(1, 2)) == "a1.00"').value).toBe(true);
  });
});
