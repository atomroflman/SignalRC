// Autosave, local backups, conflicts and loss of control (Shared/Overlay/api/README.md §5,
// D25, D55, D63; Overlay-Feature.md "Entwurf, Autosave und lokale Wiederherstellung").
//
// - Autosave 2 s after the last change, at the latest 30 s after the first
//   unsaved one; at most one request at a time; PATCH with the difference to
//   the confirmed state, PUT for the first save after load/replace or when
//   the patch is larger than half the document, once more after 422 PATCH_FAILED.
// - Conflict (409 or a foreign OverlayDraftChanged): autosave pauses, the
//   server wins, the local state stays available as download and backup.
// - Without control (403 NOT_DRIVER, 401 SESSION_REQUIRED or setControl(false)): local editing goes
//   on, nothing is sent; regaining control checks the revision first.
import type { Diagnostic, OverlayDocument } from "../../document/types";
import { validate } from "../../document/validate";
import { systemClock, type TimerClock } from "../../sources/types";
import { diff } from "../core/json-patch";
import type { EditorStore } from "../core/store";
import { jsonEqual } from "../core/writer";
import { backupPackage, type BackupEntry, type BackupStore, type OverlayPackage, type PackageSource } from "./backup";
import { OverlayApiError, type OverlayEvent, type OverlayPersistence } from "./types";

/** OverlayAccess refusals (D73): the editor goes on locally. */
const deniesAccess = (code: string | undefined) => code === "OVL_API_NOT_DRIVER" || code === "OVL_API_SESSION_REQUIRED";

export type SaveStatus = "loading" | "unsaved" | "saving" | "saved" | "error" | "conflict" | "localOnly";

export interface SaveError {
  status?: number;
  code?: string;
  message: string;
  diagnostics?: Diagnostic[];
}

export interface BackupOffer {
  entry: BackupEntry;
  /** Only when the backup's base revision equals the server revision (api/README.md §5). */
  canContinue: boolean;
}

export interface SaveState {
  status: SaveStatus;
  /** Server revision the local draft is based on (undefined before loading). */
  baseRevision?: number;
  hasControl: boolean;
  /** Local changes the server has not confirmed. */
  dirty: boolean;
  lastSavedAt?: number;
  error?: SaveError;
  /** Newer server revision that caused the conflict. */
  conflictRevision?: number;
  /** Local backups that differ from the loaded server draft. */
  backups: BackupOffer[];
  /** Number of the last publication event seen. */
  publishedNumber?: number;
  /** The last backup write failed (e.g. private window without IndexedDB). */
  backupFailed?: boolean;
}

export interface SaveControllerOptions {
  store: EditorStore;
  persistence: OverlayPersistence;
  backups?: BackupStore;
  clock?: TimerClock;
  /** Wall clock for backup keys (ms since epoch). */
  wallClock?: () => number;
  /** Texts of loaded assets for backups. */
  assetTexts?: () => Record<string, string>;
  source?: () => PackageSource;
  hasControl?: boolean;
  /** Backup session id (D72); random per controller by default. */
  sessionId?: string;
  debounceMs?: number;
  maxDelayMs?: number;
  backupThrottleMs?: number;
  keepBackups?: number;
  retryMs?: number[];
}

type Listener = () => void;

export class SaveController {
  private state: SaveState;
  private readonly listeners = new Set<Listener>();
  private readonly store: EditorStore;
  private readonly persistence: OverlayPersistence;
  private readonly backups?: BackupStore;
  private readonly clock: TimerClock;
  private readonly wall: () => number;
  private readonly o: Required<Pick<SaveControllerOptions, "debounceMs" | "maxDelayMs" | "backupThrottleMs" | "keepBackups" | "retryMs">>;
  private readonly carId: number;
  /** Backup rotation group of this editor session (D72). */
  readonly sessionId: string;

