// AP12 – source, stream and asset references of a document and their renaming
// (Shared/Overlay/svg/README.md §7 step 3). Formulas are rewritten through the
// AST: only text-literal arguments of tel()/out() change, never other text.
import { detach, dict } from "../document/dict";
import type { Clip, ClipSettings, OverlayDocument, OverlayElement, PropMap } from "../document/types";
import { parse, type Node } from "../expression/parser";

export interface DocumentReferences {
  /** Telemetry channel → number of uses (formulas, LiDAR sources, deadline overrides). */
  telemetry: Record<string, number>;
  /** Output (control channel) → number of uses. */
  outputs: Record<string, number>;
  /** StreamIds of the variants and of picture-in-picture elements, sorted. */
  streams: string[];
  /** Referenced asset ids, sorted. */
  assets: string[];
}

/** Renaming; a missing entry keeps the name. */
export interface ReferenceMapping {
  telemetry?: Record<string, string>;
  outputs?: Record<string, string>;
  streams?: Record<string, string>;
  assets?: Record<string, string>;
}

type SourceFn = "tel" | "out";

interface LiteralRef {
  fn: SourceFn;
  name: string;
  start: number;
  end: number;
}

/** End offset (exclusive) of the text literal starting at `start` (a `"`). */
function literalEnd(expr: string, start: number): number {
  let i = start + 1;
  while (i < expr.length && expr[i] !== '"') i += expr[i] === "\\" ? 2 : 1;
  return i + 1;
}

function sourceLiterals(expr: string): LiteralRef[] {
  let ast: Node;
  try {
    ast = parse(expr);
  } catch {
    return []; // invalid formulas stay as they are; validation reports them
  }
  const found: LiteralRef[] = [];
  const walk = (n: Node) => {
    switch (n.kind) {
      case "unary": walk(n.operand); break;
      case "binary": walk(n.left); walk(n.right); break;
      case "call": {
        const arg = n.args[0];
        if ((n.name === "tel" || n.name === "out") && n.args.length === 1 && arg.kind === "text") {
          found.push({ fn: n.name, name: arg.value, start: arg.start, end: literalEnd(expr, arg.start) });
        }
        n.args.forEach(walk);
        break;
      }
      default: break;
    }
  };
  walk(ast);
  return found;
}

