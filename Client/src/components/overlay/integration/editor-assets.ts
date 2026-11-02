// AP13 – asset map and resolve context of the editor page. Assets come from
// uploads (with metadata), from the current publication (GET published, with
// metadata) or from GET assets/{id} (text only). For text-only assets the
// server metadata is obtained by sending the normalized text through the
// upload once more: sanitizing is idempotent and duplicates return the stored
// asset (api/README.md §2, AP07). Without control the viewBox is used.
// Also: the stream behind the running preview.
import { dict } from "../document/dict";
import type { AssetMetadata, ResolveContext, TelemetryDataType } from "../document/types";
import { referencedAssets } from "../editor/persistence/backup";
import type { AssetUploadResult } from "../editor/persistence/types";
import { expressionAnalyzer } from "../expression";
import type { VehicleSources } from "../exchange/package";
import { parseAsset } from "../runtime/svg-asset";
import type { RuntimeAsset } from "../runtime/types";
import type { VNode } from "../runtime/vnode";
import type { OverlayDocument } from "../document/types";

/** The part of a video stream entry the preview needs (GetVideoStreamsForCar). */
export interface PreviewStreamLike {
  serverId: number;
  streamId: string;
  enabled: boolean;
}

/** The stream behind the running preview: the active variant's stream, else the last selected or first enabled one. */
export function previewStream<S extends PreviewStreamLike>(streams: S[], activeVariant: string | null, storedServerId?: number): S | undefined {
  const enabled = streams.filter((s) => s.enabled);
  return (activeVariant ? enabled.find((s) => s.streamId === activeVariant) : undefined)
    ?? enabled.find((s) => s.serverId === storedServerId)
    ?? enabled[0];
}

/** Width/height from the viewBox and the part ids; boxes unknown (zero). Validation only. */
export function viewBoxMetadata(svg: string): AssetMetadata | undefined {
  try {
    const parsed = parseAsset(svg);
    const parts: AssetMetadata["parts"] = dict();
    const visit = (n: VNode | string) => {
      if (typeof n === "string") return;
      const id = n.attrs["data-part"];
      if (id !== undefined && !parts[id]) parts[id] = { tag: n.tag, bbox: [0, 0, 0, 0] };
      n.children.forEach(visit);
    };
    parsed.children.forEach(visit);
    return { width: parsed.viewBox[2], height: parsed.viewBox[3], parts };
  } catch {
    return undefined;
  }
}

const DATA_TYPES = new Set<TelemetryDataType>(["String", "Integer", "Number", "Boolean", "LidarGrid"]);

/** Streams, sources, assets and the AP06 analyzer for the editor's diagnostics. */
export function editorResolveContext(vehicle: VehicleSources | null, assets: Record<string, RuntimeAsset>): ResolveContext {
  const metadata = dict<AssetMetadata>();
  for (const [id, a] of Object.entries(assets)) {
    const m = a.metadata ?? viewBoxMetadata(a.svg);
    if (m) metadata[id] = { ...m, sizeBytes: new TextEncoder().encode(a.svg).length };
  }
  const context: ResolveContext = { assets: metadata, expressions: expressionAnalyzer };
  if (vehicle) {
    const telemetry = dict<TelemetryDataType>();
    for (const t of vehicle.telemetry) telemetry[t.name] = DATA_TYPES.has(t.dataType as TelemetryDataType) ? (t.dataType as TelemetryDataType) : "String";
    context.sources = { telemetry, outputs: [...vehicle.outputs] };
    context.streams = vehicle.streams.map((s) => s.streamId);
  }
  return context;
}

export interface AssetLoaderPort {
  getAsset(assetId: string): Promise<string>;
  /** Normalized text through the sanitizer again (only with control). */
  upload?(svg: string): Promise<AssetUploadResult>;
}

/**
 * Keeps the editor's asset map complete: every asset referenced by the
 * document is loaded once. Failed loads are not retried automatically; the
 * reference stays unresolved (diagnostic) and the editor keeps working.
 */
export class EditorAssetLoader {
  private assets: Record<string, RuntimeAsset> = {};
  private readonly pending = new Set<string>();
  private readonly failed = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private disposed = false;

  constructor(private readonly port: AssetLoaderPort) {}

  get current(): Record<string, RuntimeAsset> {
    return this.assets;
  }

  get failedIds(): string[] {
    return [...this.failed].sort();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Adds assets known with metadata (upload, publication, package import). */
  add(assets: Record<string, RuntimeAsset>) {
    let changed = false;
    const next = { ...this.assets };
    for (const [id, a] of Object.entries(assets)) {
      const known = next[id];
      if (known && (known.metadata || !a.metadata)) continue;
      next[id] = a;
      this.failed.delete(id);
      changed = true;
    }
    if (changed) this.set(next);
  }

  /** Loads what `doc` references and is neither known nor loading. */
  ensure(doc: OverlayDocument): Promise<void> {
    const missing = referencedAssets(doc).filter((id) => !this.assets[id] && !this.pending.has(id) && !this.failed.has(id));
    return Promise.all(missing.map((id) => this.load(id))).then(() => {});
  }

  /** Clears failures so that the next `ensure` tries again (e.g. after regaining control). */
  retryFailed() {
    this.failed.clear();
  }

  dispose() {
    this.disposed = true;
    this.listeners.clear();
  }

  private async load(id: string) {
    this.pending.add(id);
    try {
      const svg = await this.port.getAsset(id);
      let asset: RuntimeAsset = { svg };
      if (this.port.upload) {
        try {
          const r = await this.port.upload(svg);
          if (r.assetId === id) asset = { svg, metadata: r.metadata };
        } catch { /* keep the text; viewBox fallback */ }
      }
      if (!this.disposed && !this.assets[id]) this.set({ ...this.assets, [id]: asset });
    } catch {
      this.failed.add(id);
      if (!this.disposed) this.emit();
    } finally {
      this.pending.delete(id);
    }
  }

  private set(next: Record<string, RuntimeAsset>) {
    this.assets = next;
    this.emit();
  }

  private emit() {
    for (const l of [...this.listeners]) l();
  }
}