  private confirmed: OverlayDocument | undefined;
  private lastSeen: OverlayDocument;
  private lastReplaceCount: number;
  private fullNext = true;
  private opened = false;
  private firstDirtyAt: number | undefined;
  private lastChangeAt = 0;
  private timer: unknown;
  private retryTimer: unknown;
  private retries = 0;
  private inflight: Promise<void> | undefined;
  private again = false;
  private readonly own = new Set<number>();
  private pendingEvents: number[] = [];
  private backupTimer: unknown;
  private lastBackupAt = -Infinity;
  private lastBackupDoc: OverlayDocument | undefined;
  private lastBackupKey = 0;
  private backupChain: Promise<void> = Promise.resolve();
  private unsubscribeStore: () => void;
  private unsubscribeEvents: (() => void) | undefined;
  private disposed = false;

  constructor(options: SaveControllerOptions) {
    this.store = options.store;
    this.persistence = options.persistence;
    this.backups = options.backups;
    this.clock = options.clock ?? systemClock;
    this.wall = options.wallClock ?? (() => Date.now());
    this.carId = options.store.getState().carId;
    this.sessionId = options.sessionId ?? `s-${Math.random().toString(36).slice(2, 12)}-${Date.now().toString(36)}`;
    this.o = {
      debounceMs: options.debounceMs ?? 2000,
      maxDelayMs: options.maxDelayMs ?? 30000,
      backupThrottleMs: options.backupThrottleMs ?? 1000,
      keepBackups: options.keepBackups ?? 5,
      retryMs: options.retryMs ?? [2000, 5000, 10000, 30000],
    };
    this.assetTexts = options.assetTexts ?? (() => ({}));
    this.source = options.source;
    this.state = { status: "loading", hasControl: options.hasControl ?? true, dirty: false, backups: [] };
    this.lastSeen = this.store.document;
    this.lastReplaceCount = this.store.replaceCount;
    this.unsubscribeStore = this.store.subscribe(() => this.onStore());
  }

  private readonly assetTexts: () => Record<string, string>;
  private readonly source?: () => PackageSource;

  getState(): SaveState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Loads the server draft into the store and looks for local backups. */
  async open(): Promise<void> {
    if (!this.unsubscribeEvents) this.unsubscribeEvents = this.persistence.onEvent(this.carId, (e) => this.onEvent(e));
    if (!this.state.hasControl) {
      this.set({ status: "localOnly", error: { code: "OVL_API_NOT_DRIVER", message: "Ohne Fahrzeugkontrolle kann der Entwurf nicht geladen werden" } });
      await this.offerBackups(undefined, undefined);
      return;
    }
    this.set({ status: "loading", error: undefined });
    try {
      const draft = await this.persistence.getDraft(this.carId);
      if (this.disposed) return;
      this.loadIntoStore(draft.document);
      this.confirmed = this.store.document;
      this.fullNext = true;
      this.opened = true;
      this.set({ status: "saved", baseRevision: draft.revision, dirty: false, conflictRevision: undefined });
      this.drainEvents();
      await this.offerBackups(draft.revision, this.confirmed);
    } catch (e) {
      const err = this.toError(e);
      if (deniesAccess(err.code)) {
        this.set({ status: "localOnly", hasControl: false, error: err });
        await this.offerBackups(undefined, undefined);
      } else {
        this.set({ status: "error", error: err });
      }
    }
  }

  dispose() {
    void this.flushBackup();
    this.disposed = true;
    this.unsubscribeStore();
    this.unsubscribeEvents?.();
    this.clearTimer();
    this.clock.clearTimer(this.retryTimer);
    this.clock.clearTimer(this.backupTimer);
  }

  /** Control state from the app (CarStateUpdated / active driver). */
  setControl(hasControl: boolean) {
    if (hasControl === this.state.hasControl) return;
    if (!hasControl) {
      this.clearTimer();
      this.clock.clearTimer(this.retryTimer);
      this.set({ hasControl: false, status: this.state.status === "conflict" ? "conflict" : "localOnly" });
      return;
    }
    this.set({ hasControl: true });
    if (!this.opened) void this.open();
    else void this.verify();
  }

