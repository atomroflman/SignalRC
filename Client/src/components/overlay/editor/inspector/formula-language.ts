// AP10 – editor support for the expression language (expression §1, §5):
// highlighting, context completion, signature help and hover in CodeMirror.
// The check itself stays with AP06 (checkFormula); this module only reads the
// text leniently so that it also helps in unfinished formulas.
import { autocompletion, closeBrackets, closeBracketsKeymap, snippet, startCompletion, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, insertNewline } from "@codemirror/commands";
import { bracketMatching, HighlightStyle, StreamLanguage, syntaxHighlighting, type StringStream } from "@codemirror/language";
import { type Diagnostic } from "@codemirror/lint";
import { StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { EditorView, hoverTooltip, keymap, showTooltip, tooltips, type Tooltip } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { fieldTheme } from "../../../codemirror/field-theme";
import type { SignalDefinition } from "../../document/types";
import { FUNCTIONS, requiredType, type AnalysisEnv, type ExprDiagnostic, type ExprType } from "../../expression";
import type { Locale } from "../../runtime/types";
import type { ChannelDirectory } from "./channels";
import { FUNCTION_DOC, FUNCTION_DOCS, formulaTexts, LITERAL_DOCS, type FunctionDoc } from "./formula-docs";

// ---------------------------------------------------------------------------
// Lenient scan and cursor context

export interface ScanToken {
  type: "number" | "text" | "ident" | "op" | "bad";
  from: number;
  to: number;
  /** Identifier, operator or the unescaped text content. */
  value: string;
  /** Text literals: closing quote present. */
  closed?: boolean;
}

const OPERATORS = ["&&", "||", "==", "!=", "<=", ">=", "+", "-", "*", "/", "!", "<", ">", "(", ")", ","];
const NUMBER = /[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?/y;
const IDENT = /[A-Za-z_][A-Za-z0-9_]*/y;

/** Tokens like the AP06 lexer, but never stops: errors become `bad` tokens, open texts end at the line end. */
export function scan(text: string): ScanToken[] {
  const tokens: ScanToken[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (" \t\r\n".includes(c)) { i++; continue; }
    const from = i;
    if (c >= "0" && c <= "9") {
      NUMBER.lastIndex = i;
      const t = NUMBER.exec(text)![0];
      i += t.length;
      tokens.push({ type: "number", from, to: i, value: t });
    } else if (c === '"') {
      let value = "";
      let closed = false;
      i++;
      while (i < text.length && text[i] !== "\n" && text[i] !== "\r") {
        if (text[i] === '"') { closed = true; i++; break; }
        if (text[i] === "\\" && i + 1 < text.length) { value += text[i + 1]; i += 2; } else value += text[i++];
      }
      tokens.push({ type: "text", from, to: i, value, closed });
    } else if (/[A-Za-z_]/.test(c)) {
      IDENT.lastIndex = i;
      const t = IDENT.exec(text)![0];
      i += t.length;
      tokens.push({ type: "ident", from, to: i, value: t });
    } else {
      const op = OPERATORS.find((o) => text.startsWith(o, i)) ?? "";
      i += op ? op.length : 1;
      tokens.push({ type: op ? "op" : "bad", from, to: i, value: op || c });
    }
  }
  return tokens;
}

/** An open parenthesis before the cursor: a call (`name`) or a group. */
export interface Frame {
  name?: string;
  /** Offset of the `(`. */
  open: number;
  /** Index of the argument the cursor is in. */
  arg: number;
}

export interface CursorContext {
  frames: Frame[];
  /** Last complete token before the cursor. */
  prev?: ScanToken;
  /** Text literal the cursor is in (between its quotes). */
  text?: { token: ScanToken; contentFrom: number; contentTo: number };
}

export function cursorContext(source: string, pos: number): CursorContext {
  const frames: Frame[] = [];
  let prev: ScanToken | undefined;
  for (const tok of scan(source)) {
    if (tok.from >= pos) break;
    if (tok.type === "text") {
      const contentTo = tok.closed ? tok.to - 1 : tok.to;
      if (pos <= contentTo) return { frames, prev, text: { token: tok, contentFrom: tok.from + 1, contentTo } };
    }
    if (tok.to > pos) break;
    if (tok.type === "op") {
      if (tok.value === "(") frames.push({ name: prev?.type === "ident" ? prev.value : undefined, open: tok.from, arg: 0 });
      else if (tok.value === ")") frames.pop();
      else if (tok.value === "," && frames.length > 0) frames[frames.length - 1].arg++;
    }
    prev = tok;
  }
  return { frames, prev };
}

const SOURCE_FUNCTIONS = new Set(["tel", "out", "sig"]);
const CONTROL_FUNCTIONS = new Set(["if", "valid", "fallback"]);
type SourceKind = "tel" | "out" | "sig";

/** Innermost call around the cursor (groups skipped). */
export function innermostCall(ctx: CursorContext): Frame | undefined {
  for (let i = ctx.frames.length - 1; i >= 0; i--) if (ctx.frames[i].name) return ctx.frames[i];
  return undefined;
}

/** The source call whose name argument the cursor is in, e.g. `tel(|` or `tel("sp|`. */
function sourceCall(ctx: CursorContext): SourceKind | undefined {
  const top = ctx.frames[ctx.frames.length - 1];
  if (!top?.name || !SOURCE_FUNCTIONS.has(top.name) || top.arg !== 0) return undefined;
  return top.name as SourceKind;
}

export type Expected = ExprType | "digits" | undefined;

/**
 * Type wanted at the cursor, from the operator before it or the parameter of
 * the enclosing call; `if`/`fallback` branches and groups pass the outer type
 * through. Undefined = any. Used to rank completions, never to filter.
 */
export function expectedAt(ctx: CursorContext, root: ExprType | undefined): Expected {
  const p = ctx.prev;
  if (p?.type === "op") {
    if (["+", "-", "*", "/", "<", "<=", ">", ">="].includes(p.value)) return "number";
    if (["&&", "||", "!"].includes(p.value)) return "bool";
    if (p.value === "==" || p.value === "!=") return undefined;
  }
  for (let i = ctx.frames.length - 1; i >= 0; i--) {
    const f = ctx.frames[i];
    if (!f.name) continue;
    const doc = FUNCTION_DOC.get(f.name);
    if (!doc) return undefined;
    if (f.name === "if" && f.arg === 0) return "bool";
    if (f.name === "if" || f.name === "fallback") continue;
    const param = doc.variadic ? doc.params[Math.min(f.arg, doc.params.length - 1)] : doc.params[f.arg];
    if (!param || param.type === "T" || param.type === "name") return undefined;
    return param.type === "0–6" ? "digits" : param.type;
  }
  return root;
}

// ---------------------------------------------------------------------------
// Sources and editor context

export interface SourceEntry {
  kind: SourceKind;
  name: string;
  type: ExprType;
  dataType?: string;
  unit?: string | null;
  decimals?: number | null;
  label?: string;
}

const telemetryType = (t: string): ExprType =>
  t === "Integer" || t === "Number" ? "number" : t === "Boolean" ? "bool" : t === "String" ? "text" : "unknown";

/** Everything tel()/out()/sig() can name; metadata from the directory where known. LiDAR grids are no formula values. */
export function formulaSources(env: AnalysisEnv, dir?: ChannelDirectory, signals?: Record<string, SignalDefinition>): SourceEntry[] {
  const out: SourceEntry[] = [];
  if (dir?.telemetry) {
    for (const c of dir.telemetry) {
      if (c.dataType !== "LidarGrid") out.push({ kind: "tel", name: c.name, type: telemetryType(c.dataType), dataType: c.dataType, unit: c.unit, decimals: c.decimals });
    }
  } else {
    for (const [name, t] of Object.entries(env.telemetry ?? {})) {
      if (t !== "LidarGrid") out.push({ kind: "tel", name, type: telemetryType(t), dataType: t });
    }
  }
  for (const name of env.outputs ?? []) out.push({ kind: "out", name, type: "number" });
  for (const name of env.signals) {
    const s = signals?.[name];
    out.push({ kind: "sig", name, type: "number", unit: s?.unit, decimals: s?.decimals, label: s?.label });
  }
  return out;
}

export interface FormulaContext {
  /** Expected result kind of the field (property kind, "bool", "number"). */
  expected: string;
  locale: Locale;
  sources: SourceEntry[];
}

const quote = (name: string) => `"${name.replace(/[\\"]/g, (c) => `\\${c}`)}"`;

function sourceDetail(s: SourceEntry, locale: Locale): string {
  const parts = [s.dataType ?? s.type];
  if (s.unit) parts.push(s.unit);
  if (s.decimals !== undefined && s.decimals !== null) parts.push(`${s.decimals} ${formulaTexts[locale].decimals}`);
  if (s.label) parts.unshift(s.label);
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Completion

const fits = (result: string, expected: Expected) =>
  expected === undefined || expected === "digits" || result === "T" || result === "unknown" ? 0 : result === expected ? 1 : -1;

function infoNode(f: FunctionDoc, locale: Locale, active?: number): HTMLElement {
  const dom = document.createElement("div");
  dom.className = "cm-doc";
  const sig = dom.appendChild(document.createElement("div"));
  sig.className = "cm-doc-sig";
  sig.append(`${f.name}(`);
  f.params.forEach((p, i) => {
    if (i > 0) sig.append(", ");
    const span = sig.appendChild(document.createElement("span"));
    span.textContent = `${p.name}: ${p.type}`;
    const last = i === f.params.length - 1;
    if (active !== undefined && (active === i || (f.variadic && last && active > i))) span.className = "cm-doc-active";
  });
  sig.append(`${f.variadic ? ", …" : ""}) → ${f.result}`);
  dom.appendChild(document.createElement("div")).textContent = f.doc[locale];
  return dom;
}

function textNode(title: string, body?: string): HTMLElement {
  const dom = document.createElement("div");
  dom.className = "cm-doc";
  const head = dom.appendChild(document.createElement("div"));
  head.className = "cm-doc-sig";
  head.textContent = title;
  if (body) dom.appendChild(document.createElement("div")).textContent = body;
  return dom;
}

function functionCompletion(f: FunctionDoc, c: FormulaContext, expected: Expected): Completion {
  const source = f.group === "source" && f.params.length > 0;
  const template = source ? `${f.name}("\${}")` : `${f.name}(${f.params.map((p) => `\${${p.name}}`).join(", ")})`;
  const insert = snippet(template);
  const boost = fits(f.result, expected);
  return {
    label: f.name,
    type: CONTROL_FUNCTIONS.has(f.name) ? "keyword" : f.group === "source" ? "variable" : "function",
    detail: `→ ${f.result}`,
    info: () => infoNode(f, c.locale),
    boost: boost * 2 + (CONTROL_FUNCTIONS.has(f.name) || f.group === "source" ? 1 : 0),
    apply: (view, completion, from, to) => {
      insert(view, completion, from, to);
      if (source) startCompletion(view);
    },
  };
}

function sourceCompletions(c: FormulaContext, kind: SourceKind | undefined, expected: Expected, wrap: (s: SourceEntry) => string, display: (s: SourceEntry) => string): Completion[] {
  return c.sources.filter((s) => !kind || s.kind === kind).map((s) => ({
    label: s.name,
    displayLabel: display(s),
    detail: sourceDetail(s, c.locale),
    type: "variable",
    boost: fits(s.type, expected) * 2,
    apply: wrap(s),
  }));
}

export function formulaCompletions(context: () => FormulaContext) {
  return (cx: CompletionContext): CompletionResult | null => {
    const c = context();
    const text = cx.state.doc.toString();
    const root = requiredType(c.expected);
    const here = cursorContext(text, cx.pos);

    // Inside the name literal of tel/out/sig: the names of that kind.
    if (here.text) {
      const kind = sourceCall(here);
      if (!kind) return null;
      const { contentFrom, contentTo, token } = here.text;
      const outer = expectedAt({ frames: here.frames.slice(0, -1), prev: undefined }, root);
      return {
        from: contentFrom,
        to: contentTo,
        options: sourceCompletions(c, kind, outer, (s) => quote(s.name).slice(1, token.closed ? -1 : undefined), (s) => s.name),
        validFor: /^[^"\\]*$/,
      };
    }

    const word = cx.matchBefore(/[A-Za-z_][A-Za-z0-9_]*/);
    const from = word?.from ?? cx.pos;
    const at = word ? cursorContext(text, word.from) : here;
    const kind = sourceCall(at);
    if (kind) {
      // `tel(|`: the names with quotes.
      if (!word && !cx.explicit && at.prev?.value !== "(") return null;
      const outer = expectedAt({ frames: at.frames.slice(0, -1), prev: undefined }, root);
      return { from, options: sourceCompletions(c, kind, outer, (s) => quote(s.name), (s) => quote(s.name)) };
    }

    const expected = expectedAt(at, root);
    if (expected === "digits") {
      const digits = cx.matchBefore(/[0-9]*/);
      if (!cx.explicit && at.prev?.value !== ",") return null;
      return { from: digits?.from ?? cx.pos, options: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ label: String(d), type: "constant" })) };
    }
    if (!word && !cx.explicit) return null;
    if (at.prev?.type === "number" || at.prev?.type === "text" || (at.prev?.type === "op" && at.prev.value === ")")) {
      if (!cx.explicit) return null;
    }

    const options: Completion[] = FUNCTION_DOCS.map((f) => functionCompletion(f, c, expected));
    for (const v of ["true", "false"] as const) {
      options.push({ label: v, type: "constant", detail: "bool", info: LITERAL_DOCS[v][c.locale], boost: fits("bool", expected) * 2 });
    }
    options.push(...sourceCompletions(c, undefined, expected, (s) => `${s.kind}(${quote(s.name)})`, (s) => `${s.kind}(${quote(s.name)})`)
      .map((o) => ({ ...o, boost: (o.boost ?? 0) - 1 })));
    return { from, options, validFor: /^[A-Za-z_][A-Za-z0-9_]*$/ };
  };
}

// ---------------------------------------------------------------------------
// Signature help and hover

const setFocus = StateEffect.define<boolean>();

function signatureHelp(context: () => FormulaContext): Extension {
  const tooltipAt = (state: EditorState, focused: boolean): Tooltip | null => {
    if (!focused || !state.selection.main.empty) return null;
    const ctx = cursorContext(state.doc.toString(), state.selection.main.head);
    const call = innermostCall(ctx);
    const doc = call?.name ? FUNCTION_DOC.get(call.name) : undefined;
    if (!call || !doc || doc.params.length === 0) return null;
    return { pos: call.open, above: true, create: () => ({ dom: infoNode(doc, context().locale, call.arg) }) };
  };
  const field = StateField.define<{ focused: boolean; tooltip: Tooltip | null }>({
    create: (state) => ({ focused: false, tooltip: tooltipAt(state, false) }),
    update(value, tr) {
      let focused = value.focused;
      for (const e of tr.effects) if (e.is(setFocus)) focused = e.value;
      if (focused === value.focused && !tr.docChanged && !tr.selection) return value;
      return { focused, tooltip: tooltipAt(tr.state, focused) };
    },
    provide: (f) => showTooltip.from(f, (v) => v.tooltip),
  });
  return [field, EditorView.focusChangeEffect.of((_state, focusing) => setFocus.of(focusing))];
}

function sourceOf(tokens: ScanToken[], i: number): SourceKind | undefined {
  const open = tokens[i - 1];
  const name = tokens[i - 2];
  if (open?.type !== "op" || open.value !== "(" || name?.type !== "ident" || !SOURCE_FUNCTIONS.has(name.value)) return undefined;
  return name.value as SourceKind;
}

function formulaHover(context: () => FormulaContext): Extension {
  return hoverTooltip((view, pos) => {
    const tokens = scan(view.state.doc.toString());
    const i = tokens.findIndex((t) => t.from <= pos && pos <= t.to && (t.type === "ident" || t.type === "text"));
    if (i < 0) return null;
    const tok = tokens[i];
    const c = context();
    let dom: (() => HTMLElement) | undefined;
    if (tok.type === "ident") {
      const f = FUNCTION_DOC.get(tok.value);
      if (f) dom = () => infoNode(f, c.locale);
      else if (tok.value === "true" || tok.value === "false") dom = () => textNode(`${tok.value}: bool`, LITERAL_DOCS[tok.value as "true" | "false"][c.locale]);
    } else {
      const kind = sourceOf(tokens, i);
      if (kind) {
        const s = c.sources.find((e) => e.kind === kind && e.name === tok.value);
        dom = () => textNode(`${kind}(${quote(tok.value)})${s ? `: ${s.type}` : ""}`, s ? sourceDetail(s, c.locale) : formulaTexts[c.locale].unknownSource);
      }
    }
    if (!dom) return null;
    const create = dom;
    return { pos: tok.from, end: tok.to, above: true, create: () => ({ dom: create() }) };
  });
}

// ---------------------------------------------------------------------------
// Highlighting

interface HighlightState { str: boolean; srcStr: boolean; pending: 0 | 1 | 2 }

export const formulaLanguage = StreamLanguage.define<HighlightState>({
  name: "overlay-formula",
  startState: () => ({ str: false, srcStr: false, pending: 0 }),
  token(stream: StringStream, st: HighlightState): string | null {
    if (stream.sol()) st.str = false;
    if (st.str) {
      const name = st.srcStr ? "sourceName" : "string";
      if (stream.match(/^\\["\\]/)) return "escape";
      if (stream.match(/^\\./)) return "invalid";
      if (stream.eat('"')) { st.str = false; return name; }
      stream.match(/^[^"\\]+/);
      return name;
    }
    if (stream.eatSpace()) return null;
    const pending = st.pending;
    st.pending = 0;
    if (stream.eat('"')) {
      st.str = true;
      st.srcStr = pending === 2;
      return st.srcStr ? "sourceName" : "string";
    }
    if (stream.match(/^[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?/)) return "number";
    const id = stream.match(/^[A-Za-z_][A-Za-z0-9_]*/) as RegExpMatchArray | null;
    if (id) {
      const w = id[0];
      if (w === "true" || w === "false") return "bool";
      if (SOURCE_FUNCTIONS.has(w)) { st.pending = 1; return "source"; }
      if (w === "driverActive") return "source";
      if (CONTROL_FUNCTIONS.has(w)) return "control";
      return FUNCTIONS.has(w) ? "function" : "invalid";
    }
    if (stream.match(/^(&&|\|\||==|!=|<=|>=|[-+*/!<>])/)) return "operator";
    if (stream.eat("(")) { if (pending === 1) st.pending = 2; return "paren"; }
    if (stream.eat(")")) return "paren";
    if (stream.eat(",")) return "separator";
    stream.next();
    return "invalid";
  },
  tokenTable: {
    control: tags.controlKeyword,
    source: tags.standard(tags.function(tags.variableName)),
    function: tags.function(tags.variableName),
    sourceName: tags.special(tags.string),
    escape: tags.escape,
    bool: tags.bool,
    paren: tags.paren,
    separator: tags.separator,
    invalid: tags.invalid,
  },
});

export const formulaHighlight = HighlightStyle.define([
  { tag: tags.number, color: "#fcd34d" },
  { tag: tags.string, color: "#86efac" },
  { tag: tags.special(tags.string), color: "#7dd3fc" },
  { tag: tags.escape, color: "#fdba74" },
  { tag: tags.bool, color: "#c4b5fd" },
  { tag: tags.controlKeyword, color: "#f472b6", fontWeight: "bold" },
  { tag: tags.standard(tags.function(tags.variableName)), color: "#38bdf8", fontWeight: "bold" },
  { tag: tags.function(tags.variableName), color: "#93c5fd" },
  { tag: tags.operator, color: "#e4e4e7" },
  { tag: [tags.paren, tags.separator], color: "#a1a1aa" },
  { tag: tags.invalid, color: "#f87171", textDecoration: "underline wavy" },
]);


// ---------------------------------------------------------------------------
// Diagnostics and the extension bundle

/**
 * The AP06 diagnostic as a lint range: from its offset over the token there.
 * Result type and limits sit at offset 0 and concern the whole formula.
 */
export function formulaDiagnostics(text: string, d: ExprDiagnostic | undefined): Diagnostic[] {
  if (!d || d.code === "OVL_EXPR_EMPTY") return [];
  const severity = d.category === "structure" ? "error" : "warning";
  const message = `${d.code}: ${d.message}`;
  if (d.offset === 0 && (d.code === "OVL_EXPR_RESULT_TYPE" || d.code === "OVL_LIMIT_EXCEEDED")) {
    return [{ from: 0, to: text.length, severity, message }];
  }
  const from = Math.min(d.offset, text.length);
  const tok = scan(text).find((t) => t.from === from);
  let to = tok ? tok.to : Math.min(from + 1, text.length);
  // A call's diagnostic covers the call name only.
  if (tok?.type === "ident") to = tok.to;
  return [{ from, to, severity, message }];
}

export interface FormulaEditorHooks {
  context(): FormulaContext;
  onChange(text: string): void;
  /** Enter or blur. */
  onCommit(text: string): void;
  /** Escape. */
  onRevert(): void;
}

/** Everything a formula input needs, in the browser only (tooltips live in document.body to escape the panel). */
export function formulaExtensions(hooks: FormulaEditorHooks): Extension {
  const text = (view: EditorView) => view.state.doc.toString();
  return [
    formulaLanguage,
    syntaxHighlighting(formulaHighlight),
    fieldTheme,
    EditorView.lineWrapping,
    history(),
    bracketMatching(),
    closeBrackets(),
    autocompletion({ override: [formulaCompletions(hooks.context)], icons: true, activateOnTyping: true }),
    signatureHelp(hooks.context),
    formulaHover(hooks.context),
    tooltips({ parent: document.body }),
    keymap.of([
      { key: "Enter", run: (view) => { hooks.onCommit(text(view)); return true; } },
      { key: "Shift-Enter", run: insertNewline },
      { key: "Escape", run: () => { hooks.onRevert(); return true; } },
      ...closeBracketsKeymap,
      ...historyKeymap,
      ...defaultKeymap,
    ]),
    EditorView.updateListener.of((u) => { if (u.docChanged) hooks.onChange(text(u.view)); }),
    EditorView.domEventHandlers({
      // The canvas must not see keys typed into a formula.
      keydown: (e) => { e.stopPropagation(); return false; },
      blur: (_e, view) => { hooks.onCommit(text(view)); return false; },
    }),
  ];
}
