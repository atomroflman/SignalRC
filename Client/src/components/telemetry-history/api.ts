import type { DashboardLayout, HistorySettings, RecordingState, SamplesResponse, SessionDetail, SessionSummary } from "./types";

const base = (carId: number) => `/api/cars/${carId}/telemetry-history`;

export class HistoryApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function json<T>(r: Response): Promise<T> {
  if (!r.ok) throw new HistoryApiError(r.status, (await r.text().catch(() => "")) || `HTTP ${r.status}`);
  return (await r.json()) as T;
}

export const historyApi = {
  settings: (carId: number) => fetch(`${base(carId)}/settings`).then(r => json<HistorySettings>(r)),

  saveSettings: (carId: number, retentionDays: number, recorded: number[]) =>
    fetch(`${base(carId)}/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ retentionDays, recorded }),
    }).then(r => json<HistorySettings>(r)),

  recording: (carId: number) => fetch(`${base(carId)}/recording`).then(r => json<RecordingState>(r)),

  setRecordingStopped: (carId: number, stopped: boolean) =>
    fetch(`${base(carId)}/recording`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stopped }),
    }).then(r => json<RecordingState>(r)),

  sessions: (carId: number) => fetch(`${base(carId)}/sessions`).then(r => json<SessionSummary[]>(r)),

  session: (carId: number, sessionId: number) => fetch(`${base(carId)}/sessions/${sessionId}`).then(r => json<SessionDetail>(r)),

  deleteSession: async (carId: number, sessionId: number) => {
    const r = await fetch(`${base(carId)}/sessions/${sessionId}`, { method: "DELETE" });
    if (!r.ok) throw new HistoryApiError(r.status, `HTTP ${r.status}`);
  },

  samples: (carId: number, sessionId: number, q: { from?: number; to?: number; after?: number; points?: number }) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined) p.set(k, String(Math.round(v)));
    return fetch(`${base(carId)}/sessions/${sessionId}/samples?${p}`).then(r => json<SamplesResponse>(r));
  },

  dashboard: (carId: number) =>
    fetch(`${base(carId)}/dashboard`).then(r => json<{ layout: DashboardLayout | null }>(r)),

  saveDashboard: (carId: number, layout: DashboardLayout) =>
    fetch(`${base(carId)}/dashboard`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(layout),
    }).then(r => json<{ modifiedAt: number }>(r)),
};
