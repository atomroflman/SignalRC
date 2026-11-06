// "Konfiguration exportieren" on the setup page: the vehicle's whole configuration as one
// JSON file – the channel map as the server keeps it (pin managers, control, telemetry and
// video channels, GET /api/cars/{id}/channels) plus the audio settings.

export const CONFIG_EXPORT_FORMAT = "signalrc-vehicle-config";
export const CONFIG_EXPORT_VERSION = 1;

export type VehicleConfigExport = {
  format: typeof CONFIG_EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  carId: number;
  channelMap: unknown;
  audioSettings: unknown | null;
};

export function buildConfigExport(carId: number, channelMap: unknown, audioSettings: unknown | null, now = new Date()): VehicleConfigExport {
  return {
    format: CONFIG_EXPORT_FORMAT,
    version: CONFIG_EXPORT_VERSION,
    exportedAt: now.toISOString(),
    carId,
    channelMap,
    audioSettings,
  };
}

/** File name like signalrc-car-2-config-2026-11-06.json. */
export function configExportFileName(carId: number, now = new Date()): string {
  return `signalrc-car-${carId}-config-${now.toISOString().slice(0, 10)}.json`;
}

/** Loads the configuration and offers it as a download. Throws when the channel map cannot be loaded. */
export async function downloadVehicleConfig(carId: number, f: typeof fetch = fetch): Promise<void> {
  const channels = await f(`/api/cars/${carId}/channels`);
  if (!channels.ok) throw new Error(`HTTP ${channels.status}`);
  const channelMap = await channels.json();
  const audio = await f(`/api/cars/${carId}/channels/audio-settings`).catch(() => null);
  const audioSettings = audio?.ok ? await audio.json() : null;
  const now = new Date();
  const json = JSON.stringify(buildConfigExport(carId, channelMap, audioSettings, now), null, 2);
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = configExportFileName(carId, now);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
