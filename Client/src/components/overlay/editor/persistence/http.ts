// HTTP adapter of the persistence port against the AP02 API
// (Shared/Overlay/api/README.md §3, §4). Events come from the CarConnectionHub
// via SubscribeToOverlay; the hub connection itself is owned by the app (AP13).
import { detach } from "../../document/dict";
import type { Diagnostic, OverlayDocument } from "../../document/types";
import type { HubLike } from "../../sources/hub";
import type { PatchOp } from "../core/json-patch";
import {
  OverlayApiError, type AssetUploadResult, type Draft, type OverlayEvent, type OverlayPersistence, type PublicationInfo, type Published,
} from "./types";

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpPersistenceOptions {
  fetch?: Fetch;
  /** Prefix for absolute server URLs (tests); empty in the browser. */
  baseUrl?: string;
  /** Hub for OverlayDraftChanged/OverlayPublished; without it there are no events. */
  hub?: HubLike;
  /** Request bodies from this size on are sent gzip-compressed when the browser can (D63). */
  gzipFromBytes?: number;
}

async function gzip(text: string): Promise<Uint8Array | undefined> {
  if (typeof CompressionStream !== "function") return undefined;
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export class HttpOverlayPersistence implements OverlayPersistence {
  private readonly fetchImpl: Fetch;
  private readonly base: string;
  private readonly hub?: HubLike;
  private readonly gzipFrom: number;

  constructor(options: HttpPersistenceOptions = {}) {
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.base = options.baseUrl ?? "";
    this.hub = options.hub;
    this.gzipFrom = options.gzipFromBytes ?? 32 * 1024;
  }

  private url(carId: number, path: string) {
    return `${this.base}/api/cars/${carId}/overlay/${path}`;
  }

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, { credentials: "same-origin", ...init });
    } catch (e) {
      throw new OverlayApiError(0, undefined, `Keine Verbindung: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (res.ok) return res;
    let body: { code?: string; title?: string; currentRevision?: number; diagnostics?: Diagnostic[] } | undefined;
    try {
      body = await res.json();
    } catch { /* not a problem document */ }
    throw new OverlayApiError(res.status, body?.code, body?.title ?? `HTTP ${res.status}`, body?.currentRevision, body?.diagnostics);
  }

  private async json<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await this.request(url, init);
    return (await res.json()) as T;
  }

  private async body(text: string, type: string): Promise<{ body: BodyInit; headers: Record<string, string> }> {
    if (text.length >= this.gzipFrom) {
      const packed = await gzip(text);
      if (packed) return { body: packed as unknown as BodyInit, headers: { "Content-Type": type, "Content-Encoding": "gzip" } };
    }
    return { body: text, headers: { "Content-Type": type } };
  }

  async getPublished(carId: number): Promise<Published | null> {
    const res = await this.request(this.url(carId, "published"));
    if (res.status === 204) return null;
    const p = (await res.json()) as Published;
    return { ...p, document: detach(p.document) };
  }

  async getDraft(carId: number): Promise<Draft> {
    const d = await this.json<Draft>(this.url(carId, "draft"));
    return { ...d, document: detach(d.document) };
  }

  async saveDraft(carId: number, doc: OverlayDocument, baseRevision: number): Promise<{ revision: number }> {
    const { body, headers } = await this.body(JSON.stringify(doc), "application/json");
    return this.json(this.url(carId, "draft"), { method: "PUT", body, headers: { ...headers, "If-Match": `"${baseRevision}"` } });
  }

  async patchDraft(carId: number, ops: PatchOp[], baseRevision: number): Promise<{ revision: number }> {
    const { body, headers } = await this.body(JSON.stringify(ops), "application/json-patch+json");
    return this.json(this.url(carId, "draft"), { method: "PATCH", body, headers: { ...headers, "If-Match": `"${baseRevision}"` } });
  }

  publish(carId: number, baseRevision: number, note?: string) {
    return this.json<{ publicationId: number; number: number; warnings?: Diagnostic[] }>(this.url(carId, "publications"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(note === undefined ? { baseRevision } : { baseRevision, note }),
    });
  }

  listPublications(carId: number): Promise<PublicationInfo[]> {
    return this.json(this.url(carId, "publications"));
  }

  restore(carId: number, publicationId: number, baseRevision: number): Promise<{ revision: number }> {
    return this.json(this.url(carId, "draft/restore"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publicationId, baseRevision }),
    });
  }

  uploadAsset(carId: number, file: Blob): Promise<AssetUploadResult> {
    const form = new FormData();
    form.append("file", file, "asset.svg");
    return this.json(this.url(carId, "assets"), { method: "POST", body: form });
  }

  async getAsset(carId: number, assetId: string): Promise<string> {
    const res = await this.request(this.url(carId, `assets/${encodeURIComponent(assetId)}`));
    return res.text();
  }

  onEvent(carId: number, cb: (e: OverlayEvent) => void): () => void {
    const hub = this.hub;
    if (!hub) return () => {};
    let active = true;
    const subscribe = () => hub.invoke("SubscribeToOverlay", carId).catch(() => { /* retried on reconnect */ });
    const onDraft = (e: { carId: number; revision: number }) => {
      if (active && e?.carId === carId) cb({ type: "draftChanged", carId, revision: e.revision });
    };
    const onPublished = (e: { carId: number; publicationId: number; number: number }) => {
      if (active && e?.carId === carId) cb({ type: "published", carId, publicationId: e.publicationId, number: e.number });
    };
    hub.on("OverlayDraftChanged", onDraft);
    hub.on("OverlayPublished", onPublished);
    // HubLike offers no way to remove reconnect callbacks; `active` silences them.
    hub.onreconnected?.(() => {
      if (!active) return;
      void subscribe().then(() => { if (active) cb({ type: "reconnected", carId }); });
    });
    void subscribe();
    return () => {
      active = false;
      hub.off("OverlayDraftChanged", onDraft);
      hub.off("OverlayPublished", onPublished);
    };
  }
}
