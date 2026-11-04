// AP14 – cross-module test wiring: one in-memory overlay server (AP02 port
// double) seen by editor tabs (AP09 SaveController) and by viewers
// (AP13 PublishedOverlay on a FakeHub), plus the AP08 runtime on top.
import type { OverlayDocument } from "../document/types";
import { EditorStore } from "../editor/core/store";
import { SaveController } from "../editor/persistence/autosave";
import { InMemoryOverlayServer } from "../editor/testing/in-memory-persistence";
import { MemoryBackupStore } from "../editor/testing/memory-backup-store";
import { hudConfigFor } from "../integration/hud-config";
import { PublishedOverlay, type FetchResponse, type Publication } from "../integration/published-overlay";
import { createRuntime } from "../runtime";
import type { FrameResult } from "../runtime/types";
import { FakeHub } from "../sources/testing/fake-hub";
import { FakeValueSource } from "../sources/testing/fake-value-source";
import { ManualClock } from "../sources/testing/manual-clock";

export const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};

export const assetId = (n: number) => `sha256-${n.toString(16).padStart(64, "0")}`;
export const svgOf = (label: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect id="${label}" width="10" height="10"/></svg>`;

/** Asset metadata as stored per asset on the server (api §3). */
export const ASSET_META = { width: 10, height: 10, parts: {} };

export const baseDoc = (): OverlayDocument => ({
  schemaVersion: 1,
  workspace: { width: 1280, height: 720 },
  elements: {
    e_speed: { type: "valueText", props: { x: 40, y: 680, value: { base: null, binding: { expr: 'tel("odoSpeed")' } }, decimals: 1 } },
  },
  children: ["e_speed"],
});

export interface Tab {
  store: EditorStore;
  save: SaveController;
  clock: ManualClock;
  /** Requests this tab made (shared server log, filtered by start index is not possible, so counted per tab). */
}

/**
 * The in-memory server plus HTTP/hub views on it for viewers. A viewer's hub
 * only delivers OverlayPublished while it is "connected".
 */
export class World {
  readonly server: InMemoryOverlayServer;
  readonly backups = new MemoryBackupStore();
  /** Assets by publication id (immutable copy at publish time). */
  readonly publicationAssets = new Map<number, string[]>();
  readonly viewerRequests: string[] = [];
  private readonly viewers: { hub: FakeHub; connected: boolean }[] = [];
  wall = 1_000_000;

  constructor(carId = 7) {
    this.server = new InMemoryOverlayServer(carId);
    this.server.document = baseDoc();
    this.server.revision = 1;
    this.server.listen((e) => {
      if (e.type !== "published") return;
      // The server copies the asset set of the publication (api §3 step 3).
      const p = this.server.publications.find((x) => x.id === e.publicationId)!;
      this.publicationAssets.set(p.id, assetIdsOf(p.document));
      for (const v of this.viewers) if (v.connected) v.hub.push("OverlayPublished", { carId: e.carId, publicationId: e.publicationId, number: e.number });
    });
  }

  get carId() {
    return this.server.carId;
  }

  addAsset(id: string, svg: string) {
    this.server.assets.set(id, svg);
  }

  async tab(options: { hasControl?: boolean; sessionId?: string } = {}): Promise<Tab> {
    const clock = new ManualClock();
    const store = new EditorStore({ carId: this.carId, document: { schemaVersion: 1, workspace: { width: 1, height: 1 }, elements: {}, children: [] } });
    const save = new SaveController({
      store, persistence: this.server.client(), backups: this.backups, clock, wallClock: () => this.wall + clock.now(),
      hasControl: options.hasControl, sessionId: options.sessionId,
      assetTexts: () => Object.fromEntries(this.server.assets),
    });
    await save.open();
    await settle();
    return { store, save, clock };
  }

  /** GET published / GET assets as a viewer sees them (viewer rules of api §3). */
  readonly fetch = async (url: string): Promise<FetchResponse> => {
    this.viewerRequests.push(url);
    const prefix = `/api/cars/${this.carId}/overlay/`;
    if (!url.startsWith(prefix)) return respond(404, null);
    const rest = url.slice(prefix.length);
    if (rest === "published") {
      const p = this.server.publications.at(-1);
      if (!p) return respond(204, null);
      const assets = Object.fromEntries((this.publicationAssets.get(p.id) ?? []).map((id) => [id, ASSET_META]));
      return respond(200, { publicationId: p.id, number: p.number, publishedAt: p.publishedAt, document: JSON.parse(JSON.stringify(p.document)), assets });
    }
    if (rest.startsWith("assets/")) {
      const id = decodeURIComponent(rest.slice("assets/".length));
      // Viewers read only assets some publication refers to.
      const published = [...this.publicationAssets.values()].some((ids) => ids.includes(id));
      const svg = this.server.assets.get(id);
      return published && svg !== undefined ? respond(200, svg) : respond(404, null);
    }
    return respond(404, null);
  };

  viewer() {
    const hub = new FakeHub();
    const entry = { hub, connected: true };
    this.viewers.push(entry);
    const overlay = new PublishedOverlay({ carId: this.carId, hub, fetch: this.fetch, clock: new ManualClock() });
    return {
      hub,
      overlay,
      disconnect: () => { entry.connected = false; hub.reconnecting(); },
      reconnect: () => { entry.connected = true; hub.reconnected(); },
    };
  }
}

function respond(status: number, body: unknown): FetchResponse {
  return { status, ok: status >= 200 && status < 300, json: async () => body, text: async () => String(body) };
}

export function assetIdsOf(doc: OverlayDocument): string[] {
  const ids = new Set<string>();
  const add = (els: Record<string, { type?: string; assetId?: unknown }> | undefined) => {
    for (const e of Object.values(els ?? {})) if (e?.type === "svgAsset" && typeof e.assetId === "string") ids.add(e.assetId);
  };
  add(doc.elements as never);
  for (const v of Object.values(doc.variants ?? {})) {
    add(v.addedElements as never);
    add(v.elements as never);
  }
  return [...ids].sort();
}

/** One runtime frame of a publication for a stream, with the given telemetry. */
export function frameOf(publication: Publication | undefined, stream: string, values: Record<string, string> = {}, t = 0): FrameResult | null {
  const config = hudConfigFor(publication, stream);
  if (!config) return null;
  const source = new FakeValueSource();
  for (const [name, value] of Object.entries(values)) source.set("tel", name, { state: "valid", value });
  return createRuntime(config, { channels: () => ({ dataType: "Number" }) }).step(t, source);
}

export const writes = (server: InMemoryOverlayServer) => server.log.filter((l) => l.method === "PUT" || l.method === "PATCH" || l.method === "POST");
