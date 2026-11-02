// AP13 – channel management warnings (Overlay-Feature.md „Veröffentlichungsprüfung
// und Kanaländerungen“): before deleting or renaming a channel, show where the
// published HUD and the shared draft use it (GET dependencies?channel=, AP02).
// After confirmation the change stays allowed.
import type { IntegrationMessages } from "./messages";

export type ChannelDependencyResult =
  | { checked: true; draft: number; published: number }
  | { checked: false; status?: number };

type Fetch = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export async function loadChannelDependencies(carId: number, channel: string, f: Fetch = fetch): Promise<ChannelDependencyResult> {
  try {
    const r = await f(`/api/cars/${carId}/overlay/dependencies?channel=${encodeURIComponent(channel)}`);
    if (!r.ok) return { checked: false, status: r.status };
    const body = (await r.json()) as { draft?: unknown; published?: unknown } | null;
    const count = (v: unknown) => (Array.isArray(v) ? v.length : 0);
    return { checked: true, draft: count(body?.draft), published: count(body?.published) };
  } catch {
    return { checked: false };
  }
}

/** Warning lines for the confirmation, or none when the HUD does not use the channel. */
export function dependencyWarning(result: ChannelDependencyResult, channel: string, m: IntegrationMessages["channels"]): string[] {
  if (!result.checked) return [m.notChecked];
  if (result.draft === 0 && result.published === 0) return [];
  const lines = [m.usedBy(channel)];
  if (result.published > 0) lines.push(`• ${m.inPublished(result.published)}`);
  if (result.draft > 0) lines.push(`• ${m.inDraft(result.draft)}`);
  lines.push(m.consequence);
  return lines;
}

/** The text of a delete/rename confirmation with the HUD warning appended. */
export function confirmationText(question: string, warning: string[], m: IntegrationMessages["channels"]): string {
  return warning.length === 0 ? question : `${question}\n\n${warning.join("\n")}\n\n${m.proceed}`;
}
