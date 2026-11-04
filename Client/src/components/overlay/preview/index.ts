// AP11 – local simulation and running preview (README.md).
export * from "./types";
export { defaultGenerator, impliedDataType, isDynamic, numberAt, telemetryText } from "./generators";
export { DEFAULT_LIDAR_OBSTACLES, encodeLidarGrid, synthLidarCells, zoneOf } from "./lidar-synth";
export { PREVIEW_SPEEDS, PreviewClock, STEP_S } from "./preview-clock";
export type { PreviewClockState } from "./preview-clock";
export { PreviewSourceProvider } from "./preview-source";
export { PreviewSession } from "./session";
export type { EditorMode, PreviewSessionOptions, PreviewState } from "./session";
export { previewMessages } from "./messages";
export type { PreviewMessages } from "./messages";
export { SimulationPanel, usePreviewState } from "./simulation-panel";
export type { SimulationPanelProps } from "./simulation-panel";
export { OverlayPreview } from "./overlay-preview";
export type { OverlayPreviewProps } from "./overlay-preview";
export { OverlayEditorWithPreview, useHudDependencies } from "./editor-with-preview";
export type { OverlayEditorWithPreviewProps } from "./editor-with-preview";
