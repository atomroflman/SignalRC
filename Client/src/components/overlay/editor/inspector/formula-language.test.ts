// AP10 – formula editor support: lenient scan, cursor context, completion,
// diagnostics ranges and the function catalog against AP06.
import { CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { highlightCode } from "@lezer/highlight";
import { describe, expect, it } from "vitest";
import { FUNCTIONS, analyze } from "../../expression";
import { parseSourcesResponse } from "./channels";
import { FUNCTION_DOCS, signature } from "./formula-docs";
import { cursorContext, expectedAt, formulaCompletions, formulaDiagnostics, formulaHighlight, formulaLanguage, formulaSources, scan, type FormulaContext } from "./formula-language";

const dir = parseSourcesResponse({
  telemetry: [
    { id: 1, channelName: "speed", dataType: "number", unit: "km/h", decimals: 1 },
    { id: 2, channelName: "gear", dataType: "string" },
    { id: 3, channelName: "lidarGrid", dataType: "lidarGrid" },
    { id: 4, channelName: "brake", dataType: "boolean" },
  ],
  outputs: [{ id: 9, channelName: "steering" }],
});
const env = { telemetry: { speed: "Number", gear: "String", lidarGrid: "LidarGrid", brake: "Boolean" } as const, outputs: ["steering"], signals: ["rpm"] };
const ctx = (expected = "any"): FormulaContext => ({
  expected, locale: "de", sources: formulaSources(env, dir, { rpm: { label: "Drehzahl", unit: "1/min" } }),
});

/** Completion at the `|` of `text`. */
function complete(text: string, expected = "any", explicit = false): CompletionResult | null {
  const pos = text.indexOf("|");
  const doc = text.slice(0, pos) + text.slice(pos + 1);
  const state = EditorState.create({ doc, selection: { anchor: pos } });
  return formulaCompletions(() => ctx(expected))(new CompletionContext(state, pos, explicit)) as CompletionResult | null;
}
const top = (r: CompletionResult | null, n = 3) =>
  [...(r?.options ?? [])].sort((a, b) => (b.boost ?? 0) - (a.boost ?? 0)).slice(0, n).map((o) => o.displayLabel ?? o.label);

describe("formula catalog", () => {
  it("documents exactly the functions of AP06", () => {
    expect(FUNCTION_DOCS.map((f) => f.name).sort()).toEqual([...FUNCTIONS].sort());
  });

  it("documented arities pass the AP06 check", () => {
    const literal = { number: "1", bool: "true", text: "\"a\"", T: "1", name: "\"speed\"", "0–6": "2" } as const;
    for (const f of FUNCTION_DOCS) {
      const expr = `${f.name}(${f.params.map((p) => literal[p.type]).join(", ")})`;
      const codes = analyze(expr, env, "any").diagnostics.map((d) => d.code);
      expect(codes, expr).not.toContain("OVL_EXPR_ARITY");
      expect(codes, expr).not.toContain("OVL_EXPR_TYPE");
    }
  });

  it("formats signatures", () => {
    expect(signature(FUNCTION_DOCS.find((f) => f.name === "if")!)).toBe("if(bedingung: bool, dann: T, sonst: T) → T");
    expect(signature(FUNCTION_DOCS.find((f) => f.name === "min")!)).toBe("min(a: number, b: number, …) → number");
  });
});

describe("lenient scan and cursor context", () => {
  it("keeps going after errors and open texts", () => {
    expect(scan("1 # tel(\"sp").map((t) => t.type)).toEqual(["number", "bad", "ident", "op", "text"]);
    expect(scan("\"a\\\"b\"")[0]).toMatchObject({ type: "text", value: "a\"b", closed: true });
  });

  it("finds the call and argument around the cursor", () => {
    const c = cursorContext("if(tel(\"brake\"), clamp(1, ", 26);
    expect(c.frames.map((f) => [f.name, f.arg])).toEqual([["if", 1], ["clamp", 1]]);
    expect(cursorContext("tel(\"spe", 8).text?.contentFrom).toBe(5);
  });

  it("derives the wanted type", () => {
    const at = (s: string, root?: "number" | "bool" | "text") => expectedAt(cursorContext(s, s.length), root);
    expect(at("if(")).toBe("bool");
    expect(at("if(true, ", "text")).toBe("text");
    expect(at("format(1, ")).toBe("digits");
    expect(at("concat(\"a\", ")).toBe("text");
    expect(at("1 + ", "text")).toBe("number");
    expect(at("(", "bool")).toBe("bool");
  });
});

describe("completion", () => {
  it("offers every function, the literals and the sources", () => {
    const labels = complete("|", "any", true)!.options.map((o) => o.label);
    for (const f of FUNCTIONS) expect(labels).toContain(f);
    expect(labels).toEqual(expect.arrayContaining(["true", "false", "speed", "steering", "rpm"]));
    expect(labels).not.toContain("lidarGrid");
  });

  it("ranks by the type wanted at the cursor", () => {
    expect(top(complete("if(|", "any", true))).toEqual(expect.arrayContaining(["valid", "driverActive"]));
    expect(top(complete("if(|", "any", true), 6)).toContain("true");
    expect(top(complete("concat(\"a\", |", "any", true), 6)).toEqual(expect.arrayContaining(["format", "concat"]));
  });

  it("completes source names in the literal, filtered by kind", () => {
    const r = complete("tel(\"sp|\")")!;
    expect(r.from).toBe(5);
    expect(r.options.map((o) => o.label)).toEqual(["brake", "gear", "speed"]);
    const speed = r.options.find((o) => o.label === "speed")!;
    expect(speed.detail).toBe("Number · km/h · 1 Nachkommastellen");
    expect(speed.apply).toBe("speed");
    expect(complete("tel(\"sp|")!.options.find((o) => o.label === "speed")!.apply).toBe("speed\"");
    expect(complete("sig(|")!.options.map((o) => o.apply)).toEqual(["\"rpm\""]);
    expect(complete("out(\"|\")")!.options.map((o) => o.label)).toEqual(["steering"]);
  });

  it("offers the decimals of format and stays quiet after a value", () => {
    expect(complete("format(tel(\"speed\"), |")!.options.map((o) => o.label)).toEqual(["0", "1", "2", "3", "4", "5", "6"]);
    expect(complete("1|")).toBeNull();
    expect(complete("\"a|\"")).toBeNull();
  });
});

describe("diagnostic ranges", () => {
  it("covers the token at the AP06 offset", () => {
    const text = "1 + foo(2)";
    const d = analyze(text, env, "number").diagnostics[0];
    expect(formulaDiagnostics(text, d)).toEqual([{ from: 4, to: 7, severity: "warning", message: `OVL_EXPR_UNKNOWN_FUNCTION: ${d.message}` }]);
  });

  it("marks the whole formula for the result type and nothing for an empty one", () => {
    const text = "tel(\"gear\")";
    expect(formulaDiagnostics(text, analyze(text, env, "number").diagnostics[0])[0]).toMatchObject({ from: 0, to: text.length });
    expect(formulaDiagnostics("", analyze("", env, "number").diagnostics[0])).toEqual([]);
  });

  it("puts a missing operand at the end", () => {
    const text = "tel(\"speed\") *";
    expect(formulaDiagnostics(text, analyze(text, env, "number").diagnostics[0])[0]).toMatchObject({ from: text.length, to: text.length });
  });
});

describe("highlighting", () => {
  /** Highlight class at every offset. */
  function classes(text: string): string[] {
    const out: string[] = [];
    highlightCode(text, formulaLanguage.parser.parse(text), formulaHighlight, (t, cls) => { for (const _ of t) out.push(cls); }, () => out.push(""));
    return out;
  }

  it("tells control, sources, functions, names, literals and errors apart", () => {
    const text = "if(valid(tel(\"speed\")), format(1.5, 2), \"a\\\"\") && true || x";
    const c = classes(text);
    const at = (t: string, from = 0) => c[text.indexOf(t, from)];
    expect(at("if")).toBe(at("valid"));
    expect(at("tel")).not.toBe(at("format"));
    expect(at("tel")).not.toBe(at("if"));
    expect(at("speed")).not.toBe(at("a\\"));
    expect(at("\\")).not.toBe(at("a\\"));
    expect(at("1.5")).not.toBe("");
    expect(at("true")).not.toBe(at("1.5"));
    expect(at("x")).not.toBe(at("format"));
    expect(at("x")).not.toBe("");
  });
});
