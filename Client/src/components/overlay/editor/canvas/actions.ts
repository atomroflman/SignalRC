// Editor actions behind toolbar buttons and shortcuts; React-free and testable.
import { deletionImpact, type DeletionImpact } from "../../document/deletion";
import type { ElementType } from "../../document/types";
import { allElementIds } from "../core/commands";
import { layout, staticPropsOf } from "../core/geometry";
import type { EditorStore } from "../core/store";
import {
  alignCommands, dispatchAll, distributeCommands, duplicateCommand, groupCommand, newElement, newElementId, topLevel, type AlignMode,
} from "../core/tools";

export const placementsOf = (store: EditorStore) => layout(store.effective(), staticPropsOf, store.geometryContext);

export type DeletePlan =
  | { kind: "none" }
  /** Inherited elements in a variant cannot be deleted there; they can be disabled. */
  | { kind: "inherited"; ids: string[] }
  | { kind: "direct"; ids: string[] }
  | { kind: "confirm"; ids: string[]; impact: DeletionImpact };

/** What deleting the selection means; standard deletions with consequences need a confirmation. */
export function planDelete(store: EditorStore, ids = store.getState().selection): DeletePlan {
  const config = store.effective();
  const items = topLevel(config, ids.filter((id) => config.elements[id]));
  if (items.length === 0) return { kind: "none" };
  const scope = store.getState().activeVariant;
  if (scope !== null) {
    const inherited = items.filter((id) => config.elements[id].origin === "standard");
    return inherited.length > 0 ? { kind: "inherited", ids: inherited } : { kind: "direct", ids: items };
  }
  const impact = deletionImpact(store.document, items);
  const consequences = impact.elements.length > items.length || impact.clips.length > 0 || impact.variants.length > 0;
  return consequences ? { kind: "confirm", ids: items, impact } : { kind: "direct", ids: items };
}

export function deleteNow(store: EditorStore, ids: string[]) {
  return store.dispatch({ type: "deleteElements", ids });
}

/** Variant alternative to deleting: disable the inherited elements in this variant only. */
export function disableInVariant(store: EditorStore, ids: string[]) {
  store.beginTransaction("Deaktivieren");
  for (const id of ids) store.dispatch({ type: "setAttribute", element: id, name: "disabled", value: true });
  store.commitTransaction();
}

export function groupSelection(store: EditorStore) {
  const cmd = groupCommand(store.effective(), placementsOf(store), store.getState().selection, newElementId(store));
  if (!cmd) return false;
  const ok = store.dispatch(cmd).ok;
  if (ok && cmd.type === "groupElements") store.select([cmd.groupId]);
  return ok;
}

export function ungroupSelection(store: EditorStore) {
  const config = store.effective();
  const groups = store.getState().selection.filter((id) => config.elements[id]?.type === "group");
  if (groups.length === 0) return false;
  const children = groups.flatMap((g) => config.elements[g].children ?? []);
  store.beginTransaction("Gruppe auflösen");
  let ok = true;
  for (const g of groups) ok = store.dispatch({ type: "ungroup", group: g }).ok && ok;
  store.commitTransaction();
  store.select(children);
  return ok;
}

export function duplicateSelection(store: EditorStore) {
  const cmd = duplicateCommand(store.effective(), store.getState().selection, allElementIds(store.document));
  if (!cmd || cmd.type !== "addElements") return false;
  const ok = store.dispatch(cmd, { label: "Duplizieren" }).ok;
  if (ok) store.select(cmd.roots);
  return ok;
}

export function align(store: EditorStore, mode: AlignMode) {
  return dispatchAll(store, alignCommands(store.effective(), placementsOf(store), store.getState().selection, mode), "Ausrichten");
}

export function distribute(store: EditorStore, axis: "x" | "y") {
  return dispatchAll(store, distributeCommands(store.effective(), placementsOf(store), store.getState().selection, axis), "Verteilen");
}

/** Inserts a new element in the workspace center (inside the entered group if any). */
export function insertElement(store: EditorStore, type: ElementType, defaults: { stream?: string } = {}) {
  const ws = store.effective().workspace;
  const id = newElementId(store);
  const container = store.getState().view.enteredGroup ?? undefined;
  const el = newElement(type, container ? { x: 0, y: 0 } : { x: ws.width / 2 - 50, y: ws.height / 2 - 50 }, defaults);
  const ok = store.dispatch({ type: "addElements", elements: { [id]: el }, roots: [id], container }).ok;
  if (ok) store.select([id]);
  return ok;
}
