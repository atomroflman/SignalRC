// AP14 – hostile exchange packages across parse → prepare (server re-sanitizing)
// → mapping → evaluation. Complements exchange.test.ts (limits, round trip).
import { describe, expect, it } from "vitest";
import type { SvgImportState } from "../assets/types";
import { evaluateImport, parsePackage, prepareImport, suggestMapping, type AssetUploader, type VehicleSources } from "../exchange";

const ID_A = "sha256-" + "a".repeat(64);
const ID_SERVER = "sha256-" + "b".repeat(64);
const HOSTILE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><rect width="5" height="5"/></svg>';
const CLEAN_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 5 5"><rect width="5" height="5"/></svg>';

const target: VehicleSources = {
  telemetry: [{ name: "speed", dataType: "Number" }],
  outputs: ["steering"],
  streams: [{ streamId: "front", name: "Front" }],
};

function pkgText(document: unknown, assets: Record<string, unknown> = {}, extra = "") {
  return `{"format":"signalrc-overlay-package","formatVersion":1,"kind":"export","exportedAt":"2026-11-02",${extra}` +
    `"source":{"streams":[{"streamId":"cam-other","name":"Front"}],"telemetry":[{"name":"__proto__"}],"outputs":["constructor"]},` +
    `"document":${typeof document === "string" ? document : JSON.stringify(document)},"assets":${JSON.stringify(assets)}}`;
}

/** Records what reaches the server; answers like the real sanitizer would (strip or reject). */
function server(mode: "sanitize" | "reject") {
  const sent: string[] = [];
  const upload: AssetUploader = async (svg) => {
    sent.push(svg);
    if (mode === "reject") return { kind: "rejected", code: "SVG_REJECTED_PARSE", report: [] } satisfies SvgImportState;
    return { kind: "accepted", result: { assetId: ID_SERVER, svg: CLEAN_SVG, metadata: { assetId: ID_SERVER, width: 5, height: 5, parts: {} }, report: [] } } as SvgImportState;
  };
  return { sent, upload };
}

const docWithAsset = {
  schemaVersion: 1,
  workspace: { width: 100, height: 100 },
  elements: { e_s: { type: "svgAsset", assetId: ID_A }, e_v: { type: "valueText", props: { value: { base: null, binding: { expr: 'tel("constructor") + out("__proto__")' } } } } },
  children: ["e_s", "e_v"],
  variants: { "cam-other": {} },
};

