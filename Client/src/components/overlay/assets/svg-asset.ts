// Helpers around normalized SVG assets. They never sanitize: the server is
// the only authority (svg/README.md §1). Client checks are defense in depth.
import type { AssetUploadResult, SvgImportState, SvgReportEntry } from "./types";

const PROLOGUE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ';
const ELEMENT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const ASSET_ID = /^sha256-[0-9a-f]{64}$/;

/** True for the canonical form the server writes; anything else is not displayed. */
export function isNormalizedAssetSvg(svg: unknown): svg is string {
  return typeof svg === "string" && svg.startsWith(PROLOGUE) && svg.endsWith("</svg>") && !/<!|<\?/.test(svg);
}

/**
 * Renderer rule (§5, AP08): before embedding an asset as an inline fragment,
 * every internal id `r<n>` and every `url(#r<n>)` gets the prefix
 * `ovl-<elementId>-`, so several instances of the same asset never collide.
 * Part markers (`data-part`) stay unchanged; select parts with
 * `[data-part="<id>"]` inside the element's own container.
 */
export function scopeAssetSvg(svg: string, elementId: string): string {
  if (!ELEMENT_ID.test(elementId)) throw new Error(`invalid element id: ${elementId}`);
  if (!isNormalizedAssetSvg(svg)) throw new Error("not a normalized asset");
  const prefix = `ovl-${elementId}-`;
  return svg
    .replace(/ id="(r[1-9][0-9]*)"/g, (_, id: string) => ` id="${prefix}${id}"`)
    .replace(/url\(#(r[1-9][0-9]*)\)/g, (_, id: string) => `url(#${prefix}${id})`);
}

/** Scoped id of an internal reference, e.g. for tests or DOM lookups. */
export function scopedRefId(elementId: string, refId: string): string {
  return `ovl-${elementId}-${refId}`;
}

/**
 * Image URL for previews. An SVG loaded as an image runs no script and loads
 * no external resource, even if it contained any.
 */
export function assetImageUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function isReport(value: unknown): value is SvgReportEntry[] {
  return Array.isArray(value) && value.every(e =>
    e !== null && typeof e === "object" && typeof (e as SvgReportEntry).code === "string"
    && typeof (e as SvgReportEntry).count === "number" && Array.isArray((e as SvgReportEntry).examples));
}

/** Rejection code of a report: the last SVG_REJECTED_* entry. */
export function rejectionCode(report: SvgReportEntry[]): string | undefined {
  return [...report].reverse().find(e => e.code.startsWith("SVG_REJECTED_"))?.code;
}

/**
 * Maps the HTTP response of POST …/overlay/assets onto the preview state.
 * An accepted body that is not in canonical form is treated as a failure,
 * never displayed.
 */
export function uploadResponseToState(status: number, body: unknown, fileName?: string): SvgImportState {
  const b = (body ?? {}) as Record<string, unknown>;
  if (status === 200) {
    const metadata = b.metadata as AssetUploadResult["metadata"] | undefined;
    if (typeof b.assetId === "string" && ASSET_ID.test(b.assetId) && isNormalizedAssetSvg(b.svg)
      && metadata && typeof metadata === "object" && typeof metadata.width === "number"
      && typeof metadata.height === "number" && metadata.parts && typeof metadata.parts === "object") {
      return {
        kind: "accepted",
        fileName,
        result: { assetId: b.assetId, svg: b.svg, metadata, report: isReport(b.report) ? b.report : [] },
      };
    }
    return { kind: "failed", fileName, status, code: "OVL_API_INVALID_RESPONSE" };
  }
  if (b.code === "OVL_API_ASSET_REJECTED" && isReport(b.report)) {
    return { kind: "rejected", fileName, code: rejectionCode(b.report) ?? "SVG_REJECTED_PARSE", report: b.report };
  }
  return { kind: "failed", fileName, status, code: typeof b.code === "string" ? b.code : undefined };
}

/** Uploads a file and returns the preview state; `fetchImpl` for tests. */
export async function uploadSvgAsset(carId: number, file: File, fetchImpl: typeof fetch = fetch): Promise<SvgImportState> {
  const form = new FormData();
  form.append("file", file);
  try {
    const response = await fetchImpl(`/api/cars/${carId}/overlay/assets`, { method: "POST", body: form, credentials: "include" });
    const body = await response.json().catch(() => null);
    return uploadResponseToState(response.status, body, file.name);
  } catch {
    return { kind: "failed", fileName: file.name };
  }
}
