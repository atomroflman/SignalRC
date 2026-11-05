// Editor support for the "options" JSON of pin managers, control, telemetry and
// video channels: completion of keys and values, hover docs and checks against
// the option schema the vehicle reports (GET channels/option-schemas, built
// from the onboard types by OptionSchemaBuilder). Without a schema it is a
// plain JSON editor with syntax check.
import { autocompletion, closeBrackets, closeBracketsKeymap, startCompletion, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { json, jsonParseLinter } from "@codemirror/lang-json";
import { bracketMatching, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { linter, type Diagnostic } from "@codemirror/lint";
import { EditorView, hoverTooltip, keymap, tooltips } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { tags } from "@lezer/highlight";
import { fieldTheme } from "../codemirror/field-theme";

export type SchemaKind = "pinManager" | "control" | "telemetry" | "video";

export interface OptionSchema {
  name: string;
  type: "string" | "integer" | "number" | "boolean" | "array" | "object";
  itemType?: string | null;
  values?: string[] | null;
  defaultJson?: string | null;
  description?: string | null;
  reference?: string | null;
}

export interface ChannelTypeSchema {
  kind: SchemaKind;
  typeName: string;
  description?: string | null;
  options: OptionSchema[];
  /** Telemetry readers: suggested data type, unit and decimals per value key. */
  values?: TelemetryValueHint[] | null;
}

/** What a telemetry reader delivers for one value key (onboard TelemetryValueAttribute). */
export interface TelemetryValueHint {
  /** Value key; empty for a reader with a single value. */
  key: string;
  /** TelemetryDataType as number or name. */
  dataType: number | string;
  unit?: string | null;
  decimals?: number | null;
  /** Only when an option has this value, "option=Value"; null = the default. */
  when?: string | null;
}

export interface OptionSchemas {
  pinManagerTypes: string[];
  schemas: ChannelTypeSchema[];
  /** /proc/device-tree/model of the vehicle, e.g. "Raspberry Pi 5 Model B Rev 1.0"; null when unknown. */
  boardModel: string | null;
}

export function parseOptionSchemas(raw: unknown): OptionSchemas {
  const r = (raw ?? {}) as Partial<OptionSchemas>;
  return {
    pinManagerTypes: Array.isArray(r.pinManagerTypes) ? r.pinManagerTypes.filter((t) => typeof t === "string") : [],
    schemas: Array.isArray(r.schemas) ? r.schemas.filter((s) => s && typeof s.typeName === "string" && Array.isArray(s.options)) : [],
    boardModel: typeof r.boardModel === "string" && r.boardModel.trim() ? r.boardModel : null,
  };
}

const shortName = (name: string) => name.slice(name.lastIndexOf(".") + 1).toLowerCase();

/**
 * The schema of a configured type: exact name first, then ignoring case; telemetry
 * readers also by their class name without namespace.
 */
export function findSchema(schemas: ChannelTypeSchema[], kind: SchemaKind, typeName: string | null | undefined): ChannelTypeSchema | undefined {
  const name = (typeName ?? "").trim();
  if (!name) return undefined;
  const list = schemas.filter((s) => s.kind === kind);
  return list.find((s) => s.typeName === name)
    ?? list.find((s) => s.typeName.toLowerCase() === name.toLowerCase())
    ?? (kind === "telemetry" ? list.find((s) => shortName(s.typeName) === shortName(name)) : undefined);
}

export interface OptionsContext {
  schema?: ChannelTypeSchema;
  /** Names of the configured pin managers, for options that reference one. */
  pinManagers: string[];
}

// ---------------------------------------------------------------------------
// Lenient JSON scan

export interface JsonToken {
  type: "string" | "number" | "word" | "punct" | "bad";
  from: number;
  to: number;
  /** Punctuation, word or number text; the decoded content of strings. */
  value: string;
  closed?: boolean;
}

export function scanJson(text: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (" \t\r\n".includes(c)) { i++; continue; }
    const from = i;
    if (c === '"') {
      let closed = false;
      i++;
      while (i < text.length && text[i] !== "\n") {
        if (text[i] === "\\") { i += 2; continue; }
        if (text[i] === '"') { closed = true; i++; break; }
        i++;
      }
      i = Math.min(i, text.length);
      const raw = text.slice(from, i);
      let value = raw.slice(1, closed ? -1 : undefined);
      if (closed) try { value = JSON.parse(raw); } catch { /* keep the raw content */ }
      tokens.push({ type: "string", from, to: i, value, closed });
    } else if ("{}[]:,".includes(c)) {
      tokens.push({ type: "punct", from, to: ++i, value: c });
    } else if (/[-0-9]/.test(c)) {
      const m = /^-?[0-9]*(\.[0-9]*)?([eE][+-]?[0-9]*)?/.exec(text.slice(i))!;
      i += Math.max(1, m[0].length);
      tokens.push({ type: "number", from, to: i, value: text.slice(from, i) });
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i))!;
      i += m[0].length;
      tokens.push({ type: "word", from, to: i, value: m[0] });
    } else {
      tokens.push({ type: "bad", from, to: ++i, value: c });
    }
  }
  return tokens;
}

