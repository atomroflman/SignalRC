// AP12 – package export → import round trip, mapping of foreign vehicle
// references, unresolved references and the publish gate (fixtures/exchange).
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { SvgImportState } from "../assets/types";
import type { OverlayDocument } from "../document/types";
import { canPublish, validate } from "../document/validate";
import { EditorStore } from "../editor/core/store";
import { backupPackage } from "../editor/persistence/backup";
import { readContractJson } from "../testing/fixtures";
import { commitImport, evaluateImport, prepareImport, suggestMapping, type AssetUploader, type ImportMapping } from "./import";
import { collectAssetTexts, exportPackage, LIMITS, packageSourceFor, parsePackage, serializePackage, type OverlayPackage, type VehicleSources } from "./package";
import { applyReferenceMapping, collectReferences, renameInFormula } from "./references";

interface Fixture {
  package: OverlayPackage;
  unreferencedAssetId: string;
  target: VehicleSources;
  mapping: ImportMapping;
  expected: OverlayDocument;
  expectedUnresolved: unknown[];
}

const fixture = () => readContractJson<Fixture>("fixtures/exchange/roundtrip.json");
const sha = (svg: string) => `sha256-${createHash("sha256").update(svg, "utf8").digest("hex")}`;

/** Test double of the server sanitizer: normalized input stays as it is (idempotent, svg/README §4). */
function idempotentServer(log: string[] = []): AssetUploader {
  return async (svg): Promise<SvgImportState> => {
    log.push(sha(svg));
    if (!svg.startsWith("<svg xmlns")) return { kind: "rejected", code: "SVG_REJECTED_PARSE", report: [{ code: "SVG_REJECTED_PARSE", count: 1, examples: [] }] };
    const parts: Record<string, { tag: string; bbox: [number, number, number, number] }> = {};
    for (const m of svg.matchAll(/<(\w+) data-part="([^"]+)"/g)) parts[m[2]] = { tag: m[1], bbox: [0, 0, 1, 1] };
    const [, w, h] = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg)!;
    return { kind: "accepted", result: { assetId: sha(svg), svg, metadata: { assetId: sha(svg), width: Number(w), height: Number(h), parts }, report: [] } };
  };
}

async function importFixture(upload = idempotentServer()) {
  const f = fixture();
  const parsed = parsePackage(serializePackage(f.package));
  if (!parsed.ok) throw new Error(parsed.code);
  const prepared = await prepareImport(parsed.package, upload, parsed.issues);
  if (!prepared.ok) throw new Error(prepared.code);
  return { f, prepared: prepared.import };
}

describe("references", () => {
  it("renames only source arguments via the AST", () => {
    const m = { telemetry: { speed: "odo \"x\"" }, outputs: { steer: "steering" } };
    expect(renameInFormula('tel("speed") + tel( "speed" ) * 2', m)).toBe('tel("odo \\"x\\"") + tel( "odo \\"x\\"" ) * 2');
    expect(renameInFormula('if(out("steer") > 0, "speed", "tel(\\"speed\\")")', m)).toBe('if(out("steering") > 0, "speed", "tel(\\"speed\\")")');
    expect(renameInFormula('sig("speed") + tel("other")', m)).toBe('sig("speed") + tel("other")');
    // Broken formulas stay unchanged; validation reports them.
    expect(renameInFormula('tel("speed" +', m)).toBe('tel("speed" +');
  });

  it("collects every source, stream and asset reference", () => {
    const refs = collectReferences(fixture().package.document);
    expect(refs.telemetry).toEqual({ speed: 8, scan: 1, legacy: 1 });
    expect(refs.outputs).toEqual({ steer: 2 });
    expect(refs.streams).toEqual(["cam1"]);
    expect(refs.assets).toHaveLength(2);
  });
});