describe("hostile exchange packages", () => {
  it("prototype keys anywhere in the package never pollute objects and never resolve", async () => {
    const doc = JSON.stringify(docWithAsset).replace('"elements":{', '"elements":{"__proto__":{"type":"rect","polluted":true},"constructor":{"type":"rect"},');
    const parsed = parsePackage(pkgText(doc, { [ID_A]: { svg: CLEAN_SVG }, __proto__: { svg: "x" } }, '"__proto__":{"polluted":true},'));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty("polluted");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // Unreferenced "__proto__" element and "constructor" element are ordinary keys of a prototype-less copy.
    expect(Object.getPrototypeOf(parsed.package.document.elements)).toBeNull();
    const { upload } = server("sanitize");
    const prepared = await prepareImport(parsed.package, upload, parsed.issues);
    // Dangling element ids are structure errors at most, never a crash.
    if (!prepared.ok) {
      expect(prepared.code).toBe("PKG_DOCUMENT_INVALID");
      return;
    }
    const mapping = suggestMapping(prepared.import, target);
    expect(Object.keys(mapping.telemetry)).toEqual([]);
    expect(Object.keys(mapping.outputs)).toEqual([]);
    const evaluation = evaluateImport(prepared.import, mapping, target);
    expect(evaluation.canPublish).toBe(false);
  });

  it("source names like constructor/__proto__ stay unresolved and block publishing", async () => {
    const parsed = parsePackage(pkgText(docWithAsset, { [ID_A]: { svg: CLEAN_SVG } }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const { upload } = server("sanitize");
    const prepared = await prepareImport(parsed.package, upload);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const evaluation = evaluateImport(prepared.import, suggestMapping(prepared.import, target), target);
    expect(evaluation.unresolved.map((u) => `${u.kind}:${u.name}`).sort()).toEqual(["output:__proto__", "telemetry:constructor"]);
    expect(evaluation.canSave).toBe(true);
    expect(evaluation.canPublish).toBe(false);
    expect(evaluation.blocking.map((d) => d.code)).toContain("OVL_REF_UNKNOWN_SOURCE");
  });

  it("embedded assets always go through the server; only the server's output is used", async () => {
    const parsed = parsePackage(pkgText(docWithAsset, { [ID_A]: { svg: HOSTILE_SVG } }));
    if (!parsed.ok) throw new Error("parse");
    const sanitizing = server("sanitize");
    const prepared = await prepareImport(parsed.package, sanitizing.upload);
    if (!prepared.ok) throw new Error("prepare");
    expect(sanitizing.sent).toEqual([HOSTILE_SVG]);
    // The package's asset id is not trusted: the server id replaces it.
    expect(Object.keys(prepared.import.assets)).toEqual([ID_SERVER]);
    expect(JSON.stringify(prepared.import)).not.toContain("<script");
    expect(JSON.stringify(prepared.import)).not.toContain("onload");
    expect((prepared.import.document.elements.e_s as { assetId: string }).assetId).toBe(ID_SERVER);
  });

  it("a refused asset stays an unresolved reference and its text is dropped", async () => {
    const parsed = parsePackage(pkgText(docWithAsset, { [ID_A]: { svg: HOSTILE_SVG } }));
    if (!parsed.ok) throw new Error("parse");
    const refusing = server("reject");
    const prepared = await prepareImport(parsed.package, refusing.upload);
    if (!prepared.ok) throw new Error("prepare");
    expect(prepared.import.assetIssues).toEqual([{ code: "ASSET_REJECTED", ref: ID_A, reason: "SVG_REJECTED_PARSE" }]);
    expect(prepared.import.assets).toEqual({});
    expect(JSON.stringify(prepared.import)).not.toContain("<script");
    const evaluation = evaluateImport(prepared.import, suggestMapping(prepared.import, target), target);
    expect(evaluation.unresolved).toContainEqual({ kind: "asset", name: ID_A, uses: 1 });
    expect(evaluation.canPublish).toBe(false);
  });

  it("a foreign stream variant is mapped only by an unambiguous display name, otherwise it stays unresolved", async () => {
    const parsed = parsePackage(pkgText(docWithAsset, { [ID_A]: { svg: CLEAN_SVG } }));
    if (!parsed.ok) throw new Error("parse");
    const prepared = await prepareImport(parsed.package, server("sanitize").upload);
    if (!prepared.ok) throw new Error("prepare");
    expect(suggestMapping(prepared.import, target).streams).toEqual({ "cam-other": "front" });
    const twoFronts: VehicleSources = { ...target, streams: [{ streamId: "f1", name: "Front" }, { streamId: "f2", name: "Front" }] };
    expect(Object.keys(suggestMapping(prepared.import, twoFronts).streams)).toEqual([]);
  });

  it("references to assets that are not in the package are never fetched elsewhere", async () => {
    const parsed = parsePackage(pkgText(docWithAsset, {}));
    if (!parsed.ok) throw new Error("parse");
    const recording = server("sanitize");
    const prepared = await prepareImport(parsed.package, recording.upload);
    if (!prepared.ok) throw new Error("prepare");
    expect(recording.sent).toEqual([]);
    expect(prepared.import.assetIssues).toEqual([{ code: "ASSET_MISSING", ref: ID_A }]);
  });

  it("too many elements in a view are refused before anything is uploaded", async () => {
    const elements: Record<string, unknown> = { e_s: { type: "svgAsset", assetId: ID_A } };
    const children = ["e_s"];
    for (let i = 0; i < 500; i++) {
      elements[`e_${i}`] = { type: "rect" };
      children.push(`e_${i}`);
    }
    const parsed = parsePackage(pkgText({ ...docWithAsset, elements, children, variants: {} }, { [ID_A]: { svg: CLEAN_SVG } }));
    if (!parsed.ok) throw new Error("parse");
    const recording = server("sanitize");
    const prepared = await prepareImport(parsed.package, recording.upload);
    expect(prepared.ok).toBe(false);
    expect(!prepared.ok && prepared.diagnostics.map((d) => d.code)).toContain("OVL_LIMIT_EXCEEDED");
    expect(recording.sent).toEqual([]);
  });
});
