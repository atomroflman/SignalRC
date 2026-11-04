// Test double of the persistence port (modules/README.md §1 InMemoryOverlayPersistence):
// one in-memory server with revision checks, driver control, events and
// failure injection; several clients (tabs) can share it.
import { detach } from "../../document/dict";
import type { OverlayDocument } from "../../document/types";
import { validate } from "../../document/validate";
import { applyPatch, PatchError, type PatchOp } from "../core/json-patch";
import {
  OverlayApiError, type AssetUploadResult, type Draft, type OverlayEvent, type OverlayPersistence, type PublicationInfo, type Published,
} from "../persistence/types";

export const startDocument = (): OverlayDocument => ({ schemaVersion: 1, workspace: { width: 1920, height: 1080 }, elements: {}, children: [] });

interface Publication extends PublicationInfo {
  document: OverlayDocument;
}

export type Failure = { status: number; code?: string } | "network";

export class InMemoryOverlayServer {
  revision = 0;
  document: OverlayDocument = startDocument();
  /** Whether requests act as the active driver. */
  driver = true;
  readonly publications: Publication[] = [];
  readonly assets = new Map<string, string>();
  readonly log: { method: string; path: string; ifMatch?: number; body?: unknown }[] = [];
  private readonly listeners = new Set<(e: OverlayEvent) => void>();
  private failures: Failure[] = [];
  private held: (() => void)[] | undefined;
  /** Delivers events only when `flushEvents()` is called. */
  holdEvents = false;
  private queuedEvents: OverlayEvent[] = [];

  constructor(readonly carId = 1) {}

  client(): InMemoryOverlayPersistence {
    return new InMemoryOverlayPersistence(this);
  }

  /** The next requests fail in this order. */
  failNext(...failures: Failure[]) {
    this.failures.push(...failures);
  }

  /** Requests wait until `release()`. */
  hold() {
    this.held ??= [];
  }

  release() {
    const held = this.held ?? [];
    this.held = undefined;
    for (const r of held) r();
  }

  get heldCount() {
    return this.held?.length ?? 0;
  }

  /** Another tab or driver saves a new revision. */
  externalSave(doc: OverlayDocument) {
    this.document = detach(doc);
    this.revision++;
    this.emit({ type: "draftChanged", carId: this.carId, revision: this.revision });
  }

  emit(e: OverlayEvent) {
    if (this.holdEvents) this.queuedEvents.push(e);
    else for (const l of [...this.listeners]) l(e);
  }

  flushEvents() {
    const q = this.queuedEvents;
    this.queuedEvents = [];
    for (const e of q) for (const l of [...this.listeners]) l(e);
  }

  listen(cb: (e: OverlayEvent) => void) {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  async gate(method: string, path: string, extra: { ifMatch?: number; body?: unknown } = {}) {
    this.log.push({ method, path, ...extra });
    if (this.held) await new Promise<void>((r) => this.held!.push(r));
    else await Promise.resolve();
    const f = this.failures.shift();
    if (f === "network") throw new OverlayApiError(0, undefined, "network down");
    if (f) throw new OverlayApiError(f.status, f.code, `injected ${f.status}`);
  }

  requireDriver() {
    if (!this.driver) throw new OverlayApiError(403, "OVL_API_NOT_DRIVER", "not the active driver");
  }

  write(doc: OverlayDocument, ifMatch: number): { revision: number } {
    this.requireDriver();
    if (JSON.stringify(doc).length > 2 * 1024 * 1024) throw new OverlayApiError(413, "OVL_API_TOO_LARGE", "too large");
    const structure = validate(doc).filter((d) => d.category === "structure");
    if (structure.length > 0) throw new OverlayApiError(422, "OVL_API_INVALID_DOCUMENT", "invalid", undefined, structure);
    if (ifMatch !== this.revision) throw new OverlayApiError(409, "OVL_API_REVISION_CONFLICT", "conflict", this.revision);
    this.document = detach(doc);
    this.revision++;
    this.emit({ type: "draftChanged", carId: this.carId, revision: this.revision });
    return { revision: this.revision };
  }
}

export class InMemoryOverlayPersistence implements OverlayPersistence {
  constructor(readonly server: InMemoryOverlayServer) {}

  async getPublished(): Promise<Published | null> {
    await this.server.gate("GET", "published");
    const p = this.server.publications[this.server.publications.length - 1];
    return p ? { publicationId: p.id, number: p.number, publishedAt: p.publishedAt, document: detach(p.document) } : null;
  }

  async getDraft(): Promise<Draft> {
    await this.server.gate("GET", "draft");
    this.server.requireDriver();
    return { revision: this.server.revision, document: detach(this.server.document) };
  }

  async saveDraft(_carId: number, doc: OverlayDocument, baseRevision: number) {
    await this.server.gate("PUT", "draft", { ifMatch: baseRevision, body: detach(doc) });
    return this.server.write(detach(doc), baseRevision);
  }

  async patchDraft(_carId: number, ops: PatchOp[], baseRevision: number) {
    await this.server.gate("PATCH", "draft", { ifMatch: baseRevision, body: detach(ops) });
    this.server.requireDriver();
    if (baseRevision !== this.server.revision) throw new OverlayApiError(409, "OVL_API_REVISION_CONFLICT", "conflict", this.server.revision);
    let next: OverlayDocument;
    try {
      next = applyPatch(this.server.document, ops);
    } catch (e) {
      if (e instanceof PatchError) throw new OverlayApiError(422, "OVL_API_PATCH_FAILED", e.message);
      throw e;
    }
    return this.server.write(next, baseRevision);
  }

  async publish(_carId: number, baseRevision: number, note?: string) {
    await this.server.gate("POST", "publications", { body: { baseRevision, note } });
    this.server.requireDriver();
    if (baseRevision !== this.server.revision) throw new OverlayApiError(409, "OVL_API_REVISION_CONFLICT", "conflict", this.server.revision);
    const number = this.server.publications.length + 1;
    const p: Publication = { id: 100 + number, number, publishedAt: new Date(0).toISOString(), note, document: detach(this.server.document) };
    this.server.publications.push(p);
    this.server.emit({ type: "published", carId: this.server.carId, publicationId: p.id, number });
    return { publicationId: p.id, number };
  }

  async listPublications(): Promise<PublicationInfo[]> {
    await this.server.gate("GET", "publications");
    this.server.requireDriver();
    return [...this.server.publications].reverse().map(({ document: _d, ...info }) => info);
  }

  async restore(_carId: number, publicationId: number, baseRevision: number) {
    await this.server.gate("POST", "draft/restore", { body: { publicationId, baseRevision } });
    const p = this.server.publications.find((x) => x.id === publicationId);
    if (!p) throw new OverlayApiError(404, "OVL_API_NOT_FOUND", "unknown publication");
    return this.server.write(detach(p.document), baseRevision);
  }

  async uploadAsset(): Promise<AssetUploadResult> {
    await this.server.gate("POST", "assets");
    throw new OverlayApiError(501, "OVL_API_NOT_AVAILABLE", "no sanitizer in the test double");
  }

  async getAsset(_carId: number, assetId: string): Promise<string> {
    await this.server.gate("GET", `assets/${assetId}`);
    const svg = this.server.assets.get(assetId);
    if (svg === undefined) throw new OverlayApiError(404, "OVL_API_NOT_FOUND", "unknown asset");
    return svg;
  }

  onEvent(_carId: number, cb: (e: OverlayEvent) => void) {
    return this.server.listen(cb);
  }
}
