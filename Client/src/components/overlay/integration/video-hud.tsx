"use client";
// AP13 – HUD layer over the displayed video frame. Measures the real frame of
// the `object-contain` video (received size, element box, resize, fullscreen)
// and places the AP08 renderer exactly there; the letterbox bars stay free.
// Intercepts pointer input only on clickable HUD elements (D75,
// hud-interaction.ts); everything else stays click-through. Video and audio
// are not touched.
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import type { EffectiveConfig } from "../document";
import { OverlayRenderer } from "../runtime/overlay-renderer";
import type { FrameResult, Locale, RuntimeAsset } from "../runtime/types";
import { sharedSourceHub, type CarSourceProvider } from "../sources";
import { showsPausedControl } from "./hud-config";
import { useHudInteraction } from "./hud-interaction";
import { layerRect, NO_GEOMETRY, observeVideoFrame, sameGeometry, type Rect, type Size, type VideoGeometry } from "./video-frame";

/**
 * The player geometry (container, received size, displayed frame), tracked on
 * every size change. A passive effect on purpose: the container is a parent
 * host element whose ref is attached only after the children's layout effects,
 * so a layer mounted together with the player never saw it and stayed 0 × 0
 * (reload, tab switch, editor preview).
 */
export function useVideoGeometry(containerRef: RefObject<HTMLElement | null>, videoRef: RefObject<HTMLVideoElement | null>): VideoGeometry {
  const [geometry, setGeometry] = useState<VideoGeometry>(NO_GEOMETRY);
  useEffect(() => {
    const container = containerRef.current;
    const video = videoRef.current;
    if (!container || !video) return;
    return observeVideoFrame(container, video, (g) => setGeometry((prev) => (sameGeometry(prev, g) ? prev : g)));
  }, [containerRef, videoRef]);
  return geometry;
}

/** The displayed video frame relative to the container (null while nothing is displayed). */
export function useVideoFrame(containerRef: RefObject<HTMLElement | null>, videoRef: RefObject<HTMLVideoElement | null>): Rect | null {
  return useVideoGeometry(containerRef, videoRef).frame;
}

function layerStyle(rect: Rect | null): CSSProperties {
  return rect
    ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    : { left: 0, top: 0, width: 0, height: 0, visibility: "hidden" };
}

export interface VideoFrameLayerProps {
  containerRef: RefObject<HTMLElement | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Without a displayed frame the layer covers this size fitted into the container (editor preview); otherwise it is hidden. */
  fallback?: Size;
  children: ReactNode | ((geometry: VideoGeometry) => ReactNode);
}

/** Content placed exactly on the displayed video frame (editor preview, AP11 `videoLayer`); no pointer input. */
export function VideoFrameLayer({ containerRef, videoRef, fallback, children }: VideoFrameLayerProps) {
  const geometry = useVideoGeometry(containerRef, videoRef);
  return (
    <div className="pointer-events-none absolute" style={layerStyle(layerRect(geometry, fallback))} data-ovl-frame-layer={geometry.frame ? "frame" : fallback ? "fallback" : "none"}>
      {typeof children === "function" ? children(geometry) : children}
    </div>
  );
}

export interface VideoHudProps {
  carId: number;
  config: EffectiveConfig;
  assets: Record<string, RuntimeAsset>;
  locale: Locale;
  /** Personal visibility; hidden ends the display session. */
  visible: boolean;
  containerRef: RefObject<HTMLElement | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
  pausedText: string;
}

export default function VideoHud({ carId, config, assets, locale, visible, containerRef, videoRef, pausedText }: VideoHudProps) {
  // Without a displayed picture (no stream, connecting, stream lost) the HUD
  // covers the workspace fitted into the player, so telemetry stays visible.
  const frame = layerRect(useVideoGeometry(containerRef, videoRef), config.workspace);
  const [provider, setProvider] = useState<CarSourceProvider | undefined>(undefined);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const interaction = useHudInteraction(carId);

  // The live values of the vehicle: one shared provider per page (AP05).
  useEffect(() => {
    const car = sharedSourceHub().acquire(carId);
    setProvider(car.provider);
    return () => {
      setProvider(undefined);
      car.release();
    };
  }, [carId]);

  const onFrame = useCallback((result: FrameResult) => {
    const next = showsPausedControl(result);
    if (next === pausedRef.current) return;
    pausedRef.current = next;
    setPaused(next);
  }, []);

  useEffect(() => {
    if (visible) return;
    pausedRef.current = false;
    setPaused(false);
  }, [visible]);

  const onDiagnostics = useCallback((diagnostics: { code: string; severity: string; message: string }[]) => {
    const errors = diagnostics.filter((d) => d.severity === "error");
    if (errors.length > 0) console.warn("Overlay runtime diagnostics", errors);
  }, []);

  if (!provider) return null;
  const active = visible && frame !== null;
  return (
    <div
      className="pointer-events-none absolute"
      style={layerStyle(frame)}
      data-ovl-hud=""
      data-ovl-hud-interact={interaction.mode}
      onPointerDown={interaction.onPointerDown}
      hidden={!visible}
    >
      <OverlayRenderer
        config={config}
        assets={assets}
        source={provider}
        mode="live"
        locale={locale}
        active={active}
        onFrame={onFrame}
        onDiagnostics={onDiagnostics}
        className="absolute inset-0 h-full w-full"
      />
      {active && paused && (
        <div className="absolute left-1/2 top-2 -translate-x-1/2 rounded bg-zinc-900/85 px-2 py-1 text-xs text-amber-200 shadow" role="status">
          ⏸ {pausedText}
        </div>
      )}
    </div>
  );
}
