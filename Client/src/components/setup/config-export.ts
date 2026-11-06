// Export and import of the whole vehicle configuration on the setup page
// (Server/Controllers/VehicleConfigController.cs): pin managers, control, telemetry and video
// channels in the shapes the channel editor saves, plus the audio settings.

export const CONFIG_EXPORT_FORMAT = "signalrc-vehicle-config";

export type ImportSection = { kind: string; added: string[]; changed: string[]; unchanged: string[]; missing: string[] };
export type ImportPlan = {
  applied: boolean;
  removeMissing: boolean;
  sourceCarId: number;
  sourceCarName?: string | null;
  exportedAt: string;
  sections: ImportSection[];
  audioChanged: boolean;
  flowNodesRemoved: number;
};

/** File name like signalrc-car-2-config-2026-11-06.json. */
export function configExportFileName(carId: number, now = new Date()): string {
  return `signalrc-car-${carId}-config-${now.toISOString().slice(0, 10)}.json`;
}

/** Reads a file's text as configuration; throws a readable error for anything else. */
export function parseConfigFile(text: string): unknown {
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("not JSON");
  }
  if (json?.format !== CONFIG_EXPORT_FORMAT) throw new Error("not a SignalRC vehicle configuration");
  return json;
}

/** Whether the plan writes anything (with removeMissing: also removes). */
export function planHasChanges(plan: ImportPlan): boolean {
  return plan.audioChanged || plan.sections.some(s => s.added.length > 0 || s.changed.length > 0 || (plan.removeMissing && s.missing.length > 0));
}

/** Loads the configuration from the server and offers it as a download. */
export async function downloadVehicleConfig(carId: number, f: typeof fetch = fetch): Promise<void> {
  const r = await f(`/api/cars/${carId}/config`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const json = JSON.stringify(await r.json(), null, 2);
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = configExportFileName(carId);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Plan (dryRun) or apply an import; throws with the server's reason when it refuses. */
export async function importVehicleConfig(carId: number, file: unknown, opts: { dryRun: boolean; removeMissing: boolean }, f: typeof fetch = fetch): Promise<ImportPlan> {
  const r = await f(`/api/cars/${carId}/config/import?dryRun=${opts.dryRun}&removeMissing=${opts.removeMissing}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(file),
  });
  if (!r.ok) throw new Error((await r.text().catch(() => "")) || `HTTP ${r.status}`);
  return r.json();
}
