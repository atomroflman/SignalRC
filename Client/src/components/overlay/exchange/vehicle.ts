// AP12 – sources of a vehicle for the mapping: the AP05 channel catalog
// (GET api/cars/{carId}/overlay/sources, D69/D70) plus the stream list of the host.
import { parseChannelMetadata } from "../sources/provider";
import type { VehicleSources } from "./package";

export async function fetchVehicleSources(
  carId: number,
  streams: VehicleSources["streams"],
  fetchImpl: typeof fetch = fetch,
): Promise<VehicleSources> {
  const res = await fetchImpl(`/api/cars/${carId}/overlay/sources`, { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const raw = (await res.json()) as { telemetry?: unknown; outputs?: unknown } | null;
  const telemetry = (Array.isArray(raw?.telemetry) ? raw.telemetry : [])
    .map(parseChannelMetadata)
    .filter((m): m is NonNullable<typeof m> => !!m)
    .map((m) => ({ name: m.name, dataType: m.dataType, unit: m.unit ?? null }));
  const outputs = (Array.isArray(raw?.outputs) ? raw.outputs : [])
    .filter((o): o is { channelName: string } => !!o && typeof o.channelName === "string")
    .map((o) => o.channelName);
  return { telemetry, outputs, streams };
}
