// The renderer accepts the server's normalized output (fixtures/svg/expected,
// AP07) unchanged: strict parse, nothing dropped, parts as in the metadata,
// part pivots from bbox, and one scoping rule for several instances (svg §4, §5).
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { effectiveConfig } from "../document";
import type { OverlayDocument } from "../document/types";
import { FakeValueSource } from "../sources/testing/fake-value-source";
import { contractsRoot, readContractJson } from "../testing/fixtures";
import { createRuntime } from "./runtime";
import { SceneBuilder } from "./scene";
import { parseAsset, scopeIds } from "./svg-asset";
import { toMarkup, type VNode } from "./vnode";

interface Part { tag: string; bbox?: [number, number, number, number] }
interface Case { id: string; accepted: boolean; expected?: string; width?: number; height?: number; parts?: Record<string, Part> }

const cases = readContractJson<{ cases: Case[] }>("fixtures/svg/cases.json").cases.filter((c) => c.expected);
const read = (name: string) => fs.readFileSync(path.join(contractsRoot, "fixtures/svg/expected", name), "utf8").trimEnd();

function partsOf(nodes: (VNode | string)[]): [string, string][] {
  const out: [string, string][] = [];
  const visit = (n: VNode | string) => {
    if (typeof n === "string") return;
    if (n.attrs["data-part"] !== undefined) out.push([n.attrs["data-part"], n.tag]);
    n.children.forEach(visit);
  };
  nodes.forEach(visit);
  return out;
}

describe("server output (fixtures/svg/expected)", () => {
  it.each(cases.map((c) => [c.id, c] as const))("%s parses unchanged with its parts", (_, c) => {
    const svg = read(c.expected!);
    const a = parseAsset(svg);
    expect(a.dropped).toBe(0);
    // Round trip is byte-identical: the allow-list matches the server form exactly.
    expect(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${a.viewBox.join(" ")}">${a.children.map(toMarkup).join("")}</svg>`).toBe(svg);
    if (c.width !== undefined) expect(a.viewBox).toEqual([0, 0, c.width, c.height]);
    const found = new Map(partsOf(a.children));
    for (const [id, p] of Object.entries(c.parts ?? {})) expect(found.get(id), `${c.id}/${id}`).toBe(p.tag);
  });

  it("two instances of one asset get disjoint ids and references", () => {
    const a = parseAsset(read("gradients-use.svg"));
    const one = scopeIds(a.children, "ovl-e_one-").map(toMarkup).join("");
    const two = scopeIds(a.children, "ovl-e_two-").map(toMarkup).join("");
    const ids = (s: string) => [...s.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    const urls = (s: string) => [...s.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]);
    expect(ids(one)).toEqual(["r1", "r2", "r3", "r4"].map((r) => `ovl-e_one-${r}`));
    expect(urls(one).length).toBeGreaterThan(0);
    expect(urls(one).every((u) => ids(one).includes(u))).toBe(true);
    expect(ids(one).some((id) => ids(two).includes(id))).toBe(false);
    // Parts stay selectable by data-part.
    expect(one).toContain('data-part="tick-1"');
  });

  it("an animated part of a server asset rotates about its bbox centre", () => {
    const c = cases.find((x) => x.id === "inkscape")!;
    const needle = c.parts!.needle;
    const doc: OverlayDocument = {
      schemaVersion: 1,
      workspace: { width: 200, height: 200 },
      elements: {
        e_a: { type: "svgAsset", assetId: "sha256-x", parts: { needle: { props: { rotation: 90 } } } },
        e_b: { type: "svgAsset", assetId: "sha256-x" },
      },
      children: ["e_a", "e_b"],
    };
    const config = effectiveConfig(doc, null);
    const assets = { "sha256-x": { svg: read("inkscape.svg"), metadata: { width: 120, height: 120, parts: { needle: { tag: "g", bbox: needle.bbox! } } } } };
    const rt = createRuntime(config);
    const scene = new SceneBuilder(config, { locale: "de", pxPerUnit: 1, idPrefix: "ovl-", assets }, rt.staticElements()).build(rt.step(0, new FakeValueSource()));
    expect(scene.diagnostics).toEqual([]);
    const [bx, by, bw, bh] = needle.bbox!;
    const cx = bx + bw / 2;
    const cy = by + bh / 2;
    const markup = toMarkup(scene.tree);
    // rotate(90) about (cx, cy): matrix(0 1 -1 0 cx+cy cy-cx); the part's own transform stays inside.
    expect(markup).toContain(`<g data-ovl-part="needle" transform="matrix(0 1 -1 0 ${cx + cy} ${cy - cx})"><g data-part="needle" transform="matrix(0 -1 1 0 0 120)">`);
    expect(markup.match(/data-ovl-part=/g)).toHaveLength(1);
  });
});
