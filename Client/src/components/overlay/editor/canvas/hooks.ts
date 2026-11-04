"use client";
// React bindings of the editor store and the save controller (useSyncExternalStore).
import { useSyncExternalStore } from "react";
import type { EditorStore } from "../core/store";
import type { EditorState } from "../core/types";
import type { SaveController, SaveState } from "../persistence/autosave";

export function useEditorState(store: EditorStore): EditorState {
  return useSyncExternalStore(
    (l) => store.subscribe(l),
    () => store.getState(),
    () => store.getState(),
  );
}

export function useSaveState(save: SaveController): SaveState {
  return useSyncExternalStore(
    (l) => save.subscribe(l),
    () => save.getState(),
    () => save.getState(),
  );
}
