// AP09 – client side of the persistence port (Shared/Overlay/modules/README.md §1
// OverlayPersistence, api/README.md §3–§5).
import type { AssetMetadata, Diagnostic, OverlayDocument } from "../../document/types";
import type { PatchOp } from "../core/json-patch";

export interface Published {
  publicationId: number;
  number: number;
  publishedAt: string;
  document: OverlayDocument;
}

export interface Draft {
  revision: number;
  document: OverlayDocument;
  updatedAt?: string | null;
  updatedBy?: string | null;
  /** Stored metadata of the vehicle's assets the draft references (api/README.md §3); missing ones are left out. */
  assets?: Record<string, AssetMetadata>;
}

export interface PublicationInfo {
  id: number;
  number: number;
  publishedAt: string;
  publishedBy?: string | null;
  note?: string | null;
}

export interface AssetUploadResult {
  assetId: string;
  metadata: AssetMetadata;
  svg: string;
  report: unknown;
}

export type OverlayEvent =
  | { type: "draftChanged"; carId: number; revision: number }
  | { type: "published"; carId: number; publicationId: number; number: number }
  /** The event connection was re-established; events may have been missed. */
  | { type: "reconnected"; carId: number };

/** Problem document of the API (api/README.md §3); status 0 = no response (network). */
export class OverlayApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
    readonly currentRevision?: number,
    readonly diagnostics?: Diagnostic[],
  ) {
    super(message);
  }

  get isNetwork() {
    return this.status === 0;
  }
}

export interface OverlayPersistence {
  getPublished(carId: number): Promise<Published | null>;
  getDraft(carId: number): Promise<Draft>;
  saveDraft(carId: number, doc: OverlayDocument, baseRevision: number): Promise<{ revision: number }>;
  /** D63: only the difference to the confirmed revision. */
  patchDraft(carId: number, ops: PatchOp[], baseRevision: number): Promise<{ revision: number }>;
  publish(carId: number, baseRevision: number, note?: string): Promise<{ publicationId: number; number: number; warnings?: Diagnostic[] }>;
  listPublications(carId: number): Promise<PublicationInfo[]>;
  restore(carId: number, publicationId: number, baseRevision: number): Promise<{ revision: number }>;
  uploadAsset(carId: number, file: Blob): Promise<AssetUploadResult>;
  getAsset(carId: number, assetId: string): Promise<string>;
  onEvent(carId: number, cb: (e: OverlayEvent) => void): () => void;
}
