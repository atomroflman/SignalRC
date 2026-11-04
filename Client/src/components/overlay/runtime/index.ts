// AP08 – SVG/animation runtime and LiDAR widget (Shared/Overlay/runtime/README.md).
export * from "./types";
export { createRuntime, worstMarker } from "./runtime";
export type { Runtime, RuntimeOptions, RuntimeSource } from "./runtime";
export { initialClipState, stepClip, clipOutput } from "./clip";
export type { ClipState, ConditionResult, ClipOutput } from "./clip";
export { sampleKeyframes, mixColor, parseColor, formatColor, wrapAngleDelta, wrapRange } from "./values";
export { SceneBuilder, formatValueText, MARKER_SIZE_PX } from "./scene";
export type { Scene, SceneOptions } from "./scene";
export { parseAsset, scopeIds, AssetParseError } from "./svg-asset";
export type { ParsedAsset } from "./svg-asset";
export { h, toMarkup, create, patch, SVG_NS } from "./vnode";
export type { VNode, DomNode, DomDocument } from "./vnode";
export { OverlayController } from "./controller";
export type { ControllerOptions, RendererSource } from "./controller";
export { animationFrameClock, createAnimationFrameClock } from "./clock";
export { OverlayRenderer } from "./overlay-renderer";
export type { OverlayRendererProps } from "./overlay-renderer";
export {
  LIDAR_SECTOR_COUNTS, LidarWidgetState, sectorCells, sectorDistancesCm, distanceColor, blinkHz, pulseOpacity,
} from "./widgets/lidar/lidar-widget";
export type { LidarWidgetOptions } from "./widgets/lidar/lidar-widget";
