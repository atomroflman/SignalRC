// Immutable document updates with structural sharing. A Writer copies each
// object on the way to a change once (prototype-less, see document/dict.ts);
// untouched subtrees keep their identity, so undo snapshots stay small and
// diffs can skip shared subtrees.
import { dict } from "../../document/dict";

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function copyOf(v: unknown): unknown {
  if (Array.isArray(v)) return [...v];
  if (isObj(v)) return Object.assign(dict<unknown>(), v);
  return v;
}

export class Writer<T extends object> {
  private root: T;
  private readonly copied = new Set<unknown>();

  constructor(base: T) {
    this.root = base;
  }

  get result(): T {
    return this.root;
  }

  /** Read-only access to the current state. */
  get current(): T {
    return this.root;
  }

  /**
   * Returns a mutable copy of the object at `path`, creating missing objects.
   * Every object on the way is copied once per writer.
   */
  obj(path: readonly string[]): Obj {
    if (!this.copied.has(this.root)) {
      this.root = copyOf(this.root) as T;
      this.copied.add(this.root);
    }
    let node = this.root as unknown as Obj;
    for (const key of path) {
      let child = node[key];
      if (child === undefined || child === null || typeof child !== "object") {
        child = dict<unknown>();
        node[key] = child;
        this.copied.add(child);
      } else if (!this.copied.has(child)) {
        child = copyOf(child);
        node[key] = child;
        this.copied.add(child);
      }
      node = child as Obj;
    }
    return node;
  }

  /** Mutable copy of the array at `path` (created empty when missing). */
  arr(path: readonly string[]): unknown[] {
    const parent = this.obj(path.slice(0, -1));
    const key = path[path.length - 1];
    let a = parent[key];
    if (!Array.isArray(a)) {
      a = [];
      parent[key] = a;
      this.copied.add(a);
    } else if (!this.copied.has(a)) {
      a = [...a];
      parent[key] = a;
      this.copied.add(a);
    }
    return a as unknown[];
  }

  get(path: readonly string[]): unknown {
    let node: unknown = this.root;
    for (const key of path) {
      if (!isObj(node) && !Array.isArray(node)) return undefined;
      node = (node as Obj)[key];
    }
    return node;
  }

  set(path: readonly string[], value: unknown): void {
    if (value === undefined) {
      this.remove(path);
      return;
    }
    const parent = this.obj(path.slice(0, -1));
    parent[path[path.length - 1]] = value;
  }

  /** Removes the key; afterwards prunes objects on the path that became empty (from `pruneFrom` on). */
  remove(path: readonly string[], pruneFrom = path.length): void {
    if (this.get(path) === undefined) return;
    const parent = this.obj(path.slice(0, -1));
    delete parent[path[path.length - 1]];
    for (let depth = path.length - 1; depth >= pruneFrom && depth > 0; depth--) {
      const p = path.slice(0, depth);
      const v = this.get(p);
      if (isObj(v) && Object.keys(v).length === 0) delete this.obj(p.slice(0, -1))[p[p.length - 1]];
      else break;
    }
  }
}

/** Deep equality of JSON values. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => jsonEqual(v, b[i]));
  }
  if (Array.isArray(b)) return false;
  const ka = Object.keys(a as Obj).filter((k) => (a as Obj)[k] !== undefined);
  const kb = Object.keys(b as Obj).filter((k) => (b as Obj)[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => jsonEqual((a as Obj)[k], (b as Obj)[k]));
}

/**
 * Returns `next` with every subtree that equals the one in `prev` replaced by
 * `prev`'s object. Restores sharing after a function that deep-copies.
 */
export function share<T>(prev: T, next: T): T {
  if (prev === next) return next;
  if (jsonEqual(prev, next)) return prev;
  if (Array.isArray(prev) && Array.isArray(next)) {
    return next.map((v, i) => (i < prev.length ? share(prev[i], v) : v)) as T;
  }
  if (isObj(prev) && isObj(next)) {
    const out = dict<unknown>();
    for (const [k, v] of Object.entries(next)) out[k] = k in prev ? share(prev[k], v) : v;
    return out as T;
  }
  return next;
}
