import { describe, expect, it } from "vitest";
import { isSubset, readContractJson } from "../testing/fixtures";
import { resolve } from "./resolve";
import type { OverlayDocument } from "./types";
import { effectiveConfig } from "./resolve";

interface Case { id: string; file?: string; inline?: OverlayDocument; stream: string | null; expect: unknown }
const cases = readContractJson<{ cases: Case[] }>("fixtures/documents/resolution.json").cases;

describe("resolution against shared fixtures", () => {
  it.each(cases)("$id", (c) => {
    const doc = c.inline ?? readContractJson<OverlayDocument>(`fixtures/documents/${c.file}`);
    const result = c.stream === null ? { kind: "hud", ...effectiveConfig(doc, null) } : resolve(doc, c.stream);
    const actual = result.kind === "hud" && "config" in result ? { kind: "hud", ...result.config } : result;
    expect(isSubset(c.expect, actual), JSON.stringify(actual, null, 1)).toBe(true);
  });
});

describe("resolution details", () => {
  it("does not let variant data leak into the standard", () => {
    const doc = readContractJson<OverlayDocument>("fixtures/documents/valid/variants-clips-lidar.json");
    const before = JSON.stringify(doc);
    effectiveConfig(doc, "front-wide");
    expect(JSON.stringify(doc)).toBe(before);
    expect(effectiveConfig(doc, null).elements.e_front_box).toBeUndefined();
  });

  it("excludes elements that are not reachable from the root", () => {
    const doc: OverlayDocument = {
      schemaVersion: 1, workspace: { width: 1, height: 1 },
      elements: { e_a: { type: "rect" }, e_lost: { type: "rect" } },
      children: ["e_a"],
    };
    expect(Object.keys(effectiveConfig(doc, null).elements)).toEqual(["e_a"]);
  });
});
