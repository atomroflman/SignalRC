// AP05 – client telemetry and control display sources (Shared/Overlay/telemetry/README.md).
export * from "./types";
export { BASE_TICK_MS, CONTROL_STALE_AFTER_MS, MIN_STALE_AFTER_MS, defaultStaleAfterMs, staleAfterMs, evaluateSample, parsesAs } from "./quality";
export type { Sample } from "./quality";
export { DEFAULT_ZONE_LIMITS_MM, LIDAR_CELLS, LIDAR_EMPTY, LIDAR_FIELDS, LIDAR_ZONES, decodeLidarGrid, lidarField } from "./lidar-grid";
export { TelemetryBuffer } from "./telemetry-buffer";
export type { TlmChange, TlmMessage } from "./telemetry-buffer";
export { ControlDisplayBuffer, ControlDisplayPublisher, round6 } from "./control-display";
export type { ControlDisplayPort, CtlMessage, LocalControlSource } from "./control-display";
export { CarSourceProvider, INTEREST_INTERVAL_MS, parseChannelMetadata } from "./provider";
export { SourceHub, setSharedSourceHub, sharedSourceHub } from "./hub";
export type { HubLike, HubState, SourceHubOptions } from "./hub";
