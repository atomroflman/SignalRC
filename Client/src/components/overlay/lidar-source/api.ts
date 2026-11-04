// REST calls of the LiDAR source helper: the setup action of the overlay API
// (Shared/Overlay/api/README.md §3) and the regular channel management.
import { LIDAR_GRID_CHANNEL, buildChannelUpdate, type LidarGridOptions, type TelemetryChannelItem } from "./options";

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type Failure = { ok: false; status: number; code?: string };
export type SetupResult = { ok: true; created: boolean } | Failure;
export type LoadResult = { ok: true; channel: TelemetryChannelItem | null } | Failure;
export type SaveResult = { ok: true } | Failure;

async function failure(r: Response): Promise<Failure> {
  let code: string | undefined;
  try {
    const body = await r.json();
    if (body && typeof body.code === "string") code = body.code;
  } catch { /* not a problem document */ }
  return { ok: false, status: r.status, code };
}

/** The grid channel of the vehicle, or null when it does not exist. */
export async function loadGridChannel(carId: number, f: Fetch = fetch): Promise<LoadResult> {
  const r = await f(`/api/cars/${carId}/channels`);
  if (!r.ok) return failure(r);
  const map = await r.json();
  const channel = map?.telemetryChannels?.[LIDAR_GRID_CHANNEL] ?? null;
  return { ok: true, channel };
}

/** "LiDAR-HUD-Quelle einrichten": creates the channel unless it exists (lidar/README.md §7). */
export async function setupGridSource(carId: number, f: Fetch = fetch): Promise<SetupResult> {
  const r = await f(`/api/cars/${carId}/overlay/lidar-grid-source`, { method: "POST" });
  if (!r.ok) return failure(r);
  const body = await r.json();
  return { ok: true, created: body?.created === true };
}

export async function saveGridOptions(carId: number, channel: TelemetryChannelItem, options: LidarGridOptions, f: Fetch = fetch): Promise<SaveResult> {
  const r = await f(`/api/cars/${carId}/channels/telemetry/${LIDAR_GRID_CHANNEL}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildChannelUpdate(channel, options)),
  });
  return r.ok ? { ok: true } : failure(r);
}
