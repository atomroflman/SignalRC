// AP13 – the currently published HUD of a vehicle (Shared/Overlay/api/README.md
// §3 GET published, §4 events): load it, follow OverlayPublished and the
// SignalR reconnect, and switch only to a complete, usable state (document
// checked, all assets loaded). Video and audio are not touched here.
import { canSave, validate } from "../document";
import type { AssetMetadata, OverlayDocument } from "../document";
import type { HubLike } from "../sources/hub";
import type { RuntimeAsset } from "../runtime/types";
import type { TimerClock } from "../sources/types";
import { systemClock } from "../sources/types";

export interface Publication {
  publicationId: number;
  number: number;
  publishedAt?: string;
  document: OverlayDocument;
  /** All assets referenced anywhere in the document (standard and variants). */
  assets: Record<string, RuntimeAsset>;
}

/** Why the newest publication could not be taken over. */
export type PublicationProblem = "load" | "unsupported" | "invalid" | "assets";

export interface PublishedState {
  /** loading: nothing known yet; none: nothing published (or nothing usable). */
  status: "loading" | "none" | "ready";
  /** The publication in use; kept when a newer one is not usable. */
  publication?: Publication;
  /** Problem with the newest publication, shown next to a running HUD. */
  problem?: PublicationProblem;
}

export type FetchResponse = { status: number; ok: boolean; json(): Promise<unknown>; text(): Promise<string> };

export interface PublishedOverlayOptions {
  carId: number;
  /** The connection the page already has; joining the group is done here. */
  hub: HubLike;
  fetch?: (url: string) => Promise<FetchResponse>;
  clock?: TimerClock;
}

/** Retry delays after a failed load (network, assets). */
export const RETRY_MS = [2000, 5000, 15000, 30000];

/** Asset ids referenced by svgAsset elements of the standard and all variants. */
export function documentAssetIds(doc: OverlayDocument): string[] {
  const ids = new Set<string>();
  const collect = (elements: Record<string, { type?: string; assetId?: unknown }> | undefined) => {
    for (const el of Object.values(elements ?? {})) {
      if (el && el.type === "svgAsset" && typeof el.assetId === "string") ids.add(el.assetId);
    }
  };
  collect(doc.elements as Record<string, { type?: string; assetId?: unknown }>);
  for (const v of Object.values(doc.variants ?? {})) {
    collect(v.addedElements as Record<string, { type?: string; assetId?: unknown }> | undefined);
    collect(v.elements as Record<string, { type?: string; assetId?: unknown }> | undefined);
  }
  return [...ids].sort();
}

/**
 * Metadata of one asset from `assets` of GET published (api §3): size and part
 * bboxes for "center" pivots. Missing or malformed: the SVG viewBox is used.
 */
export function assetMetadata(assets: unknown, id: string): AssetMetadata | undefined {
  if (!assets || typeof assets !== "object") return undefined;
  const m = (assets as Record<string, unknown>)[id] as { width?: unknown; height?: unknown; parts?: unknown } | undefined;
  if (!m || typeof m !== "object" || typeof m.width !== "number" || typeof m.height !== "number") return undefined;
  const parts: AssetMetadata["parts"] = {};
  if (m.parts && typeof m.parts === "object") {
    for (const [pid, p] of Object.entries(m.parts as Record<string, { tag?: unknown; bbox?: unknown }>)) {
      const bbox = p?.bbox;
      if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every((v) => typeof v === "number" && Number.isFinite(v))) continue;
      parts[pid] = { tag: typeof p.tag === "string" ? p.tag : "", bbox: bbox as [number, number, number, number] };
    }
  }
  return { width: m.width, height: m.height, parts };
}

const defaultFetch = (url: string) => fetch(url) as Promise<FetchResponse>;

export class PublishedOverlay {
  readonly carId: number;
  private readonly hub: HubLike;
  private readonly fetchImpl: (url: string) => Promise<FetchResponse>;
  private readonly clock: TimerClock;
  private _state: PublishedState = { status: "loading" };
  private readonly listeners = new Set<() => void>();
  /** Assets are immutable and content-addressed: fetched once per page. */
  private readonly assetCache = new Map<string, string>();
  private loadSeq = 0;
  private loading = false;
  private again = false;
  private retryTimer: unknown;
  private retries = 0;
  private disposed = false;

  private readonly onPublished = (event: { carId?: number; publicationId?: number } | undefined) => {
    if (this.disposed || Number(event?.carId) !== this.carId) return;
    if (event?.publicationId === this._state.publication?.publicationId && !this._state.problem) return;
    void this.load();
  };

