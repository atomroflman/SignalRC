// JSON Patch (RFC 6902) subset of the autosave (Shared/Overlay/api/README.md §3,
// D63): add, remove and replace; arrays are replaced as a whole.
import { detach } from "../../document/dict";
import { jsonEqual } from "./writer";

export type PatchOp =
  | { op: "add"; path: string; value: unknown }
  | { op: "replace"; path: string; value: unknown }
  | { op: "remove"; path: string };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const escape = (key: string) => key.replace(/~/g, "~0").replace(/\//g, "~1");

/** Operations that turn `from` into `to`. Shared subtrees (same object) are skipped without a walk. */
export function diff(from: unknown, to: unknown, path = ""): PatchOp[] {
  if (from === to) return [];
  if (isObj(from) && isObj(to)) {
    const ops: PatchOp[] = [];
    for (const key of Object.keys(from)) {
      if (from[key] !== undefined && to[key] === undefined) ops.push({ op: "remove", path: `${path}/${escape(key)}` });
    }
    for (const [key, value] of Object.entries(to)) {
      if (value === undefined) continue;
      const p = `${path}/${escape(key)}`;
      if (from[key] === undefined) ops.push({ op: "add", path: p, value });
      else ops.push(...diff(from[key], value, p));
    }
    return ops;
  }
  if (jsonEqual(from, to)) return [];
  return [{ op: "replace", path, value: to }];
}

export class PatchError extends Error {}

const parse = (pointer: string) => {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) throw new PatchError(`invalid pointer ${pointer}`);
  return pointer.slice(1).split("/").map((t) => t.replace(/~1/g, "/").replace(/~0/g, "~"));
};

/** Applies operations to a detached copy (test double of the server side). */
export function applyPatch<T>(doc: T, ops: PatchOp[]): T {
  let root = detach(doc) as unknown;
  for (const op of ops) {
    const tokens = parse(op.path);
    if (tokens.length === 0) {
      if (op.op === "remove") throw new PatchError("cannot remove the root");
      root = detach(op.value);
      continue;
    }
    let node = root;
    for (const t of tokens.slice(0, -1)) {
      const next = Array.isArray(node) ? node[Number(t)] : isObj(node) ? node[t] : undefined;
      if (next === undefined || next === null || typeof next !== "object") throw new PatchError(`path segment ${t} not found`);
      node = next;
    }
    const last = tokens[tokens.length - 1];
    if (Array.isArray(node)) {
      const i = last === "-" ? node.length : Number(last);
      if (!Number.isInteger(i) || i < 0 || i > node.length) throw new PatchError(`invalid index ${last}`);
      if (op.op === "add") node.splice(i, 0, detach(op.value));
      else if (i >= node.length) throw new PatchError(`index ${last} out of range`);
      else if (op.op === "replace") node[i] = detach(op.value);
      else node.splice(i, 1);
    } else if (isObj(node)) {
      if (op.op !== "add" && !(last in node)) throw new PatchError(`member ${last} not found`);
      if (op.op === "remove") delete node[last];
      else node[last] = detach(op.value);
    } else {
      throw new PatchError("target is not a container");
    }
  }
  return root as T;
}
