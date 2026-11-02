// AP13 – control rules of the overlay editor (Overlay-Feature.md „Gestaltungsmodus
// und Vorschau-Modus“, api/README.md §1, §6): who may manage the overlay, the
// sending pause on opening, the deliberate live-test release and the separation
// of editor keyboard input from vehicle input.

/** The parts of the control flow store used here (control-flow-store.ts). */
export interface PauseStoreLike {
  getState(): {
    updatesEnabled: boolean;
    isInConfigMode: boolean;
    editorPaused: boolean;
    carSession?: string;
    carId?: number;
    pauseForOverlayEditor(): void;
    setUpdatesEnabled(enabled: boolean): void;
  };
}

/**
 * Opening the editor pauses sending and resend timers of this client session.
 * Leaving does nothing: there is no automatic reactivation.
 */
export function pauseOnEditorOpen(store: PauseStoreLike): void {
  store.getState().pauseForOverlayEditor();
}

/** Explicit live-test release (button); ends the editor pause. */
export function releaseForLiveTest(store: PauseStoreLike): void {
  store.getState().setUpdatesEnabled(true);
}

/** Pauses again after a live test. */
export function endLiveTest(store: PauseStoreLike): void {
  store.getState().pauseForOverlayEditor();
}

export type SendState =
  /** Control values are being sent to the vehicle. */
  | "live"
  /** Sending is paused (editor, manual pause or configuration mode). */
  | "paused"
  /** This client has no control session; nothing is sent either way. */
  | "noSession";

/** What the editor's status banner shows; same pause rule as the control display (§7). */
export function sendState(s: { updatesEnabled: boolean; isInConfigMode: boolean; carSession?: string; carId?: number }, carId: number): SendState {
  if (!s.carSession || s.carId !== carId) return "noSession";
  return s.updatesEnabled && !s.isInConfigMode ? "live" : "paused";
}

// --- Management permission ---

export interface MeLike {
  userId?: number | string | null;
  loginName?: string | null;
}

export interface CarStateLike {
  isConnected: boolean;
  driverId?: string | null;
}

/**
 * Client view of OverlayAccess (regular login and active control). The server
 * checks every request; this only decides whether the editor tries server access.
 * - no regular login → false;
 * - vehicle connected → the announced driver (CarStateUpdated) must be this user;
 * - vehicle state unknown or offline → true: the server decides, a 403
 *   OVL_API_NOT_DRIVER puts the editor into local-only mode.
 */
export function deriveHasControl(me: MeLike | null | undefined, car: CarStateLike | undefined): boolean {
  if (!me || !me.loginName || me.userId == null) return false;
  if (car?.isConnected) return car.driverId != null && car.driverId === String(me.userId);
  return true;
}

// --- Keyboard separation ---

interface KeyEventLike {
  stopPropagation(): void;
}

export interface KeyTargetLike {
  addEventListener(type: string, listener: (e: KeyEventLike) => void, capture?: boolean): void;
  removeEventListener(type: string, listener: (e: KeyEventLike) => void, capture?: boolean): void;
}

export const GUARDED_KEY_EVENTS = ["keydown", "keyup", "keypress"] as const;

let guards = 0;

/** Whether an editor keyboard guard is installed; window-level key handlers for vehicle input check this. */
export function isEditorKeyboardGuarded(): boolean {
  return guards > 0;
}

/**
 * While the editor is open, key events end at the document (bubble phase):
 * React handlers of the editor have already run there, window-level handlers
 * (keyboard driving, push-to-talk keys) never see them. Returns the uninstaller.
 */
export function installEditorKeyboardGuard(doc: KeyTargetLike): () => void {
  const stop = (e: KeyEventLike) => e.stopPropagation();
  for (const type of GUARDED_KEY_EVENTS) doc.addEventListener(type, stop, false);
  guards++;
  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    guards--;
    for (const type of GUARDED_KEY_EVENTS) doc.removeEventListener(type, stop, false);
  };
}
