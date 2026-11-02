// AP13 – personal HUD visibility (Overlay-Feature.md „Persönliche Sichtbarkeit“):
// browser-local per vehicle, for all its streams. Without a stored choice a
// published HUD is shown; reloads and new publications keep the choice.

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const hudVisibilityKey = (carId: number) => `signalrc.overlay.hudHidden.${carId}`;

function browserStorage(): KeyValueStorage | undefined {
  try {
    return typeof window !== "undefined" ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
}

export function isHudHidden(carId: number, storage: KeyValueStorage | undefined = browserStorage()): boolean {
  try {
    return storage?.getItem(hudVisibilityKey(carId)) === "1";
  } catch {
    return false;
  }
}

export function setHudHidden(carId: number, hidden: boolean, storage: KeyValueStorage | undefined = browserStorage()) {
  try {
    if (hidden) storage?.setItem(hudVisibilityKey(carId), "1");
    else storage?.removeItem(hudVisibilityKey(carId));
  } catch {
    // Private mode or blocked storage: the choice lasts for this page only.
  }
}
