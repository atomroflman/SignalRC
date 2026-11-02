// AP13 – publishing, history and restore of the editor page (Overlay-Feature.md
// „Veröffentlichung und Versionsverlauf“, api/README.md §3). Publishing is an
// explicit action on the saved draft revision; restore replaces the shared
// draft after confirmation and leaves the displayed HUD unchanged.
import type { Diagnostic } from "../document/types";
import type { SaveController, SaveState } from "../editor/persistence/autosave";
import { OverlayApiError, type OverlayPersistence, type PublicationInfo } from "../editor/persistence/types";
import type { ControlReason } from "./editor-control";

/** D54. */
export const NOTE_MAX = 500;

/** Diagnostics that block publishing: everything but warnings (canPublish, AP01). */
export function publishBlockers(diagnostics: Diagnostic[]): Diagnostic[] {
  return diagnostics.filter((d) => d.category !== "warning");
}

export type Unavailable = "noControl" | "loading" | "conflict" | "error" | "blocked" | "noteTooLong";

/** Why the publish button is disabled, or null when it may be pressed. */
export function publishUnavailable(save: Pick<SaveState, "status" | "hasControl">, blockers: Diagnostic[], note: string): Unavailable | null {
  if (!save.hasControl || save.status === "localOnly") return "noControl";
  if (save.status === "loading") return "loading";
  if (save.status === "conflict") return "conflict";
  if (blockers.length > 0) return "blocked";
  if (note.trim().length > NOTE_MAX) return "noteTooLong";
  return null;
}

/** Server answers of OverlayAccess (D73). */
export function isAccessDenied(code: string | undefined): boolean {
  return code === "OVL_API_NOT_DRIVER" || code === "OVL_API_SESSION_REQUIRED";
}

export type NoControlHint = Exclude<ControlReason, "control"> | "denied" | "localOnly";

/**
 * The reason shown under a disabled publish button when unavailable is
 * "noControl": the client view (controlReason) first; if that says control,
 * the server refused (403) or the draft is otherwise local only.
 */
export function noControlHint(reason: ControlReason, save: Pick<SaveState, "error">): NoControlHint {
  if (reason !== "control") return reason;
  return isAccessDenied(save.error?.code) ? "denied" : "localOnly";
}

export type ActionFailure =
  | { kind: "noControl" }
  | { kind: "conflict" }
  /** The draft could not be saved first (see the save status). */
  | { kind: "notSaved" }
  | { kind: "blocked"; diagnostics: Diagnostic[] }
  | { kind: "failed"; status?: number; code?: string; message: string };

export type PublishOutcome = { kind: "published"; publicationId: number; number: number; warnings: Diagnostic[] } | ActionFailure;
export type RestoreOutcome = { kind: "restored"; revision: number } | ActionFailure;

function failure(e: unknown): ActionFailure {
  if (e instanceof OverlayApiError) {
    if (isAccessDenied(e.code)) return { kind: "noControl" };
    if (e.status === 409) return { kind: "conflict" };
    if (e.code === "OVL_API_PUBLISH_BLOCKED") return { kind: "blocked", diagnostics: e.diagnostics ?? [] };
    return { kind: "failed", status: e.status, code: e.code, message: e.message };
  }
  return { kind: "failed", message: e instanceof Error ? e.message : String(e) };
}

/** Saves pending changes first; the server revision is the base of the action. */
async function savedRevision(save: SaveController): Promise<number | ActionFailure> {
  await save.flush();
  const s = save.getState();
  if (!s.hasControl || s.status === "localOnly") return { kind: "noControl" };
  if (s.status === "conflict") return { kind: "conflict" };
  if (s.dirty || s.status !== "saved" || s.baseRevision === undefined) return { kind: "notSaved" };
  return s.baseRevision;
}

export interface ActionDeps {
  carId: number;
  save: SaveController;
  persistence: OverlayPersistence;
}

/** Publishes the saved draft with an optional note. Never publishes unsaved local changes. */
export async function publishDraft({ carId, save, persistence }: ActionDeps, note: string): Promise<PublishOutcome> {
  const text = note.trim();
  if (text.length > NOTE_MAX) return { kind: "failed", code: "OVL_API_INVALID_REQUEST", message: "note too long" };
  const base = await savedRevision(save);
  if (typeof base !== "number") return base;
  try {
    const r = await persistence.publish(carId, base, text === "" ? undefined : text);
    return { kind: "published", publicationId: r.publicationId, number: r.number, warnings: r.warnings ?? [] };
  } catch (e) {
    return failure(e);
  }
}

/**
 * Replaces the shared draft by a publication (after confirmation by the
 * caller) and loads it into the editor. Local changes are saved before and
 * remain in the draft history; the published HUD stays as it is.
 */
export async function restorePublication({ carId, save, persistence }: ActionDeps, publicationId: number): Promise<RestoreOutcome> {
  const base = await savedRevision(save);
  if (typeof base !== "number") return base;
  let revision: number;
  try {
    revision = (await persistence.restore(carId, publicationId, base)).revision;
  } catch (e) {
    return failure(e);
  }
  await save.loadServerState();
  const s = save.getState();
  if (s.baseRevision !== undefined && s.baseRevision >= revision) return { kind: "restored", revision: s.baseRevision };
  return s.status === "conflict" ? { kind: "conflict" } : { kind: "notSaved" };
}

/** The newest publication is the active one (api/README.md §2). */
export function activePublication(list: PublicationInfo[]): PublicationInfo | undefined {
  let best: PublicationInfo | undefined;
  for (const p of list) if (!best || p.number > best.number) best = p;
  return best;
}

/** History in display order: newest first. */
export const sortHistory = (list: PublicationInfo[]) => [...list].sort((a, b) => b.number - a.number);