  /** Saves now (button, leaving the page). Resolves when the request is done. */
  async flush(): Promise<void> {
    this.clearTimer();
    if (this.inflight) {
      this.again = true;
      return this.inflight;
    }
    if (!this.canWrite()) return;
    if (this.store.inTransaction) {
      this.timer = this.clock.setTimer(() => { this.timer = undefined; void this.flush(); }, 250);
      return;
    }
    const doc = this.store.document;
    const structure = validate(doc).filter((d) => d.category === "structure");
    if (structure.length > 0) {
      this.set({ status: "error", error: { code: "OVL_API_INVALID_DOCUMENT", message: structure[0].message, diagnostics: structure } });
      return;
    }
    const ops = diff(this.confirmed, doc);
    if (ops.length === 0) {
      this.confirmed = doc;
      this.firstDirtyAt = undefined;
      this.set({ status: "saved", dirty: false });
      return;
    }
    const usePut = this.fullNext || JSON.stringify(ops).length > JSON.stringify(doc).length / 2;
    const replaceCount = this.store.replaceCount;
    const base = this.state.baseRevision!;
    this.set({ status: "saving" });
    this.inflight = (async () => {
      try {
        let result: { revision: number };
        try {
          result = usePut ? await this.persistence.saveDraft(this.carId, doc, base) : await this.persistence.patchDraft(this.carId, ops, base);
        } catch (e) {
          if (!usePut && e instanceof OverlayApiError && e.code === "OVL_API_PATCH_FAILED") {
            result = await this.persistence.saveDraft(this.carId, doc, base);
          } else {
            throw e;
          }
        }
        if (this.disposed) return;
        this.own.add(result.revision);
        this.confirmed = doc;
        if (this.store.replaceCount === replaceCount) this.fullNext = false;
        this.retries = 0;
        this.firstDirtyAt = undefined;
        const dirty = this.store.document !== doc;
        if (dirty) this.firstDirtyAt = this.clock.now();
        this.set({ baseRevision: result.revision, lastSavedAt: this.clock.now(), error: undefined, dirty, status: this.state.hasControl ? (dirty ? "unsaved" : "saved") : "localOnly" });
      } catch (e) {
        if (!this.disposed) this.onSaveError(e);
      } finally {
        this.inflight = undefined;
        this.drainEvents();
        if (this.canWrite() && this.state.dirty && this.state.status === "unsaved") this.schedule();
      }
    })();
    await this.inflight;
    if (this.again) {
      this.again = false;
      if (this.canWrite() && this.state.dirty) await this.flush();
    }
  }

  /** Local state as exchange package (conflict download, D34). */
  backupPackage(): OverlayPackage {
    return backupPackage(this.store.document, this.state.baseRevision, this.assetTexts(), this.source?.());
  }

  /** Conflict: replaces the local draft by the server state (server wins); the local one goes to a backup first. */
  async loadServerState(): Promise<void> {
    if (!this.state.hasControl) return;
    await this.writeBackup(true, true);
    try {
      const draft = await this.persistence.getDraft(this.carId);
      if (this.disposed) return;
      this.clearTimer();
      this.loadIntoStore(draft.document);
      this.confirmed = this.store.document;
      this.fullNext = true;
      this.opened = true;
      this.firstDirtyAt = undefined;
      this.pendingEvents = [];
      this.set({ status: "saved", baseRevision: draft.revision, dirty: false, conflictRevision: undefined, error: undefined });
    } catch (e) {
      this.onSaveError(e, false);
    }
  }

  /** Continues with a local backup; only offered when its base revision is the current one. */
  continueFromBackup(entry: BackupEntry): boolean {
    const offer = this.state.backups.find((b) => b.entry === entry);
    if (!offer?.canContinue || entry.package.baseRevision !== this.state.baseRevision || this.state.status === "conflict") return false;
    const r = this.store.dispatch({ type: "replaceDocument", document: entry.package.document, reason: "backup" });
    if (r.ok) this.set({ backups: [] });
    return r.ok;
  }

