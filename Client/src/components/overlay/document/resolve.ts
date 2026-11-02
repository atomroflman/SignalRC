// Variant resolution (Shared/Overlay/README.md §7).
import { defaultLockAspect } from "./catalog";
import {
  ROOT,
  type Clip,
  type EffectiveClip,
  type EffectiveConfig,
  type EffectiveElement,
  type OverlayDocument,
  type OverlayElement,
  type PartOverride,
  type ResolveResult,
  type ValueOrigin,
  type Variant,
} from "./types";

const ordinal = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export type TreeIssue =
  | { kind: "unknownChild"; container: string; ref: string }
  | { kind: "multipleParents"; element: string }
  | { kind: "orphan"; element: string }
  | { kind: "cycle"; element: string }
  | { kind: "unknownParent"; element: string; ref: string }
  | { kind: "notAGroup"; element: string; ref: string };

export interface View {
  elements: Map<string, { element: OverlayElement; origin: ValueOrigin }>;
  parent: Map<string, string>;
  children: Map<string, string[]>;
  /** Elements reachable from the root, in tree order. */
  reachable: string[];
  issues: TreeIssue[];
}

/** Builds the effective tree of the standard (variant undefined) or of a variant. */
export function buildView(doc: OverlayDocument, variant?: Variant): View {
  const elements = new Map<string, { element: OverlayElement; origin: ValueOrigin }>();
  for (const [id, element] of Object.entries(doc.elements)) elements.set(id, { element, origin: "standard" });
  for (const [id, element] of Object.entries(variant?.addedElements ?? {})) {
    if (!elements.has(id)) elements.set(id, { element, origin: "variant" });
  }
  const issues: TreeIssue[] = [];
  const isContainer = (id: string) => id === ROOT || elements.get(id)?.element.type === "group";

  // Declared containment from the children arrays.
  const declaredChildren = new Map<string, string[]>();
  const declaredParents = new Map<string, string[]>();
  const declare = (container: string, list: string[]) => {
    const known: string[] = [];
    for (const child of list) {
      if (!elements.has(child)) {
        issues.push({ kind: "unknownChild", container, ref: child });
        continue;
      }
      known.push(child);
      const parents = declaredParents.get(child) ?? [];
      parents.push(container);
      declaredParents.set(child, parents);
    }
    declaredChildren.set(container, known);
  };
  declare(ROOT, doc.children);
  for (const [id, { element }] of elements) {
    if (element.type === "group") declare(id, element.children ?? []);
  }

  // Effective parent: variant structure wins (D38), else the declared one.
  const moved = variant?.structure?.parents ?? {};
  const parent = new Map<string, string>();
  for (const id of elements.keys()) {
    const declared = declaredParents.get(id) ?? [];
    if (declared.length > 1) issues.push({ kind: "multipleParents", element: id });
    const target = moved[id];
    if (target !== undefined) {
      if (target !== ROOT && !elements.has(target)) {
        issues.push({ kind: "unknownParent", element: id, ref: target });
      } else if (!isContainer(target)) {
        issues.push({ kind: "notAGroup", element: id, ref: target });
      } else {
        parent.set(id, target);
        continue;
      }
    }
    if (declared.length > 0) parent.set(id, declared[0]);
  }

  // Children per container: order override, then declared order, then moved-in by id.
  const children = new Map<string, string[]>();
  const containers = [ROOT, ...[...elements.keys()].filter((id) => elements.get(id)!.element.type === "group")];
  for (const container of containers) {
    const inside = (id: string) => parent.get(id) === container;
    const result: string[] = [];
    const taken = new Set<string>();
    const take = (id: string) => {
      if (!taken.has(id) && inside(id)) {
        taken.add(id);
        result.push(id);
      }
    };
    for (const id of variant?.structure?.order?.[container] ?? []) take(id);
    for (const id of declaredChildren.get(container) ?? []) take(id);
    const movedIn = [...elements.keys()].filter((id) => inside(id) && !taken.has(id)).sort(ordinal);
    movedIn.forEach(take);
    children.set(container, result);
  }

  // Cycles: walking up from an element returns to it.
  const onCycle = new Set<string>();
  for (const id of elements.keys()) {
    const seen = new Set<string>();
    let current: string | undefined = id;
    while (current !== undefined && current !== ROOT && !seen.has(current)) {
      seen.add(current);
      current = parent.get(current);
    }
    if (current === id) onCycle.add(id);
  }
  for (const id of onCycle) issues.push({ kind: "cycle", element: id });

  const reachable: string[] = [];
  const visit = (container: string) => {
    for (const child of children.get(container) ?? []) {
      reachable.push(child);
      visit(child);
    }
  };
  visit(ROOT);

  for (const id of elements.keys()) {
    if (!parent.has(id) && !onCycle.has(id)) issues.push({ kind: "orphan", element: id });
  }
  return { elements, parent, children, reachable, issues };
}