interface Frame {
  kind: "object" | "array";
  /** Object: what comes next. */
  state: "key" | "colon" | "value" | "comma";
  key?: string;
}

function step(frames: Frame[], tok: JsonToken): void {
  const top = frames[frames.length - 1];
  const valueDone = () => { if (top) top.state = "comma"; };
  if (tok.type === "punct") {
    switch (tok.value) {
      case "{": valueDone(); frames.push({ kind: "object", state: "key" }); return;
      case "[": valueDone(); frames.push({ kind: "array", state: "value" }); return;
      case "}": case "]": frames.pop(); return;
      case ":": if (top?.kind === "object" && top.state === "colon") top.state = "value"; return;
      case ",": if (top) top.state = top.kind === "object" ? "key" : "value"; return;
    }
  }
  if (!top) return;
  if (top.kind === "object" && top.state === "key" && tok.type === "string") {
    top.key = tok.value;
    top.state = "colon";
    return;
  }
  valueDone();
}

export interface JsonContext {
  frames: Frame[];
  /** The string the cursor is in, and whether it sits where a key goes. */
  string?: { token: JsonToken; key: boolean };
  /** A bare word or number being typed up to the cursor. */
  partial?: JsonToken;
  /** The significant token after the cursor. */
  next?: JsonToken;
  tokens: JsonToken[];
}

export function jsonContext(text: string, pos: number): JsonContext {
  const tokens = scanJson(text);
  const frames: Frame[] = [];
  const at: JsonContext = { frames, tokens };
  for (const tok of tokens) {
    if (tok.from >= pos) { at.next = tok; break; }
    const top = frames[frames.length - 1];
    if (tok.type === "string" && pos < tok.to + (tok.closed ? 0 : 1) && pos > tok.from) {
      at.string = { token: tok, key: top?.kind === "object" && top.state === "key" };
      at.next = tokens[tokens.indexOf(tok) + 1];
      return at;
    }
    if ((tok.type === "word" || tok.type === "number") && tok.to === pos) {
      at.partial = tok;
      at.next = tokens[tokens.indexOf(tok) + 1];
      return at;
    }
    step(frames, tok);
  }
  return at;
}

export interface TopLevelProperty {
  key: string;
  keyFrom: number;
  keyTo: number;
  /** Value range; undefined while the value is missing. */
  valueFrom?: number;
  valueTo?: number;
}