  dismissBackups() {
    this.set({ backups: [] });
  }

  /** Writes a pending (throttled) backup now, e.g. before the page unloads. */
  flushBackup(): Promise<void> {
    if (this.backupTimer === undefined) return this.backupChain;
    this.clock.clearTimer(this.backupTimer);
    this.backupTimer = undefined;
    return this.writeBackup(false);
  }

  // --- Internals ---

  /** Server state into the store; not a local change (no backup, not dirty). */
  private loadIntoStore(doc: OverlayDocument) {
    this.loading = true;
    try {
      this.store.load(doc);
    } finally {
      this.loading = false;
    }
    this.lastSeen = this.store.document;
    this.lastReplaceCount = this.store.replaceCount;
  }

  private loading = false;

  private get conflicted() {
    return this.state.status === "conflict";
  }

  private canWrite() {
    return this.opened && this.state.hasControl && this.state.status !== "conflict" && !this.disposed;
  }

  private onStore() {
    const doc = this.store.document;
    if (doc === this.lastSeen || this.loading) return;
    this.lastSeen = doc;
    if (this.store.replaceCount !== this.lastReplaceCount) {
      this.lastReplaceCount = this.store.replaceCount;
      this.fullNext = true;
    }
    this.lastChangeAt = this.clock.now();
    this.scheduleBackup();
    if (!this.opened) return;
    const dirty = doc !== this.confirmed;
    if (!dirty) this.firstDirtyAt = undefined;
    else this.firstDirtyAt ??= this.lastChangeAt;
    const status = !this.canWrite() ? this.state.status : this.inflight ? "saving" : dirty ? "unsaved" : "saved";
    this.set({ dirty, status });
    if (this.canWrite()) this.schedule();
  }

  private schedule() {
    this.clearTimer();
    if (!this.state.dirty || this.inflight) return;
    const now = this.clock.now();
    const due = Math.min(this.lastChangeAt + this.o.debounceMs, (this.firstDirtyAt ?? now) + this.o.maxDelayMs);
    this.timer = this.clock.setTimer(() => {
      this.timer = undefined;
      void this.flush();
    }, Math.max(0, due - now));
  }

  private clearTimer() {
    if (this.timer !== undefined) this.clock.clearTimer(this.timer);
    this.timer = undefined;
  }

  private onSaveError(e: unknown, retry = true) {
    const err = this.toError(e);
    if (err.status === 409) {
      this.enterConflict(err.currentRevision ?? undefined);
    } else if (deniesAccess(err.code)) {
      this.clearTimer();
      this.set({ hasControl: false, status: this.state.status === "conflict" ? "conflict" : "localOnly", error: err });
    } else {
      this.set({ status: "error", error: err });
      const transient = err.status === 0 || (err.status ?? 0) >= 500 || err.status === 408 || err.status === 429;
      if (retry && transient) {
        const delay = this.o.retryMs[Math.min(this.retries, this.o.retryMs.length - 1)];
        this.retries++;
        this.clock.clearTimer(this.retryTimer);
        this.retryTimer = this.clock.setTimer(() => {
          this.retryTimer = undefined;
          if (this.state.status === "error") void this.flush();
        }, delay);
      }
    }
  }

  private toError(e: unknown): SaveError & { currentRevision?: number } {
    if (e instanceof OverlayApiError) {
      return { status: e.status, code: e.code, message: e.message, diagnostics: e.diagnostics, currentRevision: e.currentRevision };
    }
    return { message: String(e instanceof Error ? e.message : e) };
  }

  private enterConflict(revision: number | undefined) {
    this.clearTimer();
    this.clock.clearTimer(this.retryTimer);
    this.set({ status: "conflict", conflictRevision: revision });
    void this.writeBackup(true, true);
  }

