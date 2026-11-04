// AP13 – which HUD a stream shows (Overlay-Feature.md „Standard und Vererbung“):
// the stream's variant, otherwise the standard; a disabled variant or vehicle
// overlay means no HUD, never a fallback to the standard.
import { resolve, type EffectiveConfig } from "../document";
import type { FrameResult } from "../runtime/types";
import type { Publication } from "./published-overlay";

/** The effective configuration for a stream (its StreamId), or null for no HUD. */
export function hudConfigFor(publication: Publication | undefined, streamKey: string | undefined): EffectiveConfig | null {
  if (!publication || streamKey === undefined) return null;
  let result;
  try {
    result = resolve(publication.document, streamKey);
  } catch {
    // A document the resolver cannot handle stays off; video keeps running.
    return null;
  }
  if (result.kind !== "hud" || result.config.root.length === 0) return null;
  return result.config;
}

/** True when any shown element carries the pause marker (D09: values computed, not sent). */
export function showsPausedControl(frame: FrameResult): boolean {
  for (const el of Object.values(frame.elements)) {
    if (el.hidden) continue;
    if (el.marker === "paused") return true;
    for (const m of Object.values(el.markers)) if (m === "paused") return true;
    for (const part of Object.values(el.parts)) for (const m of Object.values(part.markers)) if (m === "paused") return true;
  }
  for (const clip of Object.values(frame.clips)) if (clip.marker === "paused") return true;
  return false;
}