describe("export", () => {
  it("contains design, variants, bindings, clips and the assets, but no revision or live data", () => {
    const f = fixture();
    const texts = Object.fromEntries(Object.entries(f.package.assets).map(([id, a]) => [id, a.svg]));
    const source: VehicleSources = {
      telemetry: [{ name: "speed", dataType: "Number", unit: "m/s" }, { name: "scan", dataType: "LidarGrid", unit: null }, { name: "unrelated", dataType: "Number" }],
      outputs: ["steer", "horn"],
      streams: [{ streamId: "cam1", name: "Front", width: 1280, height: 720 }, { streamId: "rear", name: "Rear" }],
    };
    const r = exportPackage(f.package.document, texts, source, new Date("2026-11-02T10:00:00Z"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.package.kind).toBe("export");
    expect(r.package.baseRevision).toBeUndefined();
    expect(r.package.document).toEqual(f.package.document);
    // Only referenced assets; unreferenced package entries are not exported.
    expect(Object.keys(r.package.assets).sort()).toEqual(collectReferences(f.package.document).assets);
    // Only referenced sources go into the source block.
    expect(r.package.source).toEqual({
      streams: [{ streamId: "cam1", name: "Front", width: 1280, height: 720 }],
      telemetry: [{ name: "legacy" }, { name: "scan", dataType: "LidarGrid", unit: null }, { name: "speed", dataType: "Number", unit: "m/s" }],
      outputs: ["steer"],
    });
    expect(Object.keys(r.package).sort()).toEqual(["assets", "document", "exportedAt", "format", "formatVersion", "kind", "source"]);
  });

  it("refuses to export when an asset text is missing and fetches unknown ones", async () => {
    const f = fixture();
    const [a, b] = collectReferences(f.package.document).assets;
    expect(exportPackage(f.package.document, { [a]: f.package.assets[a].svg }, { telemetry: [], outputs: [], streams: [] }))
      .toEqual({ ok: false, code: "PKG_ASSETS_MISSING", missing: [b] });
    const fetched: string[] = [];
    const got = await collectAssetTexts(f.package.document, { [a]: f.package.assets[a].svg }, async (id) => {
      fetched.push(id);
      if (id === b) return f.package.assets[b].svg;
      throw new Error("404");
    });
    expect(fetched).toEqual([b]);
    expect(got.missing).toEqual([]);
  });
});

describe("import", () => {
  it("round trip export → import keeps the design including assets", async () => {
    const f = fixture();
    const texts = Object.fromEntries(Object.entries(f.package.assets).map(([id, a]) => [id, a.svg]));
    const exported = exportPackage(f.package.document, texts, { telemetry: [], outputs: [], streams: [] });
    if (!exported.ok) throw new Error("export");
    const log: string[] = [];
    const parsed = parsePackage(serializePackage(exported.package));
    if (!parsed.ok) throw new Error(parsed.code);
    const prepared = await prepareImport(parsed.package, idempotentServer(log));
    if (!prepared.ok) throw new Error(prepared.code);
    // Same vehicle: nothing to map, identical document and assets.
    expect(prepared.import.document).toEqual(f.package.document);
    expect(prepared.import.assetIssues).toEqual([]);
    for (const id of collectReferences(f.package.document).assets) expect(prepared.import.assets[id].svg).toBe(f.package.assets[id].svg);
    // Every referenced asset went through the server again, unreferenced ones not.
    expect(log.sort()).toEqual(collectReferences(f.package.document).assets);
  });

  it("maps foreign vehicle references (fixture expectation)", async () => {
    const { f, prepared } = await importFixture();
    const suggestion = suggestMapping(prepared, f.target);
    // Same names only; the stream matches by its display name.
    expect(suggestion).toEqual({ telemetry: {}, outputs: {}, streams: { cam1: "front" } });

    const unmapped = evaluateImport(prepared, suggestion, f.target);
    expect(unmapped.canSave).toBe(true);
    expect(unmapped.canPublish).toBe(false);
    expect(unmapped.blocking.every((d) => d.code === "OVL_REF_UNKNOWN_SOURCE")).toBe(true);
    expect(unmapped.unresolved.map((u) => `${u.kind}:${u.name}`).sort()).toEqual(["output:steer", "telemetry:legacy", "telemetry:scan", "telemetry:speed"]);

    const mapped = evaluateImport(prepared, f.mapping, f.target);
    expect(mapped.document).toEqual(f.expected);
    expect(mapped.unresolved).toEqual(f.expectedUnresolved);
    // The disabled element keeps its unresolved reference only as a warning.
    expect(mapped.blocking).toEqual([]);
    expect(mapped.canPublish).toBe(true);
    expect(mapped.diagnostics.map((d) => d.code)).toEqual(["OVL_REF_UNKNOWN_SOURCE"]);
    expect(mapped.diagnostics[0]).toMatchObject({ category: "warning", location: { element: "e_old" } });
  });

  it("unresolved active references block publishing, also after commit", async () => {
    const { f, prepared } = await importFixture();
    const partial = evaluateImport(prepared, { ...f.mapping, outputs: {} }, f.target);
    expect(partial.canSave).toBe(true);
    expect(partial.canPublish).toBe(false);
    expect(partial.blocking.map((d) => d.location.element ?? d.location.variant).sort()).toEqual(["e_dash", "e_steer"]);

    const store = new EditorStore({ carId: 1, document: { schemaVersion: 1, workspace: { width: 100, height: 100 }, elements: {}, children: [] } });
    const before = store.document;
    expect(commitImport(store, partial).ok).toBe(true);
    expect(store.document).toEqual(partial.document);
    expect(store.replaceCount).toBe(1);
    store.setResolveContext({ ...(await import("./import")).targetContext(f.target, prepared.assets) });
    expect(canPublish(store.diagnostics())).toBe(false);
    // One undo step back to the previous draft (D19).
    store.undo();
    expect(store.document).toEqual(before);
  });

  it("replaces asset ids the server assigns differently and reports refused assets", async () => {
    const f = fixture();
    const a = f.package.document.elements.e_dash.assetId!;
    const b = f.package.document.elements.e_links.assetId!;
    const base = idempotentServer();
    const changed = `${f.package.assets[a].svg.slice(0, -6)}<g/></svg>`;
    const upload: AssetUploader = async (svg) => {
      if (svg === f.package.assets[a].svg) return base(changed);
      if (svg === f.package.assets[b].svg) return { kind: "rejected", code: "SVG_REJECTED_LIMIT", report: [] };
      return base(svg);
    };
    const { prepared, f: fx } = await importFixture(upload);
    expect(prepared.document.elements.e_dash.assetId).toBe(sha(changed));
    expect(prepared.assets[sha(changed)].svg).toBe(changed);
    expect(prepared.assetIssues).toEqual([{ code: "ASSET_REJECTED", ref: b, reason: "SVG_REJECTED_LIMIT" }]);
    const e = evaluateImport(prepared, fx.mapping, fx.target);
    expect(e.unresolved).toContainEqual({ kind: "asset", name: b, uses: 1 });
    expect(e.blocking).toContainEqual(expect.objectContaining({ code: "OVL_REF_UNKNOWN_ASSET", location: expect.objectContaining({ element: "e_links" }) }));
    expect(e.canPublish).toBe(false);
  });

  it("reports missing assets and a stream mapped twice", async () => {
    const f = fixture();
    const [a] = collectReferences(f.package.document).assets;
    const pkg = { ...f.package, assets: { [a]: f.package.assets[a] } };
    const prepared = await prepareImport(pkg, idempotentServer());
    if (!prepared.ok) throw new Error("prepare");
    expect(prepared.import.assetIssues.map((i) => i.code)).toEqual(["ASSET_MISSING"]);

    const doc = applyReferenceMapping(f.package.document, {});
    doc.variants!.cam2 = {};
    const twice = evaluateImport({ ...prepared.import, document: doc, references: collectReferences(doc) },
      { telemetry: {}, outputs: {}, streams: { cam1: "front", cam2: "front" } }, f.target);
    expect(twice.error).toEqual({ code: "STREAM_TARGET_TWICE", ref: "front" });
    expect(twice.canSave).toBe(false);
  });

  it("a conflict backup (AP09) is importable as a draft as well", async () => {
    const f = fixture();
    const texts = Object.fromEntries(Object.entries(f.package.assets).map(([id, a]) => [id, a.svg]));
    const backup = backupPackage(f.package.document, 17, texts, f.package.source);
    const parsed = parsePackage(JSON.stringify(backup));
    expect(parsed.ok && parsed.package.kind === "backup" && parsed.package.baseRevision).toBe(17);
    if (!parsed.ok) return;
    const prepared = await prepareImport(parsed.package, idempotentServer());
    expect(prepared.ok && prepared.import.document).toEqual(f.package.document);
  });
});

describe("package checks", () => {
  it("rejects unusable files before anything is uploaded", () => {
    const f = fixture();
    expect(parsePackage("{")).toEqual({ ok: false, code: "PKG_PARSE" });
    expect(parsePackage(JSON.stringify({ ...f.package, format: "other" }))).toEqual({ ok: false, code: "PKG_FORMAT" });
    expect(parsePackage(JSON.stringify({ ...f.package, formatVersion: 2 }))).toEqual({ ok: false, code: "PKG_VERSION" });
    expect(parsePackage(JSON.stringify({ ...f.package, kind: "publication" }))).toEqual({ ok: false, code: "PKG_FORMAT" });
    expect(parsePackage(" ".repeat(LIMITS.fileBytes + 1))).toEqual({ ok: false, code: "PKG_TOO_LARGE" });
    const bigDoc = { ...f.package, document: { ...f.package.document, signals: { x: { label: "x".repeat(LIMITS.documentBytes) } } } };
    expect(parsePackage(JSON.stringify(bigDoc))).toEqual({ ok: false, code: "PKG_DOCUMENT_TOO_LARGE" });
    const assets: Record<string, { svg: string }> = {};
    for (let i = 0; i < 11; i++) assets[`sha256-${String(i).padStart(64, "0")}`] = { svg: "x".repeat(1024 * 1024) };
    expect(parsePackage(JSON.stringify({ ...f.package, assets }))).toEqual({ ok: false, code: "PKG_ASSETS_TOO_LARGE" });
  });

  it("ignores invalid asset entries and keeps prototype keys harmless", () => {
    const f = fixture();
    const text = serializePackage(f.package).replace('"assets": {', '"assets": { "__proto__": { "svg": "<svg/>" }, "bad": 3,');
    const parsed = parsePackage(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.issues).toEqual([{ code: "PKG_ASSET_INVALID", ref: "__proto__" }, { code: "PKG_ASSET_INVALID", ref: "bad" }]);
    expect(({} as Record<string, unknown>).svg).toBeUndefined();
  });

  it("refuses documents with structure errors and uploads nothing", async () => {
    const f = fixture();
    const log: string[] = [];
    const broken = { ...f.package, document: { ...f.package.document, children: ["e_missing"] } };
    const r = await prepareImport(broken, idempotentServer(log));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.diagnostics.map((d) => d.code)).toContain("OVL_REF_UNKNOWN_ELEMENT");
    expect(log).toEqual([]);
    expect(validate({ ...f.package.document, schemaVersion: 2 })[0].code).toBe("OVL_SCHEMA_UNSUPPORTED");
  });

  it("the source block of a package only names referenced sources", () => {
    const doc: OverlayDocument = { schemaVersion: 1, workspace: { width: 1, height: 1 }, elements: {}, children: [] };
    expect(packageSourceFor(doc, { telemetry: [{ name: "a", dataType: "Number" }], outputs: ["b"], streams: [{ streamId: "c" }] }))
      .toEqual({ streams: [], telemetry: [], outputs: [] });
  });
});
