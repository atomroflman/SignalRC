// Telemetry history (Server/Telemetry/History/TelemetryHistoryController.cs).
import type { TelemetryDataType } from "@/components/overlay/expression/analyze";

export interface HistoryChannel {
  id: number;
  name: string;
  dataType: TelemetryDataType;
  unit?: string | null;
  decimals?: number | null;
}

export interface HistorySettingsChannel extends HistoryChannel {
  record: boolean;
  recordable: boolean;
}

export interface HistorySettings {
  retentionDays: number;
  recordingStopped: boolean;
  channels: HistorySettingsChannel[];
}

/** Master switch of a vehicle (main page). */
export interface RecordingState {
  stopped: boolean;
  /** Channels selected for recording. */
  channels: number;
  /** A session is open right now. */
  recording: boolean;
  /** The caller is the driver who controls the vehicle. */
  canChange: boolean;
}

/** Times are Unix milliseconds. */
export interface SessionSummary {
  id: number;
  startedAt: number;
  endedAt: number | null;
  lastSampleAt: number | null;
  active: boolean;
}

export interface SessionDetail extends SessionSummary {
  channels: HistoryChannel[];
}

/** Samples of one channel; null is a gap. */
export interface ChannelData {
  t: number[];
  v: (number | null)[];
}

/** Changes of a text channel (status); null is a gap. Each state holds until the next change. */
export interface TextData {
  t: number[];
  v: (string | null)[];
}

export interface SamplesResponse {
  from: number;
  to: number;
  /** 0: raw samples; otherwise the bucket width of the min/max reduction. */
  resolutionMs: number;
  channels: Record<string, ChannelData>;
  /** Text channels; without `after` the state at the start of the range comes first. */
  texts: Record<string, TextData>;
}

/** One line of a chart: a formula of the overlay expression language over tel("…"). */
export interface SeriesDef {
  id: string;
  label: string;
  expr: string;
  color: string;
  unit?: string;
  decimals?: number;
}

export interface PanelDef {
  id: string;
  title: string;
  height?: number;
  series: SeriesDef[];
}

export interface DashboardLayout {
  version: 1;
  panels: PanelDef[];
}
