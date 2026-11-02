"use client";
// The AP09 editor with design ↔ preview switch and simulation panel. The
// preview replaces the design surface (no drag-and-drop while it runs); the
// simulation lives in a PreviewSession beside the editor store and never
// goes through editor commands, autosave or the hub.
import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { EditorStore } from "../editor/core/store";
import { useEditorState } from "../editor/canvas/hooks";
import { OverlayEditor, type OverlayEditorProps } from "../editor/overlay-editor";
import { createRuntime } from "../runtime/runtime";
import type { Clock } from "../runtime/types";
import type { Dependency, OverlaySourceProvider } from "../sources/types";
import { previewMessages } from "./messages";
import { OverlayPreview } from "./overlay-preview";
import { PreviewSession } from "./session";
import { SimulationPanel } from "./simulation-panel";

export interface OverlayEditorWithPreviewProps extends Omit<OverlayEditorProps, "stage"> {
  /** Live sources of the vehicle (AP05); simulated values are laid over them. */
  liveSource?: OverlaySourceProvider;
  /** Display port of the real stream in the preview (AP13). */
  videoLayer?: (hud: ReactNode) => ReactNode;
  /** Base clock of the preview time (tests). */
  previewClock?: Clock;
  /** Gives the host access to the preview session. */
  onPreviewReady?: (session: PreviewSession) => void;
  /** Initial mode (tests, deep links). */
  initialMode?: "design" | "preview";
}

/** Runtime dependencies of the active view: what the simulation panel lists. */
export function useHudDependencies(store: EditorStore): Dependency[] {
  useEditorState(store);
  const config = store.effective();
  return useMemo(() => {
    try {
      return createRuntime(config).dependencies();
    } catch {
      return [];
    }
  }, [config]);
}

function PreviewStage({ store, session, props }: { store: EditorStore; session: PreviewSession; props: OverlayEditorWithPreviewProps }) {
  useEditorState(store);
  return (
    <OverlayPreview
      session={session}
      config={store.effective()}
      assets={props.assets}
      locale={props.locale}
      m={previewMessages[props.locale] ?? previewMessages.de}
      videoLayer={props.videoLayer}
      className="flex-1 min-h-[300px] rounded border border-amber-600/60"
    />
  );
}

function PreviewPanel({ store, session, locale }: { store: EditorStore; session: PreviewSession; locale: OverlayEditorProps["locale"] }) {
  const dependencies = useHudDependencies(store);
  return <SimulationPanel session={session} m={previewMessages[locale] ?? previewMessages.de} dependencies={dependencies} />;
}

const NO_SUBSCRIBE = () => () => {};

/** Current mode; design while there is no session yet. */
function useMode(session: PreviewSession | null) {
  return useSyncExternalStore(
    session ? (l) => session.subscribe(l) : NO_SUBSCRIBE,
    () => session?.getState().mode ?? "design",
    () => session?.getState().mode ?? "design",
  );
}

export function OverlayEditorWithPreview(props: OverlayEditorWithPreviewProps) {
  const { liveSource, videoLayer: _videoLayer, previewClock, onPreviewReady, initialMode, onReady, children, ...editor } = props;
  const [store, setStore] = useState<EditorStore | null>(null);
  const [session, setSession] = useState<PreviewSession | null>(null);
  const latest = useRef({ liveSource, initialMode, onPreviewReady });
  latest.current = { liveSource, initialMode, onPreviewReady };
  // Created in an effect so that a (strict mode) remount never reuses a disposed session.
  useEffect(() => {
    const s = new PreviewSession({ live: latest.current.liveSource, clock: previewClock });
    if (latest.current.initialMode === "preview") s.enterPreview();
    setSession(s);
    latest.current.onPreviewReady?.(s);
    return () => {
      s.dispose();
      setSession(null);
    };
  }, [props.carId, previewClock]);
  useEffect(() => { session?.setLive(liveSource); }, [session, liveSource]);
  const mode = useMode(session);

  return (
    <OverlayEditor
      {...editor}
      source={editor.source ?? liveSource}
      onReady={(api) => { setStore(api.store); onReady?.(api); }}
      stage={mode === "preview" && store && session ? <PreviewStage store={store} session={session} props={props} /> : undefined}
    >
      {store && session && <PreviewPanel store={store} session={session} locale={props.locale} />}
      {children}
    </OverlayEditor>
  );
}

export default OverlayEditorWithPreview;
