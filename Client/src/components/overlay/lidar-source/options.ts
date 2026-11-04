// Source options of the LiDAR grid channel (Shared/Overlay/lidar/README.md §1, §7).
// Mirrors Onboard/Telemetry/LidarGrid/LidarGridOptions.cs; the onboard checks
// again and reports Error on invalid options.

export const LIDAR_GRID_CHANNEL = "lidarGrid";
export const LIDAR_GRID_READER = "SignalRC.Onboard.Telemetry.LidarGridTelemetryReader";
export const LIDAR_GRID_DATA_TYPE = 4;
export const ZONE_COUNT = 5;
export const MAX_ZONE_LIMIT_MM = 65534;
export const POINTS_PER_REVOLUTION = 1440;

export type LidarGridOptions = {
  mountYawDeg: number;
  zoneLimitsMm: number[];
  neighborMaxMm: number;
  minGroupPoints: number;
  /** Index direction of the scanner; provisional default until D58 is measured. */
  scannerClockwise: boolean;
};

export const DEFAULT_OPTIONS: Readonly<LidarGridOptions> = Object.freeze({
  mountYawDeg: 0,
  zoneLimitsMm: [500, 1000, 2000, 3000, 5000],
  neighborMaxMm: 50,
  minGroupPoints: 3,
  scannerClockwise: true,
});

export type OptionError =
  | "mountYaw"
  | "zoneCount"
  | "zonePositive"
  | "zoneIncreasing"
  | "zoneMax"
  | "zoneInteger"
  | "neighbor"
  | "minPoints";

/** Telemetry channel as returned by GET /api/cars/{carId}/channels (telemetryChannels entry). */
export type TelemetryChannelItem = {
  pinManager?: string | null;
  address?: number | null;
  readIntervalTicks?: number;
  telemetryType?: string;
  dataType?: number;
  unit?: string | null;
  decimals?: number | null;
  options?: Record<string, unknown> | null;
};

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Options of a channel, defaults for anything absent or of the wrong type. */
export function readOptions(options: Record<string, unknown> | null | undefined): LidarGridOptions {
  const o = options ?? {};
  const zones = Array.isArray(o.zoneLimitsMm) && o.zoneLimitsMm.every(v => typeof v === "number")
    ? (o.zoneLimitsMm as number[]).slice()
    : DEFAULT_OPTIONS.zoneLimitsMm.slice();
  return {
    mountYawDeg: num(o.mountYawDeg, DEFAULT_OPTIONS.mountYawDeg),
    zoneLimitsMm: zones,
    neighborMaxMm: num(o.neighborMaxMm, DEFAULT_OPTIONS.neighborMaxMm),
    minGroupPoints: num(o.minGroupPoints, DEFAULT_OPTIONS.minGroupPoints),
    scannerClockwise: typeof o.scannerClockwise === "boolean" ? o.scannerClockwise : DEFAULT_OPTIONS.scannerClockwise,
  };
}

export function validateOptions(o: LidarGridOptions): OptionError[] {
  const errors = new Set<OptionError>();
  if (!Number.isFinite(o.mountYawDeg)) errors.add("mountYaw");
  const z = o.zoneLimitsMm;
  if (z.length !== ZONE_COUNT) {
    errors.add("zoneCount");
  } else {
    if (!z.every(Number.isInteger)) errors.add("zoneInteger");
    if (!(z[0] > 0)) errors.add("zonePositive");
    for (let i = 1; i < z.length; i++) if (!(z[i] > z[i - 1])) errors.add("zoneIncreasing");
    if (!(z[z.length - 1] <= MAX_ZONE_LIMIT_MM)) errors.add("zoneMax");
  }
  if (!Number.isInteger(o.neighborMaxMm) || o.neighborMaxMm <= 0) errors.add("neighbor");
  if (!Number.isInteger(o.minGroupPoints) || o.minGroupPoints < 1 || o.minGroupPoints > POINTS_PER_REVOLUTION) {
    errors.add("minPoints");
  }
  return [...errors];
}

/**
 * Body for PUT /api/cars/{carId}/channels/telemetry/lidarGrid: the channel as
 * it is, with only the grid options replaced. Unknown options (groupKey,
 * pinManager, anything added later) are kept. The direction is only written
 * when it differs from the default, so the provisional default stays in one
 * place (the reader) until D58 is decided.
 */
export function buildChannelUpdate(channel: TelemetryChannelItem, o: LidarGridOptions) {
  const options: Record<string, unknown> = { ...(channel.options ?? {}) };
  options.mountYawDeg = o.mountYawDeg;
  options.zoneLimitsMm = o.zoneLimitsMm.slice();
  options.neighborMaxMm = o.neighborMaxMm;
  options.minGroupPoints = o.minGroupPoints;
  if (o.scannerClockwise === DEFAULT_OPTIONS.scannerClockwise) delete options.scannerClockwise;
  else options.scannerClockwise = o.scannerClockwise;
  return {
    channelName: LIDAR_GRID_CHANNEL,
    readIntervalTicks: channel.readIntervalTicks ?? 2,
    telemetryType: channel.telemetryType ?? LIDAR_GRID_READER,
    dataType: channel.dataType ?? LIDAR_GRID_DATA_TYPE,
    unit: channel.unit ?? null,
    decimals: channel.decimals ?? null,
    pinManager: channel.pinManager ?? "lidar",
    address: channel.address ?? null,
    options,
  };
}

/** Parses a comma/space separated list of zone limits typed by the user. */
export function parseZoneLimits(text: string): number[] {
  return text.split(/[\s,;]+/).filter(Boolean).map(Number);
}
