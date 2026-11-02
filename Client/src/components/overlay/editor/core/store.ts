// AP09 – central editor state (Shared/Overlay/modules/README.md §1 EditorStore).
// dispatch() is the only way to change the draft; every change is undoable
// (D55: 200 steps, in the tab's memory). Selection, active variant, scrub and
// view are editor state, not part of the draft.
import { detach } from "../../document/dict";
import { effectiveConfig } from "../../document/resolve";
import type { Diagnostic, EffectiveConfig, OverlayDocument, ResolveContext } from "../../document/types";
import { validate } from "../../document/validate";
import type { Scrub } from "../../runtime/types";
import { applyCommand, commandLabel, withScope } from "./commands";
import type { GeometryContext } from "./geometry";
import {
  CommandError, type DispatchResult, type EditorCommand, type EditorState, type HistoryInfo, type Scope, type ViewState,
} from "./types";

export interface EditorStoreOptions {
  carId: number;
  document: OverlayDocument;
  /** D55 */
  historyLimit?: number;
  /** Consecutive commands with the same merge key within this time form one step. */
  mergeWindowMs?: number;
  now?: () => number;
  /** Refuse commands that introduce new structure diagnostics (default true). */
  guardStructure?: boolean;
}

interface Entry {
  label: string;
  before: OverlayDocument;
  after: OverlayDocument;
  selectionBefore: string[];
  selectionAfter: string[];
  scope: Scope;
  mergeKey?: string;
  at: number;
}

interface Transaction {
  label?: string;
  depth: number;
  before: OverlayDocument;
  selectionBefore: string[];
  scope: Scope;
}

export interface DispatchOptions {
  /** Undo label instead of the command's default. */
  label?: string;
  /** Merges with the previous step of the same key (e.g. typing in a number field). */
  mergeKey?: string;
}

export const DEFAULT_VIEW: ViewState = { zoom: 1, panX: 0, panY: 0, grid: { enabled: false, size: 10, snap: true }, enteredGroup: null };

type Listener = () => void;

const structureKeys = new WeakMap<OverlayDocument, Set<string>>();

function structureOf(doc: OverlayDocument): Set<string> {
  let keys = structureKeys.get(doc);
  if (!keys) {
    keys = new Set(validate(doc).filter((d) => d.category === "structure").map((d) => `${d.code} ${JSON.stringify(d.location)}`));
    structureKeys.set(doc, keys);
  }
  return keys;
}

