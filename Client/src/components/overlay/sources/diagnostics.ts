// Read-only diagnostics of the live sources (telemetry diagnostics panel).
// Nothing here changes what a provider requests or how values are evaluated.
import { LIDAR_EMPTY, LIDAR_FIELDS } from "./lidar-grid";
import type { StreamCounters } from "./telemetry-buffer";
import type { QualifiedValue, SampleStateCode, TelemetryDataType } from "./types";

/** Short info of a LidarGrid value; same fields and rules as the server's telemetry-debug. */
export interface LidarGridSummary {
  length: number;
  complete?: boolean;
  encoding?: "dense" | "sparse";
  occupied: number;
  /** First broken rule of lidar/README.md §4/§5, undefined when the value decodes. */
  error?: "format" | "base64" | "length" | "index";
}

export interface ChannelDiagnostics {
  id: number;
  name?: string;
  dataType?: TelemetryDataType;
  /** Raw value as last received (untruncated). */
  raw?: string;
  sampleState?: SampleStateCode;
  /** Evaluated with the default deadline (HUD overrides are not applied). */
  value?: QualifiedValue;
  changes: number;
  confirmations: number;
  lastArrival?: number;
  /** Part of the union this client asks the server for. */
  wanted: boolean;
  /** Part of the interest last sent to the server. */
  sent: boolean;
  /** Consumers that require this channel. */
  consumers: string[];
  lidar?: LidarGridSummary;
}

export interface ProviderDiagnostics {
  carId: number;
  connected: boolean;
  vehicleOnline: boolean;
  metadata: "idle" | "loading" | "loaded" | "failed";
  stream: StreamCounters;
  wanted: number[];
  /** Undefined: nothing sent on this connection yet. */
  sent?: number[];
  controlInterest: boolean;
  consumers: { id: string; channels: string[]; control: boolean }[];
  channels: ChannelDiagnostics[];
  /** Client clock of the snapshot, for ages of lastArrival. */
  now: number;
}

const LIDAR_VALUE = /^1([01])([ds]):([A-Za-z0-9+/]*={0,2})$/;

export function summarizeLidarGrid(value: string): LidarGridSummary {
  const m = LIDAR_VALUE.exec(value);
  if (!m) return { length: value.length, occupied: 0, error: "format" };
  const complete = m[1] === "1";
  const encoding = m[2] === "d" ? "dense" : "sparse";
  const base = { length: value.length, complete, encoding } as const;
  let bytes: Uint8Array;
  try {
    if (m[3].length % 4 !== 0) throw new Error("padding");
    const bin = atob(m[3]);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch {
    return { ...base, occupied: 0, error: "base64" };
  }
  const u16 = (i: number) => bytes[i] | (bytes[i + 1] << 8);
  let occupied = 0;
  if (encoding === "dense") {
    if (bytes.length !== LIDAR_FIELDS * 2) return { ...base, occupied: 0, error: "length" };
    for (let i = 0; i < LIDAR_FIELDS; i++) if (u16(i * 2) !== LIDAR_EMPTY) occupied++;
  } else {
    if (bytes.length % 4 !== 0) return { ...base, occupied: 0, error: "length" };
    let prev = -1;
    for (let i = 0; i < bytes.length; i += 4) {
      const index = u16(i);
      if (index >= LIDAR_FIELDS || index <= prev) return { ...base, occupied: 0, error: "index" };
      if (u16(i + 2) !== LIDAR_EMPTY) occupied++;
      prev = index;
    }
  }
  return { ...base, occupied };
}
