// Test double: the DOM subset the patcher uses, with markup output and write counting.
import type { DomDocument, DomNode } from "../vnode";

export class FakeNode implements DomNode {
  readonly childNodes: FakeNode[] = [];
  readonly attributes = new Map<string, string>();
  nodeValue: string | null = null;

  constructor(readonly tag: string, readonly owner: FakeDocument) {}

  setAttribute(name: string, value: string) {
    this.owner.writes++;
    this.attributes.set(name, value);
  }

  removeAttribute(name: string) {
    this.owner.writes++;
    this.attributes.delete(name);
  }

  attr(name: string) {
    return this.attributes.get(name);
  }

  appendChild(child: FakeNode) {
    this.owner.writes++;
    this.childNodes.push(child);
    return child;
  }

  insertBefore(child: FakeNode, ref: FakeNode | null) {
    this.owner.writes++;
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(child);
    else this.childNodes.splice(i, 0, child);
    return child;
  }

  removeChild(child: FakeNode) {
    this.owner.writes++;
    const i = this.childNodes.indexOf(child);
    if (i >= 0) this.childNodes.splice(i, 1);
    return child;
  }

  replaceChild(next: FakeNode, old: FakeNode) {
    this.owner.writes++;
    this.childNodes[this.childNodes.indexOf(old)] = next;
    return old;
  }

  /** Descendants (depth first) matching a predicate. */
  findAll(pred: (n: FakeNode) => boolean): FakeNode[] {
    const out: FakeNode[] = [];
    const visit = (n: FakeNode) => {
      if (pred(n)) out.push(n);
      n.childNodes.forEach(visit);
    };
    this.childNodes.forEach(visit);
    return out;
  }

  byAttr(name: string, value?: string) {
    return this.findAll((n) => n.attributes.has(name) && (value === undefined || n.attributes.get(name) === value));
  }

  get textContent(): string {
    return this.tag === "#text" ? (this.nodeValue ?? "") : this.childNodes.map((c) => c.textContent).join("");
  }

  get markup(): string {
    if (this.tag === "#text") return this.nodeValue ?? "";
    const attrs = [...this.attributes].map(([k, v]) => ` ${k}="${v}"`).join("");
    return `<${this.tag}${attrs}>${this.childNodes.map((c) => c.markup).join("")}</${this.tag}>`;
  }
}

export class FakeDocument implements DomDocument {
  writes = 0;

  createElementNS(_ns: string, tag: string) {
    return new FakeNode(tag, this);
  }

  createTextNode(text: string) {
    const n = new FakeNode("#text", this);
    n.nodeValue = text;
    return n;
  }
}
