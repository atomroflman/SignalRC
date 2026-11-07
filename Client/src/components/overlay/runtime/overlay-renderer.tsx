"use client";
// AP08 – <OverlayRenderer config assets source clock mode locale scrub? onDiagnostics? />
// (Shared/Overlay/modules/README.md §1). React renders only the <svg> frame;
// frames patch the SVG directly. No HTTP, SignalR or control calls here.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { EffectiveConfig } from "../document/types";
import { animationFrameClock } from "./clock";
import { OverlayController, type RendererSource } from "./controller";
import type { Clock, FrameResult, Locale, RenderMode, RuntimeAsset, RuntimeDiagnostic, Scrub, VideoSlot } from "./types";
import type { DomDocument, DomNode } from "./vnode";

export interface OverlayRendererProps {
  config: EffectiveConfig;
  assets?: Record<string, RuntimeAsset>;
  /** Telemetry provider (its requirement is managed here) or a plain value source. */
  source?: RendererSource;
  clock?: Clock;
  mode: RenderMode;
  locale: Locale;
  /** Design mode only: one clip at local time τ. */
  scrub?: Scrub;
  /** False ends the display session (HUD hidden by the viewer or the app). */
  active?: boolean;
  onDiagnostics?: (diagnostics: RuntimeDiagnostic[]) => void;
  onFrame?: (frame: FrameResult) => void;
  /**
   * Content of a picture-in-picture element (videoStream), e.g. a playing
   * stream. It fills the element's box; the renderer places it under the SVG
   * with the element's transform. Without it only the SVG frame is drawn.
   */
  renderVideo?: (slot: VideoSlot) => ReactNode;
  idPrefix?: string;
  className?: string;
  style?: CSSProperties;
}

export function OverlayRenderer(props: OverlayRendererProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const hostRef = useRef<SVGGElement>(null);
  const controllerRef = useRef<OverlayController | null>(null);
  const shownRef = useRef({ page: true, element: true });
  const { width, height } = props.config.workspace;
  const [videos, setVideos] = useState<VideoSlot[]>([]);

  const options = {
    config: props.config,
    assets: props.assets,
    source: props.source,
    clock: props.clock ?? animationFrameClock(),
    mode: props.mode,
    locale: props.locale,
    scrub: props.mode === "design" ? props.scrub : undefined,
    idPrefix: props.idPrefix,
    onDiagnostics: props.onDiagnostics,
    onFrame: props.onFrame,
    onVideos: setVideos,
    active: props.active,
  };
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    const host = hostRef.current;
    const svg = svgRef.current;
    if (!host || !svg) return;
    const controller = new OverlayController(host as unknown as DomNode, document as unknown as DomDocument, latest.current);
    controllerRef.current = controller;
    const apply = () => controller.setShown(shownRef.current.page && shownRef.current.element && latest.current.active !== false);

    const onVisibility = () => {
      shownRef.current.page = document.visibilityState !== "hidden";
      apply();
    };
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);

    let intersection: IntersectionObserver | undefined;
    if (typeof IntersectionObserver === "function") {
      intersection = new IntersectionObserver((entries) => {
        shownRef.current.element = entries.some((e) => e.isIntersecting);
        apply();
      });
      intersection.observe(svg);
    }

    let resize: ResizeObserver | undefined;
    const measure = () => {
      const rect = svg.getBoundingClientRect();
      const ws = latest.current.config.workspace;
      if (rect.width > 0 && rect.height > 0) controller.update({ pxPerUnit: Math.min(rect.width / ws.width, rect.height / ws.height) });
    };
    if (typeof ResizeObserver === "function") {
      resize = new ResizeObserver(measure);
      resize.observe(svg);
    }
    measure();

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      intersection?.disconnect();
      resize?.disconnect();
      controller.dispose();
      controllerRef.current = null;
      while (host.firstChild) host.removeChild(host.firstChild);
    };
  }, []);

  useEffect(() => {
    const c = controllerRef.current;
    if (!c) return;
    c.update(latest.current);
    c.setShown(shownRef.current.page && shownRef.current.element && props.active !== false);
  }, [options.config, options.assets, options.source, options.clock, options.mode, options.locale, options.scrub, options.idPrefix, options.onDiagnostics, options.onFrame, props.active]);

  const svg = (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      className={props.className}
      style={{ pointerEvents: "none", ...props.style }}
      aria-hidden="true"
      data-ovl-mode={props.mode}
    >
      <g ref={hostRef} />
    </svg>
  );
  if (!props.renderVideo) return svg;
  return (
    <>
      {props.active !== false && videos.length > 0 && (
        <VideoLayer workspace={props.config.workspace} videos={videos} render={props.renderVideo} className={props.className} />
      )}
      {svg}
    </>
  );
}

/**
 * HTML layer under the SVG, laid out like its viewBox (xMidYMid meet): a
 * workspace-sized box scaled into the layer, each video with its element's
 * matrix. Rotation, scaling and groups therefore match the SVG drawing.
 */
function VideoLayer({ workspace, videos, render, className }: {
  workspace: { width: number; height: number };
  videos: VideoSlot[];
  render: (slot: VideoSlot) => ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ scale: 0, x: 0, y: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      const scale = Math.min(r.width / workspace.width, r.height / workspace.height);
      const next = { scale, x: (r.width - workspace.width * scale) / 2, y: (r.height - workspace.height * scale) / 2 };
      setFit((prev) => (prev.scale === next.scale && prev.x === next.x && prev.y === next.y ? prev : next));
    };
    measure();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [workspace.width, workspace.height]);
  return (
    <div ref={ref} className={className} style={{ pointerEvents: "none", overflow: "hidden" }} data-ovl-video-layer="">
      {fit.scale > 0 && (
        <div style={{ position: "absolute", left: 0, top: 0, width: workspace.width, height: workspace.height, transformOrigin: "0 0", transform: `translate(${fit.x}px, ${fit.y}px) scale(${fit.scale})` }}>
          {videos.map((v) => (
            <div
              key={v.element}
              data-ovl-video={v.element}
              style={{
                position: "absolute", left: 0, top: 0, width: v.width, height: v.height, overflow: "hidden",
                transformOrigin: "0 0", transform: `matrix(${v.matrix.join(",")})`,
                borderRadius: v.cornerRadius, background: v.background, opacity: v.opacity,
              }}
            >
              {render(v)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
