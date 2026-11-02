// Minimal SVG tree: the scene is rebuilt per frame as plain objects and the
// DOM is patched attribute by attribute, without a React render per frame.
// Unchanged subtrees keep their object identity and are skipped.

export interface VNode {
  tag: string;
  attrs: Record<string, string>;
  children: (VNode | string)[];
}

export const SVG_NS = "http://www.w3.org/2000/svg";

export function h(tag: string, attrs: Record<string, string | number | undefined | false> = {}, children: (VNode | string | undefined | false)[] = []): VNode {
  const a: Record<string, string> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    a[k] = typeof v === "number" ? num(v) : v;
  }
  return { tag, attrs: a, children: children.filter((c): c is VNode | string => c !== undefined && c !== false) };
}

/** Compact number formatting for attributes (3 decimals, no "-0"). */
export function num(v: number): string {
  if (!Number.isFinite(v)) return "0";
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? "0" : String(r);
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Serializes a tree (tests, server-side rendering). */
export function toMarkup(node: VNode | string): string {
  if (typeof node === "string") return escape(node);
  const attrs = Object.entries(node.attrs).map(([k, v]) => ` ${k}="${escape(v)}"`).join("");
  if (node.children.length === 0) return `<${node.tag}${attrs}/>`;
  return `<${node.tag}${attrs}>${node.children.map(toMarkup).join("")}</${node.tag}>`;
}

// --- DOM patching (structural subset of the DOM, so tests can use a fake) ---

export interface DomNode {
  readonly childNodes: ArrayLike<DomNode>;
  nodeValue: string | null;
  appendChild(child: DomNode): unknown;
  insertBefore(child: DomNode, ref: DomNode | null): unknown;
  removeChild(child: DomNode): unknown;
  replaceChild(next: DomNode, old: DomNode): unknown;
  setAttribute?(name: string, value: string): void;
  removeAttribute?(name: string): void;
}

export interface DomDocument {
  createElementNS(ns: string, tag: string): DomNode;
  createTextNode(text: string): DomNode;
}

export function create(doc: DomDocument, node: VNode | string): DomNode {
  if (typeof node === "string") return doc.createTextNode(node);
  const el = doc.createElementNS(SVG_NS, node.tag);
  for (const [k, v] of Object.entries(node.attrs)) el.setAttribute!(k, v);
  for (const c of node.children) el.appendChild(create(doc, c));
  return el;
}

/** Brings `dom`, which shows `prev`, to `next`; returns the (possibly replaced) node. */
export function patch(doc: DomDocument, parent: DomNode, dom: DomNode, prev: VNode | string, next: VNode | string): DomNode {
  if (prev === next) return dom;
  if (typeof prev === "string" || typeof next === "string" || prev.tag !== next.tag) {
    if (typeof prev === "string" && typeof next === "string") {
      if (dom.nodeValue !== next) dom.nodeValue = next;
      return dom;
    }
    const fresh = create(doc, next);
    parent.replaceChild(fresh, dom);
    return fresh;
  }
  for (const k of Object.keys(prev.attrs)) if (!(k in next.attrs)) dom.removeAttribute!(k);
  for (const [k, v] of Object.entries(next.attrs)) if (prev.attrs[k] !== v) dom.setAttribute!(k, v);
  patchChildren(doc, dom, prev.children, next.children);
  return dom;
}

export function patchChildren(doc: DomDocument, dom: DomNode, prev: (VNode | string)[], next: (VNode | string)[]) {
  const common = Math.min(prev.length, next.length);
  for (let i = 0; i < common; i++) patch(doc, dom, dom.childNodes[i], prev[i], next[i]);
  for (let i = prev.length - 1; i >= common; i--) dom.removeChild(dom.childNodes[i]);
  for (let i = common; i < next.length; i++) dom.appendChild(create(doc, next[i]));
}
