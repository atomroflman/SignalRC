// Consequences of deleting standard elements (product plan "Standard und
// Vererbung"): the editor shows them before the user confirms.
import { buildView } from "./resolve";
import { ROOT, type Clip, type ClipSettings, type OverlayDocument, type Track } from "./types";

export interface VariantImpact {
  streamId: string;
  /** Overrides of deleted standard elements. */
  overrides: string[];
  /** Variant-added elements inside a deleted group, with their descendants. */
  addedElements: string[];
  /** Regrouping entries that name a deleted element. */
  structureEntries: string[];
  /** Overridden or added clips losing tracks. */
  clips: { clip: string; tracks: number[] }[];
}

export interface DeletionImpact {
  /** Deleted standard elements including descendants. */
  elements: string[];
  /** Standard clips losing tracks; a clip is kept even when it loses all of them. */
  clips: { clip: string; tracks: number[] }[];
  variants: VariantImpact[];
}

const ordinal = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function descendants(children: Map<string, string[]>, roots: Iterable<string>): Set<string> {
  const result = new Set<string>();
  const visit = (id: string) => {
    if (result.has(id)) return;
    result.add(id);
    for (const child of children.get(id) ?? []) visit(child);
  };
  for (const id of roots) visit(id);
  return result;
}

const affectedTracks = (tracks: Track[] | undefined, removed: Set<string>) =>
  (tracks ?? []).flatMap((t, i) => (removed.has(t.element) ? [i] : []));

/** What deleting the given standard elements removes. Unknown ids are ignored. */
export function deletionImpact(doc: OverlayDocument, ids: string[]): DeletionImpact {
  const standard = buildView(doc);
  const removed = descendants(standard.children, ids.filter((id) => doc.elements[id] !== undefined));

  const clips = Object.entries(doc.clips ?? {})
    .map(([clip, c]) => ({ clip, tracks: affectedTracks(c.tracks, removed) }))
    .filter((c) => c.tracks.length > 0)
    .sort((a, b) => ordinal(a.clip, b.clip));

  const variants: VariantImpact[] = [];
  for (const [streamId, variant] of Object.entries(doc.variants ?? {}).sort(([a], [b]) => ordinal(a, b))) {
    const view = buildView(doc, variant);
    const inRemoved = [...view.elements.keys()].filter((id) => {
      if (view.elements.get(id)!.origin !== "variant") return false;
      for (let p = view.parent.get(id); p !== undefined && p !== ROOT; p = view.parent.get(p)) {
        if (removed.has(p)) return true;
      }
      return false;
    });
    const added = descendants(view.children, inRemoved);
    const gone = new Set([...removed, ...added]);
    const impact: VariantImpact = {
      streamId,
      overrides: Object.keys(variant.elements ?? {}).filter((id) => removed.has(id)).sort(ordinal),
      addedElements: [...added].sort(ordinal),
      structureEntries: Object.entries(variant.structure?.parents ?? {})
        .filter(([id, target]) => gone.has(id) || gone.has(target)).map(([id]) => id).sort(ordinal),
      clips: [
        ...Object.entries(variant.clips ?? {}).map(([clip, c]) => ({ clip, tracks: affectedTracks(c.tracks, gone) })),
        ...Object.entries(variant.addedClips ?? {}).map(([clip, c]) => ({ clip, tracks: affectedTracks(c.tracks, gone) })),
      ].filter((c) => c.tracks.length > 0).sort((a, b) => ordinal(a.clip, b.clip)),
    };
    if (impact.overrides.length || impact.addedElements.length || impact.structureEntries.length || impact.clips.length) {
      variants.push(impact);
    }
  }
  return { elements: [...removed].sort(ordinal), clips, variants };
}

/** Returns a copy of the document with the elements and all dependent adjustments removed. */
export function deleteElements(doc: OverlayDocument, ids: string[]): OverlayDocument {
  const impact = deletionImpact(doc, ids);
  const next = structuredClone(doc);
  const removed = new Set(impact.elements);
  const dropTracks = <T extends ClipSettings | Clip>(clip: T, gone: Set<string>): T =>
    clip.tracks ? { ...clip, tracks: clip.tracks.filter((t) => !gone.has(t.element)) } : clip;

  for (const id of removed) delete next.elements[id];
  next.children = next.children.filter((id) => !removed.has(id));
  for (const element of Object.values(next.elements)) {
    if (element.children) element.children = element.children.filter((id) => !removed.has(id));
  }
  for (const [id, clip] of Object.entries(next.clips ?? {})) next.clips![id] = dropTracks(clip, removed);

  for (const v of impact.variants) {
    const variant = next.variants![v.streamId];
    const gone = new Set([...removed, ...v.addedElements]);
    for (const id of v.overrides) delete variant.elements![id];
    for (const id of v.addedElements) delete variant.addedElements![id];
    for (const element of Object.values(variant.addedElements ?? {})) {
      if (element.children) element.children = element.children.filter((id) => !gone.has(id));
    }
    for (const id of v.structureEntries) delete variant.structure!.parents![id];
    const order = variant.structure?.order;
    if (order) {
      for (const container of Object.keys(order)) {
        if (gone.has(container)) delete order[container];
        else order[container] = order[container].filter((id) => !gone.has(id));
      }
    }
    for (const [id, clip] of Object.entries(variant.clips ?? {})) variant.clips![id] = dropTracks(clip, gone);
    for (const [id, clip] of Object.entries(variant.addedClips ?? {})) variant.addedClips![id] = dropTracks(clip, gone);
  }
  return next;
}
