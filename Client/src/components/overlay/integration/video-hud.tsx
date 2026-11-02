"use client";
// AP13 – HUD layer over the displayed video frame. Measures the real frame of
// the `object-contain` video (received size, element box, resize, fullscreen)
// and places the AP08 renderer exactly there; the letterbox bars stay free.
// Never intercepts pointer input; video and audio are not touched.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { EffectiveConfig } from "../document";
import { OverlayRenderer } from "../runtime/overlay-renderer";
import type { FrameResult, Locale, RuntimeAsset } from "../runtime/types";
import { sharedSourceHub, type CarSourceProvider } from "../sources";
import { showsPausedControl } from "./hud-config";
import { frameInContainer, sameFrame, type Rect } from "./video-frame";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** The displayed video frame relative to the container, tracked on every size change. */
export function useVideoFrame(containerRef: RefObject<HTMLElement | null>, videoRef: RefObject<HTMLVideoElement | null>): Rect | null {
  const [frame, setFrame] = useState<Rect | null>(null);
  useIsoLayoutEffect(() => {
    const container = containerRef.current;
    const video = videoRef.current;
    if (!container || !video) return;
    const measure = () => {
      const next = frameInContainer(container.getBoundingClientRect(), video.getBoundingClientRect(), {
        width: video.videoWidth,
        height: video.videoHeight,
      });
      setFrame((prev) => (sameFrame(prev, next) ? prev : next));
    };
    measure();
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver === "function") {
      observer = new ResizeObserver(measure);
      observer.observe(container);
      observer.observe(video);
    }
    // "resize" fires when the received frame size changes (new stream, camera switch).
    const events = ["loadedmetadata", "resize", "emptied"] as const;
    for (const e of events) video.addEventListener(e, measure);
    window.addEventListener("resize", measure);
    document.addEventListener("fullscreenchange", measure);
    return () => {
      observer?.disconnect();
      for (const e of events) video.removeEventListener(e, measure);
      window.removeEventListener("resize", measure);
      document.removeEventListener("fullscreenchange", measure);
    };
  }, [containerRef, videoRef]);
  return frame;
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
  const frame = useVideoFrame(containerRef, videoRef);
  const [provider, setProvider] = useState<CarSourceProvider | undefined>(undefined);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);

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
      style={frame
        ? { left: frame.left, top: frame.top, width: frame.width, height: frame.height }
        : { left: 0, top: 0, width: 0, height: 0, visibility: "hidden" }}
      data-ovl-hud=""
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