function mergeParts(
  base: Record<string, PartOverride> | undefined,
  over: Record<string, PartOverride> | undefined,
): Record<string, PartOverride> {
  const result: Record<string, PartOverride> = {};
  for (const [id, part] of Object.entries(base ?? {})) result[id] = { ...part, props: { ...part.props } };
  for (const [id, part] of Object.entries(over ?? {})) {
    const current = result[id] ?? {};
    result[id] = {
      ...current,
      ...(part.lockAspect !== undefined ? { lockAspect: part.lockAspect } : {}),
      props: { ...current.props, ...part.props },
    };
  }
  return result;
}

function effectiveClips(doc: OverlayDocument, variant?: Variant): Record<string, EffectiveClip> {
  const result: Record<string, EffectiveClip> = {};
  const add = (id: string, clip: Clip, origin: ValueOrigin) => {
    result[id] = { ...clip, id, origin, overridden: [] };
  };
  for (const [id, clip] of Object.entries(doc.clips ?? {})) add(id, clip, "standard");
  for (const [id, clip] of Object.entries(variant?.addedClips ?? {})) if (!result[id]) add(id, clip, "variant");
  for (const [id, override] of Object.entries(variant?.clips ?? {})) {
    const clip = result[id];
    if (!clip || clip.origin !== "standard") continue;
    for (const [key, value] of Object.entries(override)) {
      if (value === undefined) continue;
      (clip as unknown as Record<string, unknown>)[key] = value;
      clip.overridden.push(key);
    }
  }
  return result;
}

/** Effective configuration of the standard (streamId null) or a stream, without enable checks. */
export function effectiveConfig(doc: OverlayDocument, streamId: string | null): EffectiveConfig {
  const variant = streamId === null ? undefined : doc.variants?.[streamId];
  const view = buildView(doc, variant);
  const elements: Record<string, EffectiveElement> = {};

  const build = (id: string, parentDisabled: boolean) => {
    const { element, origin } = view.elements.get(id)!;
    const override = origin === "standard" ? variant?.elements?.[id] : undefined;
    const props = { ...element.props };
    const propOrigins: Record<string, ValueOrigin> = {};
    for (const key of Object.keys(props)) propOrigins[key] = origin;
    for (const [key, value] of Object.entries(override?.props ?? {})) {
      props[key] = value;
      propOrigins[key] = "variant";
    }
    const disabled = override?.disabled ?? element.disabled ?? false;
    const effective: EffectiveElement = {
      id,
      type: element.type,
      origin,
      parent: view.parent.get(id)!,
      disabled,
      effectiveDisabled: parentDisabled || disabled,
      locked: override?.locked ?? element.locked ?? false,
      editorHidden: override?.editorHidden ?? element.editorHidden ?? false,
      lockAspect: override?.lockAspect ?? element.lockAspect ?? defaultLockAspect(element.type),
      onInvalid: override?.onInvalid ?? element.onInvalid ?? "hold",
      props,
      propOrigins,
      parts: mergeParts(element.parts, override?.parts),
    };
    if (element.name !== undefined) effective.name = element.name;
    if (element.type === "group") effective.children = view.children.get(id) ?? [];
    if (element.assetId !== undefined) effective.assetId = element.assetId;
    if (element.source !== undefined) effective.source = element.source;
    elements[id] = effective;
    for (const child of view.children.get(id) ?? []) build(child, effective.effectiveDisabled);
  };
  const root = view.children.get(ROOT) ?? [];
  for (const id of root) build(id, false);

  const config: EffectiveConfig = {
    streamId,
    workspace: variant?.workspace ?? doc.workspace,
    signals: doc.signals ?? {},
    sources: { telemetry: doc.sources?.telemetry ?? {} },
    root,
    elements,
    clips: effectiveClips(doc, variant),
  };
  const rootTransform = variant?.workspace ? variant.rootTransform : (variant?.rootTransform ?? doc.rootTransform);
  if (rootTransform) config.rootTransform = rootTransform;
  return config;
}

/**
 * Configuration shown for a stream: none when the vehicle overlay or the
 * stream's variant is disabled (no fallback to the standard), else the
 * variant or, without one, the standard.
 */
export function resolve(doc: OverlayDocument, streamId: string): ResolveResult {
  if (doc.disabled) return { kind: "none", reason: "vehicleDisabled" };
  const variant = doc.variants?.[streamId];
  if (variant?.disabled) return { kind: "none", reason: "variantDisabled" };
  return { kind: "hud", config: effectiveConfig(doc, variant ? streamId : null) };
}
