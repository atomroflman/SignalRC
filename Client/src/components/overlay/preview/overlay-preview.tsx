"use client";
// Running preview: the whole HUD with the same runtime as the driver view
// (runtime §7), fed by the preview source and clock. No selection, handles or
// drag-and-drop here. The real stream is shown behind it when the host
// provides one through `videoLayer` (AP13).
import React, { type ReactNode } from "react";
import type { EffectiveConfig } from "../document/types";
import { OverlayRenderer } from "../runtime/overlay-renderer";
import type { FrameResult, Locale, RuntimeAsset, RuntimeDiagnostic } from "../runtime/types";
import type { PreviewMessages } from "./messages";
import type { PreviewSession } from "./session";
import { usePreviewState } from "./simulation-panel";

export interface OverlayPreviewProps {
  session: PreviewSession;
  config: EffectiveConfig;
  assets?: Record<string, RuntimeAsset>;
  locale: Locale;
  m: PreviewMessages;
  /**
   * Display port for the real stream: receives the HUD layer and places it
   * over the displayed video frame (e.g. like integration/video-hud.tsx).
   * Without it the HUD is shown on a neutral stage.
   */
  videoLayer?: (hud: ReactNode) => ReactNode;
  onDiagnostics?: (diagnostics: RuntimeDiagnostic[]) => void;
  onFrame?: (frame: FrameResult) => void;
  className?: string;
}

export function OverlayPreview({ session, config, assets, locale, m, videoLayer, onDiagnostics, onFrame, className }: OverlayPreviewProps) {
  const state = usePreviewState(session);
  const hud = (
    <OverlayRenderer
      // A new display session per preview entry and restart (runtime §2).
      key={state.epoch}
      config={config}
      assets={assets}
      source={session.source}
      clock={session.clock}
      mode="preview"
      locale={locale}
      idPrefix="ovl-preview-"
      onDiagnostics={onDiagnostics}
      onFrame={onFrame}
      className="absolute inset-0 w-full h-full"
    />
  );
  return (
    <div className={`relative overflow-hidden bg-zinc-950 ${className ?? ""}`} data-ovl-preview={state.epoch} tabIndex={-1}>
      {videoLayer ? videoLayer(hud) : hud}
      <div className="absolute left-1 top-1 rounded bg-amber-500/90 px-1.5 py-0.5 text-[11px] font-semibold text-black pointer-events-none" data-ovl-preview-badge="">
        {m.previewBadge}{state.paused ? ` · ${m.pause}` : state.speed !== 1 ? ` · ${state.speed}×` : ""}
      </div>
    </div>
  );
}
