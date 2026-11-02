// AP12 – exchange package (Shared/Overlay/svg/README.md §7, D34): one JSON file
// with document and sanitized assets. Export and the conflict backup of AP09
// share the format (editor/persistence/backup.ts); a backup can be imported
// like an export.
import { detach, dict } from "../document/dict";
import type { OverlayDocument } from "../document/types";
import { backupPackage, referencedAssets, type OverlayPackage, type PackageSource } from "../editor/persistence/backup";
import { collectReferences } from "./references";

export type { OverlayPackage, PackageSource };

export const PACKAGE_FORMAT = "signalrc-overlay-package";
export const LIMITS = {
  fileBytes: 13 * 1024 * 1024,
  documentBytes: 2 * 1024 * 1024,
  assetBytes: 10 * 1024 * 1024,
};

const ASSET_ID = /^sha256-[0-9a-f]{64}$/;

/** Byte length of a string in UTF-8. */
export const utf8Bytes = (text: string) => new TextEncoder().encode(text).length;

/** What the target (or source) vehicle offers; filled from GET …/overlay/sources and the stream list. */
export interface VehicleSources {
  telemetry: { name: string; dataType: string; unit?: string | null }[];
  outputs: string[];
  streams: PackageSource["streams"];
}

/**
 * `source` block of a package: only what the document refers to, with the
 * exporting vehicle's metadata as a hint for the mapping on import.
 */
export function packageSourceFor(doc: OverlayDocument, vehicle: VehicleSources): PackageSource {
  const refs = collectReferences(doc);
  const tel = new Map(vehicle.telemetry.map((t) => [t.name, t]));
  const streams = new Map(vehicle.streams.map((s) => [s.streamId, s]));
  return {
    streams: refs.streams.map((id) => detach(streams.get(id) ?? { streamId: id })),
    telemetry: Object.keys(refs.telemetry).sort().map((name) => {
      const t = tel.get(name);
      return t ? { name, dataType: t.dataType, unit: t.unit ?? null } : { name };
    }),
    outputs: Object.keys(refs.outputs).sort(),
  };
}

export type ExportResult =
  | { ok: true; package: OverlayPackage }
  | { ok: false; code: "PKG_ASSETS_MISSING"; missing: string[] };

/**
 * Export package: standard, variants, signals, bindings, clips and every
 * referenced asset. The document carries no live values, personal settings,
 * permissions or credentials; revision and publication identity stay out.
 */
export function exportPackage(doc: OverlayDocument, assetTexts: Record<string, string>, vehicle: VehicleSources, at = new Date()): ExportResult {
  const missing = referencedAssets(doc).filter((id) => assetTexts[id] === undefined);
  if (missing.length > 0) return { ok: false, code: "PKG_ASSETS_MISSING", missing };
  const pkg = backupPackage(detach(doc), undefined, assetTexts, packageSourceFor(doc, vehicle), at);
  pkg.kind = "export";
  return { ok: true, package: pkg };
}

/** Texts of all referenced assets: known ones first, the rest from the server (AP02 `GET assets/{id}`). */
export async function collectAssetTexts(
  doc: OverlayDocument,
  known: Record<string, string>,
  getAsset: (assetId: string) => Promise<string>,
): Promise<{ texts: Record<string, string>; missing: string[] }> {
  const texts = dict<string>();
  const missing: string[] = [];
  for (const id of referencedAssets(doc)) {
    if (known[id] !== undefined) {
      texts[id] = known[id];
      continue;
    }
    try {
      texts[id] = await getAsset(id);
    } catch {
      missing.push(id);
    }
  }
  return { texts, missing };
}

export function serializePackage(pkg: OverlayPackage): string {
  return JSON.stringify(pkg, null, 2);
}

// --- Reading ---

export type PackageErrorCode =
  | "PKG_TOO_LARGE" | "PKG_PARSE" | "PKG_FORMAT" | "PKG_VERSION" | "PKG_DOCUMENT_TOO_LARGE" | "PKG_ASSETS_TOO_LARGE";

export type PackageIssue =
  /** An asset entry that is not usable; it is ignored. */
  | { code: "PKG_ASSET_INVALID"; ref: string };

export type ParseResult =
  | { ok: true; package: OverlayPackage; issues: PackageIssue[] }
  | { ok: false; code: PackageErrorCode };

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function readSource(raw: unknown): PackageSource {
  const r = isObject(raw) ? raw : {};
  const list = (v: unknown) => (Array.isArray(v) ? v : []);
  const streams = list(r.streams).filter(isObject).filter((s) => typeof s.streamId === "string").map((s) => {
    const out: PackageSource["streams"][number] = { streamId: s.streamId as string };
    if (str(s.name) !== undefined) out.name = s.name as string;
    if (num(s.width) !== undefined) out.width = s.width as number;
    if (num(s.height) !== undefined) out.height = s.height as number;
    return out;
  });
  const telemetry = list(r.telemetry).filter(isObject).filter((t) => typeof t.name === "string").map((t) => {
    const out: PackageSource["telemetry"][number] = { name: t.name as string };
    if (str(t.dataType) !== undefined) out.dataType = t.dataType as string;
    if (t.unit === null || str(t.unit) !== undefined) out.unit = t.unit as string | null;
    return out;
  });
  const outputs = list(r.outputs).filter((o): o is string => typeof o === "string");
  return { streams, telemetry, outputs };
}

/**
 * Parses and checks a package file (step 1 of the import): size limits, format
 * and version. The document itself is checked by the AP01 validation, the
 * assets by the server sanitizer.
 */
export function parsePackage(text: string): ParseResult {
  if (utf8Bytes(text) > LIMITS.fileBytes) return { ok: false, code: "PKG_TOO_LARGE" };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, code: "PKG_PARSE" };
  }
  if (!isObject(raw) || raw.format !== PACKAGE_FORMAT || !isObject(raw.document)) return { ok: false, code: "PKG_FORMAT" };
  if (raw.formatVersion !== 1) return { ok: false, code: "PKG_VERSION" };
  if (raw.kind !== "export" && raw.kind !== "backup") return { ok: false, code: "PKG_FORMAT" };
  if (utf8Bytes(JSON.stringify(raw.document)) > LIMITS.documentBytes) return { ok: false, code: "PKG_DOCUMENT_TOO_LARGE" };

  const issues: PackageIssue[] = [];
  const assets = dict<{ svg: string }>();
  let assetBytes = 0;
  for (const [id, entry] of Object.entries(isObject(raw.assets) ? raw.assets : {})) {
    if (!ASSET_ID.test(id) || !isObject(entry) || typeof entry.svg !== "string") {
      issues.push({ code: "PKG_ASSET_INVALID", ref: id });
      continue;
    }
    assetBytes += utf8Bytes(entry.svg);
    assets[id] = { svg: entry.svg };
  }
  if (assetBytes > LIMITS.assetBytes) return { ok: false, code: "PKG_ASSETS_TOO_LARGE" };

  const pkg: OverlayPackage = {
    format: PACKAGE_FORMAT,
    formatVersion: 1,
    kind: raw.kind,
    exportedAt: str(raw.exportedAt) ?? "",
    source: readSource(raw.source),
    document: detach(raw.document) as unknown as OverlayDocument,
    assets,
  };
  if (raw.kind === "backup" && num(raw.baseRevision) !== undefined) pkg.baseRevision = raw.baseRevision as number;
  return { ok: true, package: pkg, issues };
}
