// Test-only access to the shared contract fixtures (Shared/Overlay). Vitest
// runs in Client/, so the repository root is one level up.
import fs from "node:fs";
import path from "node:path";

export const contractsRoot = path.resolve(process.cwd(), "../Shared/Overlay");

export function readContractJson<T = unknown>(relative: string): T {
  return JSON.parse(fs.readFileSync(path.join(contractsRoot, relative), "utf8")) as T;
}

/**
 * True when every field of `expected` is present in `actual` with an equal
 * (sub)value. Arrays must match completely; an expected null also matches an
 * absent value.
 */
export function isSubset(expected: unknown, actual: unknown): boolean {
  if (expected === null) return actual === null || actual === undefined;
  if (typeof expected !== "object") return Object.is(expected, actual);
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && actual.length === expected.length && expected.every((e, i) => isSubset(e, actual[i]));
  }
  if (actual === null || typeof actual !== "object") return false;
  return Object.entries(expected).every(([k, v]) => isSubset(v, (actual as Record<string, unknown>)[k]));
}