  constructor(options: PublishedOverlayOptions) {
    this.carId = options.carId;
    this.hub = options.hub;
    this.fetchImpl = options.fetch ?? defaultFetch;
    this.clock = options.clock ?? systemClock;
    this.hub.on("OverlayPublished", this.onPublished);
    // After a reconnect the group membership is gone: join again and compare (§4).
    this.hub.onreconnected?.(() => {
      if (!this.disposed) void this.join().then(() => this.load());
    });
    void this.join().then(() => this.load());
  }

  get state(): PublishedState {
    return this._state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Joins the event group of the vehicle (SubscribeToOverlay, §4). */
  private join(): Promise<void> {
    return this.hub.invoke("SubscribeToOverlay", this.carId).then(
      () => undefined,
      (e) => { if (!this.disposed) console.warn("SubscribeToOverlay failed", e); },
    );
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.hub.off("OverlayPublished", this.onPublished);
    this.cancelRetry();
    this.listeners.clear();
    this.hub.invoke("UnsubscribeFromOverlay", this.carId).catch(() => {});
  }

  /** Loads GET published and takes it over when it differs and is usable. */
  async load(): Promise<void> {
    if (this.disposed) return;
    // One request at a time; a load requested meanwhile runs once afterwards.
    if (this.loading) {
      this.again = true;
      return;
    }
    this.loading = true;
    this.cancelRetry();
    const seq = ++this.loadSeq;
    try {
      await this.loadOnce(seq);
    } finally {
      this.loading = false;
      if (this.again && !this.disposed) {
        this.again = false;
        void this.load();
      }
    }
  }

  private async loadOnce(seq: number) {
    let res: FetchResponse;
    let body: unknown;
    try {
      res = await this.fetchImpl(`/api/cars/${this.carId}/overlay/published`);
      if (res.status === 204) {
        this.retries = 0;
        return this.set({ status: "none" });
      }
      if (!res.ok) throw new Error(`published: ${res.status}`);
      body = await res.json();
    } catch {
      return this.fail("load");
    }
    if (this.disposed || seq !== this.loadSeq) return;
    const b = body as { publicationId?: unknown; number?: unknown; publishedAt?: unknown; document?: unknown; assets?: unknown } | null;
    if (!b || typeof b.publicationId !== "number" || typeof b.number !== "number") return this.fail("load");
    const current = this._state.publication;
    if (current && current.publicationId === b.publicationId) {
      this.retries = 0;
      if (this._state.problem) this.set({ status: "ready", publication: current });
      return;
    }

    // An unusable document never replaces a working one (§4); no retry, a new
    // publication brings a new event.
    const doc = b.document as { schemaVersion?: unknown } | null | undefined;
    if (!doc || typeof doc !== "object" || doc.schemaVersion !== 1) return this.reject("unsupported");
    let diagnostics;
    try {
      diagnostics = validate(doc);
    } catch {
      return this.reject("invalid");
    }
    if (!canSave(diagnostics)) return this.reject("invalid");
    const document = doc as unknown as OverlayDocument;

    // Assets first, then switch: no mixed states.
    const assets: Record<string, RuntimeAsset> = {};
    try {
      for (const id of documentAssetIds(document)) {
        let svg = this.assetCache.get(id);
        if (svg === undefined) {
          const r = await this.fetchImpl(`/api/cars/${this.carId}/overlay/assets/${encodeURIComponent(id)}`);
          if (!r.ok) throw new Error(`asset ${id}: ${r.status}`);
          svg = await r.text();
          this.assetCache.set(id, svg);
        }
        const metadata = assetMetadata(b.assets, id);
        assets[id] = metadata ? { svg, metadata } : { svg };
      }
    } catch {
      return this.fail("assets");
    }
    if (this.disposed || seq !== this.loadSeq) return;
    this.retries = 0;
    this.set({
      status: "ready",
      publication: {
        publicationId: b.publicationId,
        number: b.number,
        publishedAt: typeof b.publishedAt === "string" ? b.publishedAt : undefined,
        document,
        assets,
      },
    });
  }

  /** The newest publication is not usable: keep the current one with a hint. */
  private reject(problem: PublicationProblem) {
    const publication = this._state.publication;
    this.set(publication ? { status: "ready", publication, problem } : { status: "none", problem });
  }

  /** A transient failure: keep what runs and try again later. */
  private fail(problem: PublicationProblem) {
    if (this.disposed) return;
    this.reject(problem);
    const delay = RETRY_MS[Math.min(this.retries++, RETRY_MS.length - 1)];
    this.retryTimer = this.clock.setTimer(() => {
      this.retryTimer = undefined;
      void this.load();
    }, delay);
  }

  private cancelRetry() {
    if (this.retryTimer !== undefined) this.clock.clearTimer(this.retryTimer);
    this.retryTimer = undefined;
  }

  private set(state: PublishedState) {
    if (this.disposed) return;
    const prev = this._state;
    if (prev.status === state.status && prev.publication === state.publication && prev.problem === state.problem) return;
    this._state = state;
    for (const l of [...this.listeners]) l();
  }
}