/** Text literal in the expression language (escapes only `\"` and `\\`). */
export function quote(text: string): string {
  return `"${text.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
}

/** Renames source arguments of one formula; unchanged formulas are returned as they are. */
export function renameInFormula(expr: string, mapping: ReferenceMapping): string {
  const refs = sourceLiterals(expr);
  let out = expr;
  for (const r of [...refs].reverse()) {
    const table = r.fn === "tel" ? mapping.telemetry : mapping.outputs;
    const next = table?.[r.name];
    if (next === undefined || next === r.name) continue;
    out = out.slice(0, r.start) + quote(next) + out.slice(r.end);
  }
  return out;
}

// --- Walking all formulas of a document ---

type FormulaFn = (expr: string) => string;

function mapProps(props: PropMap | undefined, fn: FormulaFn) {
  if (!props) return;
  for (const value of Object.values(props)) {
    if (value === null || typeof value !== "object") continue;
    if (value.binding) value.binding.expr = fn(value.binding.expr);
    if (value.rate) value.rate.expr = fn(value.rate.expr);
  }
}

function mapElementLike(el: { props?: PropMap; parts?: Record<string, { props?: PropMap }> } | undefined, fn: FormulaFn) {
  if (!el) return;
  mapProps(el.props, fn);
  for (const part of Object.values(el.parts ?? {})) mapProps(part.props, fn);
}

function mapClip(clip: ClipSettings | Clip | undefined, fn: FormulaFn) {
  const t = clip?.trigger;
  if (t && t.mode !== "auto" && typeof t.condition === "string") t.condition = fn(t.condition);
}

/** Calls `fn` for every formula of the document (in place on a copy) and returns the copy. */
function mapFormulas(doc: OverlayDocument, fn: FormulaFn): OverlayDocument {
  const copy = detach(doc);
  for (const el of Object.values(copy.elements)) mapElementLike(el, fn);
  for (const clip of Object.values(copy.clips ?? {})) mapClip(clip, fn);
  for (const v of Object.values(copy.variants ?? {})) {
    for (const el of Object.values(v.elements ?? {})) mapElementLike(el, fn);
    for (const el of Object.values(v.addedElements ?? {})) mapElementLike(el, fn);
    for (const clip of Object.values(v.clips ?? {})) mapClip(clip, fn);
    for (const clip of Object.values(v.addedClips ?? {})) mapClip(clip, fn);
  }
  return copy;
}

function allElements(doc: OverlayDocument): OverlayElement[] {
  const list = Object.values(doc.elements);
  for (const v of Object.values(doc.variants ?? {})) list.push(...Object.values(v.addedElements ?? {}));
  return list;
}

export function collectReferences(doc: OverlayDocument): DocumentReferences {
  const telemetry = dict<number>();
  const outputs = dict<number>();
  const count = (table: Record<string, number>, name: string) => { table[name] = (table[name] ?? 0) + 1; };
  mapFormulas(doc, (expr) => {
    for (const r of sourceLiterals(expr)) count(r.fn === "tel" ? telemetry : outputs, r.name);
    return expr;
  });
  const assets = new Set<string>();
  const streams = new Set(Object.keys(doc.variants ?? {}));
  for (const el of allElements(doc)) {
    if (el.type === "lidarWidget" && typeof el.source === "string") count(telemetry, el.source);
    if (el.type === "videoStream" && typeof el.source === "string") streams.add(el.source);
    if (typeof el.assetId === "string") assets.add(el.assetId);
  }
  for (const name of Object.keys(doc.sources?.telemetry ?? {})) count(telemetry, name);
  return { telemetry, outputs, streams: [...streams].sort(), assets: [...assets].sort() };
}

export class MappingError extends Error {
  constructor(readonly code: "STREAM_TARGET_TWICE", readonly ref: string) {
    super(`Stream ${ref} ist mehrfach zugeordnet`);
  }
}

/** Applies the renaming to formulas, LiDAR and video sources, deadline overrides, variant keys and asset ids. */
export function applyReferenceMapping(doc: OverlayDocument, mapping: ReferenceMapping): OverlayDocument {
  const out = mapFormulas(doc, (expr) => renameInFormula(expr, mapping));
  const tel = mapping.telemetry ?? {};
  const assets = mapping.assets ?? {};
  const streamMap = mapping.streams ?? {};
  for (const el of allElements(out)) {
    if (el.type === "lidarWidget" && typeof el.source === "string" && tel[el.source] !== undefined) el.source = tel[el.source];
    if (el.type === "videoStream" && typeof el.source === "string" && streamMap[el.source]) el.source = streamMap[el.source];
    if (typeof el.assetId === "string" && assets[el.assetId] !== undefined) el.assetId = assets[el.assetId];
  }
  const overrides = out.sources?.telemetry;
  if (overrides) {
    const renamed = dict<{ staleAfterMs?: number }>();
    // Two channels mapped onto one: the first in key order wins.
    for (const name of Object.keys(overrides).sort()) {
      const target = tel[name] ?? name;
      if (renamed[target] === undefined) renamed[target] = overrides[name];
    }
    out.sources!.telemetry = renamed;
  }
  const streams = mapping.streams ?? {};
  if (out.variants && Object.keys(streams).length > 0) {
    const renamed = dict<NonNullable<OverlayDocument["variants"]>[string]>();
    for (const [id, variant] of Object.entries(out.variants)) {
      const target = streams[id] || id;
      if (renamed[target] !== undefined) throw new MappingError("STREAM_TARGET_TWICE", target);
      renamed[target] = variant;
    }
    out.variants = renamed;
  }
  return out;
}
