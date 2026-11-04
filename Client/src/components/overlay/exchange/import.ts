// AP12 – safe package import (Shared/Overlay/svg/README.md §7, D19, D34):
// 1. parsePackage (limits, format), 2. prepareImport: AP01 structure check and
// re-sanitizing every referenced asset on the server (changed ids are replaced),
// 3. evaluateImport: stream/channel mapping and the diagnostics on the target
// vehicle, 4. commitImport: one undoable replaceDocument. Never publishes.
import { uploadSvgAsset } from "../assets/svg-asset";
import type { SvgImportState } from "../assets/types";
import { dict } from "../document/dict";
import type { AssetMetadata, Diagnostic, OverlayDocument, ResolveContext, TelemetryDataType } from "../document/types";
import { canPublish, canSave, validate } from "../document/validate";
import type { EditorStore } from "../editor/core/store";
import { CommandError, type DispatchResult } from "../editor/core/types";
import { referencedAssets } from "../editor/persistence/backup";
import { expressionAnalyzer } from "../expression";
import type { RuntimeAsset } from "../runtime/types";
import type { OverlayPackage, PackageIssue, PackageSource, VehicleSources } from "./package";
import { applyReferenceMapping, collectReferences, MappingError, type DocumentReferences } from "./references";

/** Sends one SVG text through the normal server sanitizer (POST …/overlay/assets, AP07). */
export type AssetUploader = (svg: string) => Promise<SvgImportState>;

export function httpAssetUploader(carId: number, fetchImpl?: typeof fetch): AssetUploader {
  return (svg) => uploadSvgAsset(carId, new File([svg], "asset.svg", { type: "image/svg+xml" }), fetchImpl);
}

export type AssetIssue =
  /** Referenced, but not contained in the package. */
  | { code: "ASSET_MISSING"; ref: string }
  /** Refused by the sanitizer (code SVG_REJECTED_*). */
  | { code: "ASSET_REJECTED"; ref: string; reason: string }
  /** Upload failed (network, permission); the reference stays unresolved. */
  | { code: "ASSET_FAILED"; ref: string; reason?: string };

export interface PreparedImport {
  kind: OverlayPackage["kind"];
  exportedAt: string;
  baseRevision?: number;
  source: PackageSource;
  /** Document with the asset ids of the server's sanitized assets. */
  document: OverlayDocument;
  /** Sanitized assets by (new) id, for preview, geometry and the editor host. */
  assets: Record<string, RuntimeAsset>;
  assetIssues: AssetIssue[];
  packageIssues: PackageIssue[];
  references: DocumentReferences;
}

export type PrepareResult =
  | { ok: true; import: PreparedImport }
  | { ok: false; code: "PKG_DOCUMENT_INVALID"; diagnostics: Diagnostic[] };

/**
 * Checks the document's structure (AP01) and re-sanitizes every referenced
 * asset of the package on the server. Unreferenced package assets are not
 * uploaded. Assets the server refuses stay unresolved references.
 */
export async function prepareImport(pkg: OverlayPackage, upload: AssetUploader, packageIssues: PackageIssue[] = []): Promise<PrepareResult> {
  const structure = validate(pkg.document);
  if (!canSave(structure)) return { ok: false, code: "PKG_DOCUMENT_INVALID", diagnostics: structure.filter((d) => d.category === "structure") };

  const assets = dict<RuntimeAsset>();
  const renamed = dict<string>();
  const assetIssues: AssetIssue[] = [];
  for (const id of referencedAssets(pkg.document)) {
    const entry = pkg.assets[id];
    if (!entry) {
      assetIssues.push({ code: "ASSET_MISSING", ref: id });
      continue;
    }
    const state = await upload(entry.svg);
    if (state.kind === "accepted") {
      const { assetId, svg, metadata } = state.result;
      if (assetId !== id) renamed[id] = assetId;
      assets[assetId] = { svg, metadata: { width: metadata.width, height: metadata.height, parts: metadata.parts } };
    } else if (state.kind === "rejected") {
      assetIssues.push({ code: "ASSET_REJECTED", ref: id, reason: state.code });
    } else {
      assetIssues.push({ code: "ASSET_FAILED", ref: id, reason: state.kind === "failed" ? state.code ?? (state.status ? `HTTP ${state.status}` : undefined) : undefined });
    }
  }
  const document = Object.keys(renamed).length > 0 ? applyReferenceMapping(pkg.document, { assets: renamed }) : pkg.document;
  return {
    ok: true,
    import: {
      kind: pkg.kind,
      exportedAt: pkg.exportedAt,
      ...(pkg.baseRevision !== undefined ? { baseRevision: pkg.baseRevision } : {}),
      source: pkg.source,
      document,
      assets,
      assetIssues,
      packageIssues,
      references: collectReferences(document),
    },
  };
}

/** Old name → new name; an empty or missing entry keeps the name. */
export interface ImportMapping {
  telemetry: Record<string, string>;
  outputs: Record<string, string>;
  streams: Record<string, string>;
}

/**
 * Proposal: same name on the target, else (streams) the same display name.
 * Nothing is guessed beyond that; the user decides in the dialog.
 */
