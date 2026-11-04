// AP07 – normalized SVG assets as returned by POST …/overlay/assets
// (Shared/Overlay/svg/README.md §4, §6; api/README.md §3).

export type SvgReportCode =
  | "SVG_REMOVED_ELEMENT"
  | "SVG_REMOVED_ATTRIBUTE"
  | "SVG_EXTERNAL_REFERENCE"
  | "SVG_UNSUPPORTED_CSS"
  | "SVG_FONT_MAPPED"
  | "SVG_UNIT_CONVERTED"
  | "SVG_METADATA_REMOVED"
  | "SVG_REJECTED_DOCTYPE"
  | "SVG_REJECTED_LIMIT"
  | "SVG_REJECTED_PARSE"
  | "SVG_REJECTED_EMPTY"
  | "SVG_REJECTED_USE_CYCLE";

export interface SvgReportEntry {
  code: SvgReportCode | string;
  count: number;
  examples: string[];
}

export interface SvgAssetPart {
  tag: string;
  /** Conservative box [x, y, w, h] in the coordinate system of the part's parent. */
  bbox: [number, number, number, number];
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

export interface SvgAssetMetadata {
  assetId: string;
  width: number;
  height: number;
  /** In document order. */
  parts: Record<string, SvgAssetPart>;
}

/** Accepted upload: a pending asset until a saved draft refers to it. */
export interface AssetUploadResult {
  assetId: string;
  metadata: SvgAssetMetadata;
  /** Normalized, server-sanitized output; the only form ever shown. */
  svg: string;
  report: SvgReportEntry[];
}

/** What the import preview shows. */
export type SvgImportState =
  | { kind: "uploading"; fileName?: string }
  | { kind: "accepted"; fileName?: string; result: AssetUploadResult }
  | { kind: "rejected"; fileName?: string; code: string; report: SvgReportEntry[] }
  | { kind: "failed"; fileName?: string; code?: string; status?: number };