export class EditorStore {
  private state: EditorState;
  private readonly listeners = new Set<Listener>();
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];
  private transaction: Transaction | undefined;
  private readonly historyLimit: number;
  private readonly mergeWindowMs: number;
  private readonly now: () => number;
  private readonly guard: boolean;
  private geometry: GeometryContext = {};
  private resolveContext: ResolveContext = {};
  private derivedCache: { doc?: OverlayDocument; scope?: Scope; effective?: EffectiveConfig; diagDoc?: OverlayDocument; diagCtx?: ResolveContext; diagnostics?: Diagnostic[] } = {};
  private replaced = 0;

  constructor(options: EditorStoreOptions) {
    this.historyLimit = options.historyLimit ?? 200;
    this.mergeWindowMs = options.mergeWindowMs ?? 1000;
    this.now = options.now ?? (() => Date.now());
    this.guard = options.guardStructure ?? true;
    this.state = {
      carId: options.carId,
      document: detach(options.document),
      activeVariant: null,
      selection: [],
      view: DEFAULT_VIEW,
      history: { canUndo: false, canRedo: false, size: 0 },
      version: 0,
    };
  }

  // --- Reading ---

  getState(): EditorState {
    return this.state;
  }

  get document(): OverlayDocument {
    return this.state.document;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Effective configuration of the active scope (AP01 resolver). */
  effective(): EffectiveConfig {
    const c = this.derivedCache;
    if (c.doc !== this.state.document || c.scope !== this.state.activeVariant || !c.effective) {
      c.doc = this.state.document;
      c.scope = this.state.activeVariant;
      c.effective = effectiveConfig(this.state.document, this.state.activeVariant);
    }
    return c.effective;
  }

  /** Document diagnostics with the current resolve context (AP01, formulas via AP06 when given). */
  diagnostics(): Diagnostic[] {
    const c = this.derivedCache;
    if (c.diagDoc !== this.state.document || c.diagCtx !== this.resolveContext || !c.diagnostics) {
      c.diagDoc = this.state.document;
      c.diagCtx = this.resolveContext;
      c.diagnostics = validate(this.state.document, this.resolveContext);
    }
    return c.diagnostics;
  }

  /** Streams, sources, assets and the expression analyzer for diagnostics. */
  setResolveContext(ctx: ResolveContext) {
    this.resolveContext = ctx;
    this.emit();
  }

  /** Asset sizes for geometry (svgAsset boxes). */
  setGeometryContext(ctx: GeometryContext) {
    this.geometry = ctx;
    this.emit();
  }

  get geometryContext(): GeometryContext {
    return this.geometry;
  }

  /** Increments on every replaceDocument; the autosave sends the next save as PUT (D63). */
  get replaceCount(): number {
    return this.replaced;
  }

  get inTransaction(): boolean {
    return this.transaction !== undefined;
  }

  // --- Changing the draft ---

  dispatch(command: EditorCommand, options: DispatchOptions = {}): DispatchResult {
    const cmd = withScope(command, this.state.activeVariant);
    const before = this.state.document;
    let after: OverlayDocument;
    try {
      after = applyCommand(before, cmd, this.geometry);
      if (this.guard && after !== before && cmd.type !== "replaceDocument") {
        const old = structureOf(before);
        const added = [...structureOf(after)].filter((k) => !old.has(k));
        if (added.length > 0) {
          const d = validate(after).find((x) => x.category === "structure" && added.includes(`${x.code} ${JSON.stringify(x.location)}`));
          throw new CommandError(d?.code ?? "OVL_EDITOR_INVALID", d?.message ?? "Änderung ergibt ein ungültiges Dokument");
        }
      }
    } catch (e) {
      const error = e instanceof CommandError ? e : new CommandError("OVL_EDITOR_FAILED", String(e instanceof Error ? e.message : e));
      this.set({ lastError: error });
      return { ok: false, error };
    }
    if (cmd.type === "replaceDocument") this.replaced++;
    if (after === before) {
      if (this.state.lastError) this.set({ lastError: undefined });
      return { ok: true };
    }
    const selectionBefore = this.state.selection;
    this.setDocument(after, this.state.selection, false);
    if (this.transaction) {
      this.emit();
    } else {
      this.record({
        label: options.label ?? commandLabel(cmd),
        before,
        after,
        selectionBefore,
        selectionAfter: this.state.selection,
        scope: this.state.activeVariant,
        mergeKey: options.mergeKey,
        at: this.now(),
      });
    }
    return { ok: true };
  }

  /** Groups the following dispatches into one undo step (drag, multi-part tools). Nests. */
  beginTransaction(label?: string) {
    if (this.transaction) {
      this.transaction.depth++;
      return;
    }
    this.transaction = { label, depth: 1, before: this.state.document, selectionBefore: this.state.selection, scope: this.state.activeVariant };
  }

  commitTransaction(label?: string) {
    const t = this.transaction;
    if (!t) return;
    if (--t.depth > 0) return;
    this.transaction = undefined;
    if (this.state.document !== t.before) {
      this.record({
        label: label ?? t.label ?? "Bearbeitung",
        before: t.before,
        after: this.state.document,
        selectionBefore: t.selectionBefore,
        selectionAfter: this.state.selection,
        scope: t.scope,
        at: this.now(),
      });
    } else {
      this.emit();
    }
  }

  /** Reverts all changes of the open transaction (e.g. Escape during a drag). */
  cancelTransaction() {
    const t = this.transaction;
    if (!t) return;
    this.transaction = undefined;
    this.setDocument(t.before, t.selectionBefore);
  }

  undo() {
    if (this.transaction) this.commitTransaction();
    const e = this.undoStack.pop();
    if (!e) return;
    this.redoStack.push(e);
    this.restore(e.before, e.selectionBefore, e.scope);
  }

  redo() {
    if (this.transaction) return;
    const e = this.redoStack.pop();
    if (!e) return;
    this.undoStack.push(e);
    this.restore(e.after, e.selectionAfter, e.scope);
  }

  /**
   * Replaces the draft without an undo step and clears the history: initial
   * load and "load server state" after a conflict (server wins).
   */
  load(document: OverlayDocument) {
    this.transaction = undefined;
    this.undoStack = [];
    this.redoStack = [];
    const doc = detach(document);
    const scope = this.state.activeVariant !== null && doc.variants?.[this.state.activeVariant] ? this.state.activeVariant : null;
    this.state = { ...this.state, activeVariant: scope };
    this.setDocument(doc);
  }

  // --- Editor state (not undoable) ---

  select(ids: string[], mode: "replace" | "add" | "toggle" | "remove" = "replace") {
    const known = this.effective().elements;
    const valid = ids.filter((id) => known[id] !== undefined);
    let next: string[];
    const current = this.state.selection;
    switch (mode) {
      case "replace": next = valid; break;
      case "add": next = [...current, ...valid.filter((id) => !current.includes(id))]; break;
      case "remove": next = current.filter((id) => !valid.includes(id)); break;
      case "toggle": next = [...current.filter((id) => !valid.includes(id)), ...valid.filter((id) => !current.includes(id))]; break;
    }
    if (next.length === current.length && next.every((id, i) => id === current[i])) return;
    this.set({ selection: next });
  }

  setActiveVariant(scope: Scope) {
    if (scope !== null && !this.state.document.variants?.[scope]) return;
    if (scope === this.state.activeVariant) return;
    if (this.transaction) this.commitTransaction();
    this.state = { ...this.state, activeVariant: scope, view: { ...this.state.view, enteredGroup: null } };
    this.set({ selection: this.prune(this.state.selection) });
  }

  setScrub(scrub: Scrub | undefined) {
    this.set({ scrub });
  }

  setView(view: Partial<ViewState>) {
    this.set({ view: { ...this.state.view, ...view, grid: { ...this.state.view.grid, ...view.grid } } });
  }

  clearError() {
    if (this.state.lastError) this.set({ lastError: undefined });
  }

  // --- Internals ---

  private record(entry: Entry) {
    const top = this.undoStack[this.undoStack.length - 1];
    if (entry.mergeKey && top?.mergeKey === entry.mergeKey && entry.at - top.at <= this.mergeWindowMs && this.redoStack.length === 0) {
      top.after = entry.after;
      top.selectionAfter = entry.selectionAfter;
      top.at = entry.at;
    } else {
      this.undoStack.push(entry);
      if (this.undoStack.length > this.historyLimit) this.undoStack.splice(0, this.undoStack.length - this.historyLimit);
    }
    this.redoStack = [];
    this.emit();
  }

  private restore(doc: OverlayDocument, selection: string[], scope: Scope) {
    const activeVariant = scope !== null && doc.variants?.[scope] ? scope : null;
    this.state = { ...this.state, activeVariant };
    this.setDocument(doc, selection);
  }

  private setDocument(document: OverlayDocument, selection = this.state.selection, notify = true) {
    const scope = this.state.activeVariant !== null && !document.variants?.[this.state.activeVariant] ? null : this.state.activeVariant;
    this.state = { ...this.state, document, activeVariant: scope, version: this.state.version + 1, lastError: undefined };
    const entered = this.state.view.enteredGroup;
    const pruned = this.prune(selection);
    const known = this.effective().elements;
    const view = entered !== null && !known[entered] ? { ...this.state.view, enteredGroup: null } : this.state.view;
    this.state = { ...this.state, selection: pruned, view };
    if (notify) this.emit();
  }

  private prune(selection: string[]): string[] {
    const known = this.effective().elements;
    const kept = selection.filter((id) => known[id] !== undefined);
    return kept.length === selection.length ? selection : kept;
  }

  private historyInfo(): HistoryInfo {
    const u = this.undoStack[this.undoStack.length - 1];
    const r = this.redoStack[this.redoStack.length - 1];
    return { canUndo: !!u, canRedo: !!r, undoLabel: u?.label, redoLabel: r?.label, size: this.undoStack.length };
  }

  private set(patch: Partial<EditorState>) {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  private emit() {
    const h = this.historyInfo();
    const old = this.state.history;
    if (old.canUndo !== h.canUndo || old.canRedo !== h.canRedo || old.undoLabel !== h.undoLabel || old.redoLabel !== h.redoLabel || old.size !== h.size) {
      this.state = { ...this.state, history: h };
    }
    for (const l of [...this.listeners]) l();
  }
}