export function suggestMapping(prepared: PreparedImport, target: VehicleSources): ImportMapping {
  const tel = new Set(target.telemetry.map((t) => t.name));
  const out = new Set(target.outputs);
  const streams = new Set(target.streams.map((s) => s.streamId));
  const mapping: ImportMapping = { telemetry: dict(), outputs: dict(), streams: dict() };
  for (const name of Object.keys(prepared.references.telemetry)) if (tel.has(name)) mapping.telemetry[name] = name;
  for (const name of Object.keys(prepared.references.outputs)) if (out.has(name)) mapping.outputs[name] = name;
  const taken = new Set<string>();
  for (const id of prepared.references.streams) {
    if (streams.has(id)) {
      mapping.streams[id] = id;
      taken.add(id);
    }
  }
  for (const id of prepared.references.streams) {
    if (mapping.streams[id]) continue;
    const name = prepared.source.streams.find((s) => s.streamId === id)?.name;
    const match = name ? target.streams.filter((s) => s.name === name && !taken.has(s.streamId)) : [];
    if (match.length === 1) {
      mapping.streams[id] = match[0].streamId;
      taken.add(match[0].streamId);
    }
  }
  return mapping;
}

export interface UnresolvedReference {
  kind: "telemetry" | "output" | "stream" | "asset";
  name: string;
  uses: number;
}

export interface ImportEvaluation {
  document: OverlayDocument;
  diagnostics: Diagnostic[];
  /** `publish` diagnostics: saving works, publishing stays blocked. */
  blocking: Diagnostic[];
  /** References that do not exist on the target after the mapping. */
  unresolved: UnresolvedReference[];
  canSave: boolean;
  canPublish: boolean;
  /** Mapping error, e.g. two variants onto one stream. */
  error?: { code: "STREAM_TARGET_TWICE"; ref: string };
}

const DATA_TYPES = new Set<TelemetryDataType>(["String", "Integer", "Number", "Boolean", "LidarGrid"]);

/** Resolve context of the target vehicle (sources, streams, imported assets, AP06 analyzer). */
export function targetContext(target: VehicleSources, assets: Record<string, RuntimeAsset>): ResolveContext {
  const telemetry = dict<TelemetryDataType>();
  for (const t of target.telemetry) telemetry[t.name] = DATA_TYPES.has(t.dataType as TelemetryDataType) ? (t.dataType as TelemetryDataType) : "String";
  const metadata = dict<AssetMetadata>();
  for (const [id, a] of Object.entries(assets)) {
    metadata[id] = { ...(a.metadata ?? { width: 0, height: 0, parts: {} }), sizeBytes: new TextEncoder().encode(a.svg).length };
  }
  return {
    streams: target.streams.map((s) => s.streamId),
    sources: { telemetry, outputs: [...target.outputs] },
    assets: metadata,
    expressions: expressionAnalyzer,
  };
}

const cleanMap = (m: Record<string, string>) => {
  const out = dict<string>();
  for (const [k, v] of Object.entries(m)) if (v) out[k] = v;
  return out;
};

export function evaluateImport(prepared: PreparedImport, mapping: ImportMapping, target: VehicleSources): ImportEvaluation {
  let document: OverlayDocument;
  let error: ImportEvaluation["error"];
  try {
    document = applyReferenceMapping(prepared.document, {
      telemetry: cleanMap(mapping.telemetry),
      outputs: cleanMap(mapping.outputs),
      streams: cleanMap(mapping.streams),
    });
  } catch (e) {
    if (!(e instanceof MappingError)) throw e;
    document = prepared.document;
    error = { code: e.code, ref: e.ref };
  }
  const diagnostics = validate(document, targetContext(target, prepared.assets));
  const refs = collectReferences(document);
  const tel = new Set(target.telemetry.map((t) => t.name));
  const out = new Set(target.outputs);
  const streams = new Set(target.streams.map((s) => s.streamId));
  const unresolved: UnresolvedReference[] = [
    ...Object.entries(refs.telemetry).filter(([n]) => !tel.has(n)).map(([name, uses]) => ({ kind: "telemetry" as const, name, uses })),
    ...Object.entries(refs.outputs).filter(([n]) => !out.has(n)).map(([name, uses]) => ({ kind: "output" as const, name, uses })),
    ...refs.streams.filter((s) => !streams.has(s)).map((name) => ({ kind: "stream" as const, name, uses: 1 })),
    ...refs.assets.filter((a) => !prepared.assets[a]).map((name) => ({ kind: "asset" as const, name, uses: 1 })),
  ];
  return {
    document,
    diagnostics,
    blocking: diagnostics.filter((d) => d.category === "publish"),
    unresolved,
    canSave: !error && canSave(diagnostics),
    canPublish: !error && canPublish(diagnostics),
    ...(error ? { error } : {}),
  };
}

/**
 * Replaces the draft with the imported document as one undo step (D19). The
 * autosave stores it with the next PUT; publishing stays a separate action.
 */
export function commitImport(store: EditorStore, evaluation: ImportEvaluation): DispatchResult {
  if (!evaluation.canSave) return { ok: false, error: new CommandError("OVL_IMPORT_INVALID", "Paket ergibt keinen speicherbaren Entwurf") };
  return store.dispatch({ type: "replaceDocument", document: evaluation.document, reason: "import" }, { label: "Paket importieren" });
}