/** The properties of the root object, with ranges for diagnostics and hover. */
export function topLevelProperties(text: string): TopLevelProperty[] {
  const out: TopLevelProperty[] = [];
  const frames: Frame[] = [];
  let current: TopLevelProperty | undefined;
  for (const tok of scanJson(text)) {
    const top = frames[0];
    if (frames.length === 1 && top.kind === "object" && top.state === "key" && tok.type === "string") {
      current = { key: tok.value, keyFrom: tok.from, keyTo: tok.to };
      out.push(current);
    } else if (frames.length === 1 && current && top.state === "value") {
      current.valueFrom = tok.from;
      current.valueTo = tok.to;
    } else if (frames.length > 1 && current?.valueFrom !== undefined) {
      // Inside a nested value, up to and including its closing bracket.
      current.valueTo = tok.to;
    }
    step(frames, tok);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Checks

const typeOf = (v: unknown): string =>
  v === null ? "null" : Array.isArray(v) ? "array" : typeof v === "number" ? (Number.isInteger(v) ? "integer" : "number") : typeof v;

function fitsType(o: OptionSchema, v: unknown): boolean {
  const t = typeOf(v);
  if (t === "null") return true;
  if (o.type === "number") return t === "number" || t === "integer";
  if (o.type === "array") return t === "array" && (!o.itemType || (v as unknown[]).every((i) => fitsType({ ...o, type: o.itemType as OptionSchema["type"], itemType: null, values: null }, i)));
  return t === o.type;
}

const findOption = (schema: ChannelTypeSchema | undefined, key: string) =>
  schema?.options.find((o) => o.name === key) ?? schema?.options.find((o) => o.name.toLowerCase() === key.toLowerCase());

/**
 * Checks of parseable options against the schema: root must be an object; unknown
 * keys, wrong types, unknown enum values, missing pin managers and duplicates are
 * warnings (the onboard skips or logs them).
 */
export function optionDiagnostics(text: string, ctx: OptionsContext): Diagnostic[] {
  if (!text.trim()) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return []; }
  if (typeOf(parsed) !== "object") {
    return [{ from: 0, to: text.length, severity: "error", message: "Options must be a JSON object, e.g. {\"key\": 1}." }];
  }
  const out: Diagnostic[] = [];
  const seen = new Set<string>();
  const { schema } = ctx;
  for (const p of topLevelProperties(text)) {
    const key = p.key.toLowerCase();
    if (seen.has(key)) out.push({ from: p.keyFrom, to: p.keyTo, severity: "warning", message: `"${p.key}" is set twice; the last one wins.` });
    seen.add(key);
    if (!schema) continue;
    const o = findOption(schema, p.key);
    if (!o) {
      out.push({ from: p.keyFrom, to: p.keyTo, severity: "warning", message: `${schema.typeName} has no option "${p.key}"; the vehicle ignores it.` });
      continue;
    }
    if (p.valueFrom === undefined || p.valueTo === undefined) continue;
    let value: unknown;
    try { value = JSON.parse(text.slice(p.valueFrom, p.valueTo)); } catch { continue; }
    const range = { from: p.valueFrom, to: p.valueTo };
    if (!fitsType(o, value)) {
      out.push({ ...range, severity: "warning", message: `${o.name} expects ${o.type}${o.itemType ? ` of ${o.itemType}` : ""}, found ${typeOf(value)}.` });
    } else if (o.values?.length && typeof value === "string" && !o.values.some((v) => v.toLowerCase() === value.toLowerCase())) {
      out.push({ ...range, severity: "warning", message: `${o.name}: "${value}" is none of ${o.values.join(", ")}.` });
    } else if (o.reference === "pinManager" && typeof value === "string" && ctx.pinManagers.length > 0 && !ctx.pinManagers.includes(value)) {
      out.push({ ...range, severity: "warning", message: `No pin manager named "${value}" (configured: ${ctx.pinManagers.join(", ")}).` });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Completion

const placeholder = (o: OptionSchema) =>
  o.defaultJson ?? (o.type === "string" ? '""' : o.type === "boolean" ? "false" : o.type === "array" ? "[]" : o.type === "object" ? "{}" : "0");

/** Default, type and description of an option, as one line of detail. */
export function optionDetail(o: OptionSchema): string {
  return `${o.type}${o.itemType ? `<${o.itemType}>` : ""}${o.defaultJson !== undefined && o.defaultJson !== null ? ` = ${o.defaultJson}` : ""}`;
}

function docNode(title: string, body?: string | null): HTMLElement {
  const dom = document.createElement("div");
  dom.className = "cm-doc";
  const head = dom.appendChild(document.createElement("div"));
  head.className = "cm-doc-sig";
  head.textContent = title;
  if (body) dom.appendChild(document.createElement("div")).textContent = body;
  return dom;
}

const wantsValueCompletion = (o: OptionSchema) => !!o.values?.length || o.type === "boolean" || o.reference === "pinManager";

function valueOptions(o: OptionSchema, ctx: OptionsContext): Completion[] {
  const out: Completion[] = [];
  const add = (label: string, detail?: string, boost = 0) => { if (!out.some((c) => c.label === label)) out.push({ label, detail, type: "constant", boost }); };
  if (o.defaultJson) add(o.defaultJson, "default", 1);
  for (const v of o.values ?? []) add(JSON.stringify(v));
  if (o.type === "boolean") { add("true"); add("false"); }
  if (o.reference === "pinManager") for (const n of ctx.pinManagers) add(JSON.stringify(n), "pin manager");
  return out;
}

export function optionCompletions(context: () => OptionsContext) {
  return (cx: CompletionContext): CompletionResult | null => {
    const ctx = context();
    const options = ctx.schema?.options ?? [];
    if (options.length === 0) return null;
    const text = cx.state.doc.toString();
    const at = jsonContext(text, cx.pos);
    const depth = at.frames.length;
    const top = at.frames[depth - 1];

    // Value of a root option.
    if (depth === 1 && top.kind === "object" && (top.state === "value" || (at.string && !at.string.key))) {
      const o = top.key !== undefined ? findOption(ctx.schema, top.key) : undefined;
      if (!o) return null;
      const from = at.string?.token.from ?? at.partial?.from ?? cx.pos;
      if (!cx.explicit && !at.string && !at.partial && !wantsValueCompletion(o)) return null;
      return { from, to: at.string ? at.string.token.to : cx.pos, options: valueOptions(o, ctx), validFor: /^"?[^"]*"?$/ };
    }

    const empty = at.tokens.length === 0 || (at.tokens.length === 1 && at.partial);
    const keyPosition = (depth === 1 && top.kind === "object" && (top.state === "key" || top.state === "comma")) || !!at.string?.key;
    if (!empty && !keyPosition) return null;
    if (!at.string && !at.partial && !cx.explicit && !empty) {
      // Only right after "{" or "," without typing.
      const prev = at.tokens.filter((t) => t.to <= cx.pos).pop();
      if (!prev || prev.type !== "punct" || (prev.value !== "{" && prev.value !== ",")) return null;
    }
    if (empty && !at.partial && !cx.explicit) return null;

    const present = new Set(topLevelProperties(text).map((p) => p.key.toLowerCase()));
    const current = at.string?.key ? at.string.token.value.toLowerCase() : undefined;
    const needComma = depth === 1 && top.state === "comma" && !at.string;
    const replaceFrom = at.string?.token.from ?? at.partial?.from ?? cx.pos;
    let replaceTo = at.string ? at.string.token.to : cx.pos;
    const hasColon = at.next?.type === "punct" && at.next.value === ":";
    const followedByKey = !hasColon && at.next?.type === "string";
    if (at.string && hasColon) replaceTo = at.string.token.to;

    return {
      from: at.string ? at.string.token.from + 1 : replaceFrom,
      options: options.filter((o) => !present.has(o.name.toLowerCase()) || o.name.toLowerCase() === current).map((o) => ({
        label: o.name,
        detail: optionDetail(o),
        info: () => docNode(`${o.name}: ${optionDetail(o)}`, o.description),
        type: "property",
        apply: (view: EditorView) => {
          const value = placeholder(o);
          const prefix = needComma ? ", " : "";
          let insert = hasColon ? `"${o.name}"` : `${prefix}"${o.name}": ${value}${followedByKey ? ", " : ""}`;
          let valueAt = replaceFrom + prefix.length + o.name.length + 4;
          if (empty) {
            insert = `{\n  "${o.name}": ${value}\n}`;
            valueAt = replaceFrom + o.name.length + 8;
          }
          const selection = hasColon
            ? { anchor: replaceFrom + insert.length }
            : value === '""' ? { anchor: valueAt + 1 } : { anchor: valueAt, head: valueAt + value.length };
          view.dispatch({ changes: { from: replaceFrom, to: replaceTo, insert }, selection, userEvent: "input.complete" });
          if (!hasColon && wantsValueCompletion(o)) startCompletion(view);
        },
      })),
      validFor: /^[A-Za-z0-9_]*$/,
    };
  };
}

// ---------------------------------------------------------------------------
// Extension bundle

function optionsHover(context: () => OptionsContext): Extension {
  return hoverTooltip((view, pos) => {
    const ctx = context();
    const p = topLevelProperties(view.state.doc.toString()).find((t) => t.keyFrom <= pos && pos <= t.keyTo);
    if (!p) return null;
    const o = findOption(ctx.schema, p.key);
    if (!o && !ctx.schema) return null;
    return {
      pos: p.keyFrom, end: p.keyTo, above: true,
      create: () => ({ dom: o ? docNode(`${o.name}: ${optionDetail(o)}`, o.description) : docNode(`${p.key}`, `Unknown option of ${ctx.schema!.typeName}.`) }),
    };
  });
}

const jsonHighlight = HighlightStyle.define([
  { tag: tags.propertyName, color: "#93c5fd" },
  { tag: tags.string, color: "#86efac" },
  { tag: tags.number, color: "#fcd34d" },
  { tag: [tags.bool, tags.null], color: "#c4b5fd" },
  { tag: [tags.brace, tags.squareBracket, tags.separator, tags.punctuation], color: "#a1a1aa" },
  { tag: tags.invalid, color: "#f87171" },
]);

const optionsTheme = EditorView.theme({ ".cm-scroller": { maxHeight: "16em", minHeight: "2.6em" } });

export interface OptionsEditorHooks {
  context(): OptionsContext;
  onChange(text: string): void;
}

/** CodeMirror setup of an options field; browser only (tooltips live in document.body). */
export function optionsExtensions(hooks: OptionsEditorHooks): Extension {
  const syntax = jsonParseLinter();
  return [
    json(),
    syntaxHighlighting(jsonHighlight),
    fieldTheme,
    optionsTheme,
    EditorView.lineWrapping,
    history(),
    bracketMatching(),
    closeBrackets(),
    autocompletion({ override: [optionCompletions(hooks.context)], icons: true }),
    optionsHover(hooks.context),
    linter((view) => {
      if (!view.state.doc.toString().trim()) return [];
      const errors = syntax(view);
      return errors.length > 0 ? errors : optionDiagnostics(view.state.doc.toString(), hooks.context());
    }, { delay: 300 }),
    tooltips({ parent: document.body }),
    keymap.of([...closeBracketsKeymap, ...historyKeymap, indentWithTab, ...defaultKeymap]),
    EditorView.updateListener.of((u) => { if (u.docChanged) hooks.onChange(u.state.doc.toString()); }),
  ];
}
