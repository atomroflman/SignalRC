// Browser-local backups (Shared/Overlay/api/README.md §5): IndexedDB database
// `signalrc-overlay`, store `backups`, key [carId, savedAt]; entries in the
// exchange package format (svg/README.md §7) with kind "backup".
import type { OverlayDocument } from "../../document/types";

export interface PackageSource {
  streams: { streamId: string; name?: string; width?: number; height?: number }[];
  telemetry: { name: string; dataType?: string; unit?: string | null }[];
  outputs: string[];
}

export interface OverlayPackage {
  format: "signalrc-overlay-package";
  formatVersion: 1;
  kind: "export" | "backup";
  exportedAt: string;
  baseRevision?: number;
  source: PackageSource;
  document: OverlayDocument;
  assets: Record<string, { svg: string }>;
}

export interface BackupEntry {
  carId: number;
  savedAt: number;
  package: OverlayPackage;
}

export interface BackupStore {
  /** Writes the entry and keeps only the newest `keep` entries of the vehicle. */
  put(entry: BackupEntry, keep: number): Promise<void>;
  /** Entries of the vehicle, newest first. */
  list(carId: number): Promise<BackupEntry[]>;
}

/** Assets referenced anywhere in the document (standard and variants). */
export function referencedAssets(doc: OverlayDocument): string[] {
  const ids = new Set<string>();
  for (const el of Object.values(doc.elements)) if (el.assetId) ids.add(el.assetId);
  for (const v of Object.values(doc.variants ?? {})) for (const el of Object.values(v.addedElements ?? {})) if (el.assetId) ids.add(el.assetId);
  return [...ids].sort();
}

export function backupPackage(
  doc: OverlayDocument,
  baseRevision: number | undefined,
  assetTexts: Record<string, string>,
  source: PackageSource = { streams: [], telemetry: [], outputs: [] },
  at: Date = new Date(),
): OverlayPackage {
  const assets: Record<string, { svg: string }> = {};
  for (const id of referencedAssets(doc)) if (assetTexts[id] !== undefined) assets[id] = { svg: assetTexts[id] };
  const pkg: OverlayPackage = {
    format: "signalrc-overlay-package",
    formatVersion: 1,
    kind: "backup",
    exportedAt: at.toISOString(),
    source,
    document: doc,
    assets,
  };
  if (baseRevision !== undefined) pkg.baseRevision = baseRevision;
  return pkg;
}

export function packageFileName(carId: number, pkg: OverlayPackage): string {
  const stamp = pkg.exportedAt.replace(/[:.]/g, "-");
  return `overlay-car${carId}-${pkg.kind}-r${pkg.baseRevision ?? 0}-${stamp}.json`;
}

/** Starts a browser download of the package (conflict backup, D34). */
export function downloadPackage(carId: number, pkg: OverlayPackage) {
  const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = packageFileName(carId, pkg);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const DB = "signalrc-overlay";
const STORE = "backups";

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export class IndexedDbBackupStore implements BackupStore {
  private db: Promise<IDBDatabase> | undefined;

  constructor(private readonly factory: IDBFactory = indexedDB) {}

  private open(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = new Promise((resolve, reject) => {
        const r = this.factory.open(DB, 1);
        r.onupgradeneeded = () => {
          if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: ["carId", "savedAt"] });
        };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      this.db.catch(() => { this.db = undefined; });
    }
    return this.db;
  }

  private range(carId: number) {
    return IDBKeyRange.bound([carId, -Infinity], [carId, Infinity]);
  }

  async put(entry: BackupEntry, keep: number): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    store.put(entry);
    const keys = (await request(store.getAllKeys(this.range(entry.carId)))) as [number, number][];
    keys.sort((a, b) => a[1] - b[1]);
    for (const key of keys.slice(0, Math.max(0, keys.length - keep))) store.delete(key);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async list(carId: number): Promise<BackupEntry[]> {
    const db = await this.open();
    const all = (await request(db.transaction(STORE).objectStore(STORE).getAll(this.range(carId)))) as BackupEntry[];
    return all.sort((a, b) => b.savedAt - a.savedAt);
  }
}

/** Browser store when IndexedDB exists, else none (SSR, tests). */
export function defaultBackupStore(): BackupStore | undefined {
  return typeof indexedDB !== "undefined" ? new IndexedDbBackupStore() : undefined;
}