  private onEvent(e: OverlayEvent) {
    if (this.disposed) return;
    switch (e.type) {
      case "draftChanged":
        this.pendingEvents.push(e.revision);
        if (!this.inflight && this.opened) this.drainEvents();
        break;
      case "published":
        this.set({ publishedNumber: e.number });
        break;
      case "reconnected":
        void this.verify();
        break;
    }
  }

  /** Foreign revisions newer than the base mean conflict (api/README.md §4). */
  private drainEvents() {
    if (!this.opened || this.inflight) return;
    const events = this.pendingEvents;
    this.pendingEvents = [];
    const base = this.state.baseRevision ?? 0;
    const foreign = events.filter((r) => r > base && !this.own.has(r));
    if (foreign.length > 0 && this.state.status !== "conflict") this.enterConflict(Math.max(...foreign));
  }

  /** After regaining control or a reconnect: same revision → go on, else conflict. */
  private async verify(): Promise<void> {
    if (this.inflight) await this.inflight.catch(() => {});
    if (!this.opened || !this.state.hasControl || this.state.status === "conflict" || this.disposed) return;
    try {
      const draft = await this.persistence.getDraft(this.carId);
      if (this.disposed || this.conflicted) return;
      if (draft.revision !== this.state.baseRevision && !this.own.has(draft.revision)) {
        this.enterConflict(draft.revision);
        return;
      }
      const dirty = this.store.document !== this.confirmed;
      this.set({ status: dirty ? "unsaved" : "saved", dirty, error: undefined });
      if (dirty) {
        this.firstDirtyAt ??= this.clock.now();
        this.schedule();
      }
    } catch (e) {
      this.onSaveError(e, false);
    }
  }

  private async offerBackups(revision: number | undefined, server: OverlayDocument | undefined) {
    if (!this.backups) return;
    try {
      const entries = await this.backups.list(this.carId);
      const offers = entries
        .filter((entry) => !server || !jsonEqual(entry.package.document, server))
        .map((entry) => ({ entry, canContinue: revision !== undefined && entry.package.baseRevision === revision }));
      if (!this.disposed) this.set({ backups: offers });
    } catch {
      this.set({ backupFailed: true });
    }
  }

  private scheduleBackup() {
    if (!this.backups || this.backupTimer !== undefined) return;
    const wait = this.lastBackupAt + this.o.backupThrottleMs - this.clock.now();
    if (wait <= 0) {
      void this.writeBackup(false);
      return;
    }
    this.backupTimer = this.clock.setTimer(() => {
      this.backupTimer = undefined;
      void this.writeBackup(false);
    }, wait);
  }

  /** Writes the local state; `force` also when unchanged since the last backup (conflict). */
  private writeBackup(force: boolean, conflict = false): Promise<void> {
    if (!this.backups) return Promise.resolve();
    const doc = this.store.document;
    if (!force && doc === this.lastBackupDoc) return this.backupChain;
    // Nothing local to protect when the state equals the confirmed server state.
    if (force && doc === this.confirmed) return this.backupChain;
    this.lastBackupDoc = doc;
    this.lastBackupAt = this.clock.now();
    const savedAt = Math.max(this.wall(), this.lastBackupKey + 1);
    this.lastBackupKey = savedAt;
    const entry: BackupEntry = {
      carId: this.carId,
      savedAt,
      sessionId: this.sessionId,
      ...(conflict ? { conflict: true } : {}),
      package: backupPackage(doc, this.state.baseRevision, this.assetTexts(), this.source?.(), new Date(savedAt)),
    };
    const store = this.backups;
    this.backupChain = this.backupChain
      .then(() => store.put(entry, this.o.keepBackups))
      .then(() => { if (this.state.backupFailed) this.set({ backupFailed: false }); })
      .catch(() => { this.set({ backupFailed: true }); });
    return this.backupChain;
  }

  private set(patch: Partial<SaveState>) {
    this.state = { ...this.state, ...patch };
    for (const l of [...this.listeners]) l();
  }
}
