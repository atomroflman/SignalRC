// Display of normalized SVG assets (Shared/Overlay/svg/README.md §2, §4, §5).
// The server output is already sanitized (AP07); this is defense in depth:
// a strict parser for the normalized subset, the allow-list again, and ID
// scoping so that several instances of an asset do not collide.
import { h, type VNode } from "./vnode";

const ELEMENTS = new Set([
  "g", "defs", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan",
  "linearGradient", "radialGradient", "stop", "clipPath",
]);

const ATTRIBUTES = new Set([
  "id", "transform", "d", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "fx", "fy", "fr",
  "width", "height", "points",
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap",
  "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "opacity",
  "clip-path", "clip-rule", "clipPathUnits",
  "font-family", "font-size", "font-weight", "font-style", "text-anchor", "letter-spacing", "dx", "dy",
  "gradientUnits", "gradientTransform", "spreadMethod", "offset", "stop-color", "stop-opacity",
  "data-part",
]);

export class AssetParseError extends Error {}

export interface ParsedAsset {
  viewBox: [number, number, number, number];
  /** Children of the root `<svg>`, allow-listed, ids not yet scoped. */
  children: (VNode | string)[];
  /** Elements or attributes dropped by the allow-list (should be 0 for server output). */
  dropped: number;
}

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (m, e: string) => {
    if (e[0] === "#") {
      const cp = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
    }
    const v = ENTITY[e];
    if (v === undefined) throw new AssetParseError(`unbekannte Entität ${m}`);
    return v;
  });
}

const URL_REF = /url\(\s*#([A-Za-z0-9_.:-]+)\s*\)/g;

/** Parses the normalized output. Throws AssetParseError on anything outside the subset. */
export function parseAsset(svg: string): ParsedAsset {
  let i = 0;
  let dropped = 0;
  const src = svg.replace(/^﻿/, "");
  type Raw = { tag: string; attrs: Record<string, string>; children: (Raw | string)[] };
  const root: Raw = { tag: "#root", attrs: {}, children: [] };
  const stack: Raw[] = [root];
  while (i < src.length) {
    const lt = src.indexOf("<", i);
    const text = src.slice(i, lt < 0 ? src.length : lt);
    const parent = stack[stack.length - 1];
    // Whitespace only matters inside text content.
    if (text && (text.trim() || parent.tag === "text" || parent.tag === "tspan")) parent.children.push(decode(text));
    if (lt < 0) break;
    if (src.startsWith("<?", lt)) {
      const end = src.indexOf("?>", lt);
      if (end < 0) throw new AssetParseError("unvollständige Verarbeitungsanweisung");
      i = end + 2;
      continue;
    }
    if (src.startsWith("<!--", lt)) {
      const end = src.indexOf("-->", lt);
      if (end < 0) throw new AssetParseError("unvollständiger Kommentar");
      i = end + 3;
      continue;
    }
    if (src.startsWith("<!", lt)) throw new AssetParseError("DOCTYPE/CDATA nicht erlaubt");
    if (src[lt + 1] === "/") {
      const m = /^<\/([A-Za-z][\w:.-]*)\s*>/.exec(src.slice(lt));
      if (!m || stack.length < 2 || stack[stack.length - 1].tag !== m[1]) throw new AssetParseError("unpassendes Ende-Tag");
      stack.pop();
      i = lt + m[0].length;
      continue;
    }
    const m = /^<([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>/.exec(src.slice(lt));
    if (!m) throw new AssetParseError("ungültiges Tag");
    const attrs: Record<string, string> = {};
    for (const a of m[2].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = decode(a[2] ?? a[3] ?? "");
    const node: Raw = { tag: m[1], attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!m[3]) stack.push(node);
    i = lt + m[0].length;
  }
  if (stack.length !== 1) throw new AssetParseError("unvollständiges Dokument");
  const svgRoot = root.children.find((c): c is Raw => typeof c !== "string");
  if (!svgRoot || svgRoot.tag !== "svg" || root.children.some((c) => typeof c !== "string" && c !== svgRoot)) {
    throw new AssetParseError("Wurzel muss genau ein <svg> sein");
  }
  const vb = (svgRoot.attrs.viewBox ?? "").trim().split(/[\s,]+/).map(Number);
  if (vb.length !== 4 || vb.some((n) => !Number.isFinite(n)) || vb[2] < 0 || vb[3] < 0) throw new AssetParseError("ungültige viewBox");

  const convert = (n: Raw | string): VNode | string | undefined => {
    if (typeof n === "string") return n;
    if (!ELEMENTS.has(n.tag)) {
      dropped++;
      return undefined;
    }
    const attrs: Record<string, string> = {};
    for (const [k, v] of Object.entries(n.attrs)) {
      if (!ATTRIBUTES.has(k)) {
        dropped++;
        continue;
      }
      // Only references to gradients/clip paths of the same asset.
      if (/url\(/i.test(v) && v.replace(URL_REF, "").includes("url(")) {
        dropped++;
        continue;
      }
      attrs[k] = v;
    }
    return h(n.tag, attrs, n.children.map(convert));
  };
  return {
    viewBox: vb as [number, number, number, number],
    children: svgRoot.children.map(convert).filter((c): c is VNode | string => c !== undefined),
    dropped,
  };
}

/** Prefixes every id and `url(#id)` reference, e.g. `r1` → `ovl-e_logo-r1` (svg §5). */
export function scopeIds(nodes: (VNode | string)[], prefix: string): (VNode | string)[] {
  const scope = (n: VNode | string): VNode | string => {
    if (typeof n === "string") return n;
    const attrs: Record<string, string> = {};
    for (const [k, v] of Object.entries(n.attrs)) {
      if (k === "id") attrs[k] = prefix + v;
      else attrs[k] = v.includes("url(") ? v.replace(URL_REF, (_, id: string) => `url(#${prefix}${id})`) : v;
    }
    return { tag: n.tag, attrs, children: n.children.map(scope) };
  };
  return nodes.map(scope);
}

/** Part ids contained in a subtree, for skipping unchanged branches. */
export function partsBelow(nodes: (VNode | string)[]): WeakMap<VNode, Set<string>> {
  const map = new WeakMap<VNode, Set<string>>();
  const visit = (n: VNode | string): Set<string> | undefined => {
    if (typeof n === "string") return undefined;
    let set: Set<string> | undefined;
    const own = n.attrs["data-part"];
    if (own !== undefined) set = new Set([own]);
    for (const c of n.children) {
      const sub = visit(c);
      if (sub) for (const p of sub) (set ??= new Set()).add(p);
    }
    if (set) map.set(n, set);
    return set;
  };
  nodes.forEach(visit);
  return map;
}

/**
 * Rebuilds the asset tree with wrapped parts. `wrap(partId, node)` returns the
 * replacement or undefined to keep the node; branches without affected parts
 * keep their identity.
 */
export function withParts(
  nodes: (VNode | string)[],
  below: WeakMap<VNode, Set<string>>,
  affected: Set<string>,
  wrap: (partId: string, node: VNode, children: (VNode | string)[]) => VNode | undefined,
): (VNode | string)[] {
  const visit = (n: VNode | string): VNode | string => {
    if (typeof n === "string") return n;
    const set = below.get(n);
    if (!set || ![...set].some((p) => affected.has(p))) return n;
    const children = n.children.map(visit);
    const part = n.attrs["data-part"];
    if (part !== undefined && affected.has(part)) return wrap(part, n, children) ?? { ...n, children };
    return { ...n, children };
  };
  return nodes.map(visit);
}
