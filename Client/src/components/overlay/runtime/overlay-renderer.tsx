"use client";
// AP08 – <OverlayRenderer config assets source clock mode locale scrub? onDiagnostics? />
// (Shared/Overlay/modules/README.md §1). React renders only the <svg> frame;
// frames patch the SVG directly. No HTTP, SignalR or control calls here.
import { useEffect, useRef, type CSSProperties } from "react";
import type { EffectiveConfig } from "../document/types";
import { animationFrameClock } from "./clock";
import { OverlayController, type RendererSource } from "./controller";
import type { Clock, FrameResult, Locale, RenderMode, RuntimeAsset, RuntimeDiagnostic, Scrub } from "./types";
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

  return (
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
}
