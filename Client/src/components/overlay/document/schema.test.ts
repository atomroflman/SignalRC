import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";
import { checkSchema } from "./schema";
import { readContractJson } from "../testing/fixtures";

const schema = readContractJson<object>("schema/overlay-document.schema.json");
const ajv = new Ajv2020({ strict: false, allErrors: true });
const ajvValid = ajv.compile(schema);

interface Case { file: string; schemaValid: boolean }
const cases = readContractJson<{ cases: Case[] }>("fixtures/documents/cases.json").cases;
const valid = cases.filter((c) => c.schemaValid).map((c) => readContractJson<Record<string, unknown>>(`fixtures/documents/${c.file}`));

/** Deterministic mutations of valid documents to compare both validators on many shapes. */
function* mutations(value: unknown, path: (string | number)[] = []): Generator<{ path: (string | number)[]; replacement: unknown }> {
  const replacements = [null, 0, -1, 1.5, "", "x", "root", true, [], {}, "#ff0000", "a".repeat(1001), 17000, 0.0];
  for (const r of replacements) yield { path, replacement: r };
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) yield* mutations(value[i], [...path, i]);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      yield { path: [...path, k], replacement: undefined };
      yield* mutations(v, [...path, k]);
    }
    yield { path: [...path, "unexpectedKey"], replacement: 1 };
  }
}

function apply(doc: unknown, path: (string | number)[], replacement: unknown): unknown {
  if (path.length === 0) return replacement;
  const copy = structuredClone(doc) as Record<string | number, unknown>;
  let target = copy;
  for (const key of path.slice(0, -1)) target = target[key] as Record<string | number, unknown>;
  const last = path[path.length - 1];
  if (replacement === undefined) delete target[last];
  else target[last] = replacement;
  return copy;
}

describe("hand-written schema check", () => {
  it.each(cases)("agrees with expectation for $file", (c) => {
    const doc = readContractJson(`fixtures/documents/${c.file}`);
    expect(ajvValid(doc)).toBe(c.schemaValid);
    expect(checkSchema(doc).length === 0).toBe(c.schemaValid);
  });

  it("reports an unsupported schema version on its own", () => {
    const d = checkSchema({ schemaVersion: 2, workspace: {}, elements: {}, children: [] });
    expect(d.map((x) => x.code)).toEqual(["OVL_SCHEMA_UNSUPPORTED"]);
  });

  it("agrees with ajv on mutated documents", () => {
    let compared = 0;
    const disagreements: string[] = [];
    for (const doc of valid) {
      for (const { path, replacement } of mutations(doc)) {
        const mutated = apply(doc, path, replacement);
        const expected = ajvValid(mutated);
        const actual = checkSchema(mutated).length === 0;
        compared++;
        if (expected !== actual) disagreements.push(`/${path.join("/")} = ${JSON.stringify(replacement)?.slice(0, 40)}: ajv ${expected}, checkSchema ${actual}`);
      }
    }
    expect(disagreements.slice(0, 20)).toEqual([]);
    expect(compared).toBeGreaterThan(5000);
  });
});
