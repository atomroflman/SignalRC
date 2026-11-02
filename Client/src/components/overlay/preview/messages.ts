// Texts of the preview and simulation panel (AP11); AP13 merges them into the shared translations.
import type { GeneratorKind, SimQuality } from "./types";

export type PreviewMessages = {
  design: string;
  preview: string;
  previewBadge: string;
  simulation: string;
  play: string;
  pause: string;
  step: string;
  stepSecond: string;
  restart: string;
  speed: string;
  time: string;
  simulateAll: string;
  simulateAllHint: string;
  clear: string;
  driverActive: string;
  live: string;
  yes: string;
  no: string;
  channels: string;
  noChannels: string;
  simulated: string;
  generators: Record<GeneratorKind, string>;
  qualities: Record<SimQuality, string>;
  value: string;
  min: string;
  max: string;
  from: string;
  to: string;
  periodS: string;
  shape: string;
  saw: string;
  triangle: string;
  offset: string;
  amplitude: string;
  quality: string;
  ageMs: string;
  paused: string;
  complete: string;
  rotate: string;
  obstacle: string;
  addObstacle: string;
  remove: string;
  angle: string;
  width: string;
  distance: string;
  swing: string;
  localOnly: string;
};

const de: PreviewMessages = {
  design: "Gestaltung",
  preview: "Vorschau",
  previewBadge: "Vorschau – lokale Testwerte",
  simulation: "Simulation",
  play: "Abspielen",
  pause: "Pause",
  step: "Schritt",
  stepSecond: "+1 s",
  restart: "Neu starten",
  speed: "Geschwindigkeit",
  time: "Zeit",
  simulateAll: "Alle Werte simulieren",
  simulateAllHint: "Testmodus: alle benötigten Kanäle erhalten Testwerte, nichts wird live angefordert",
  clear: "Alles live",
  driverActive: "Fahrer aktiv",
  live: "live",
  yes: "ja",
  no: "nein",
  channels: "Benötigte Werte",
  noChannels: "Das HUD verwendet keine Telemetrie- oder Steuerungswerte.",
  simulated: "simuliert",
  generators: { fixed: "Fester Wert", slider: "Regler", ramp: "Rampe", sine: "Sinus", lidar: "LiDAR synthetisch" },
  qualities: { valid: "gültig", unchecked: "ungeprüft", missing: "fehlend", error: "ungültig (Quellfehler)", stale: "veraltet" },
  value: "Wert",
  min: "Min",
  max: "Max",
  from: "Von",
  to: "Bis",
  periodS: "Periode (s)",
  shape: "Form",
  saw: "Sägezahn",
  triangle: "Dreieck",
  offset: "Mitte",
  amplitude: "Amplitude",
  quality: "Qualität",
  ageMs: "Alter (ms)",
  paused: "pausiert",
  complete: "vollständiger Scan",
  rotate: "Drehung (°/s)",
  obstacle: "Hindernis",
  addObstacle: "Hindernis hinzufügen",
  remove: "Entfernen",
  angle: "Winkel (°)",
  width: "Breite (°)",
  distance: "Abstand (mm)",
  swing: "Schwankung (mm)",
  localOnly: "Testwerte gelten nur in dieser Vorschau. Sie werden nicht gesendet, nicht gespeichert und lösen keine Fahrzeugbefehle aus.",
};

const en: PreviewMessages = {
  design: "Design",
  preview: "Preview",
  previewBadge: "Preview – local test values",
  simulation: "Simulation",
  play: "Play",
  pause: "Pause",
  step: "Step",
  stepSecond: "+1 s",
  restart: "Restart",
  speed: "Speed",
  time: "Time",
  simulateAll: "Simulate all values",
  simulateAllHint: "Test mode: every required channel gets test values, nothing is requested live",
  clear: "All live",
  driverActive: "Driver active",
  live: "live",
  yes: "yes",
  no: "no",
  channels: "Required values",
  noChannels: "The HUD uses no telemetry or control values.",
  simulated: "simulated",
  generators: { fixed: "Fixed value", slider: "Slider", ramp: "Ramp", sine: "Sine", lidar: "Synthetic LiDAR" },
  qualities: { valid: "valid", unchecked: "unchecked", missing: "missing", error: "invalid (source error)", stale: "stale" },
  value: "Value",
  min: "Min",
  max: "Max",
  from: "From",
  to: "To",
  periodS: "Period (s)",
  shape: "Shape",
  saw: "Sawtooth",
  triangle: "Triangle",
  offset: "Center",
  amplitude: "Amplitude",
  quality: "Quality",
  ageMs: "Age (ms)",
  paused: "paused",
  complete: "complete scan",
  rotate: "Rotation (°/s)",
  obstacle: "Obstacle",
  addObstacle: "Add obstacle",
  remove: "Remove",
  angle: "Angle (°)",
  width: "Width (°)",
  distance: "Distance (mm)",
  swing: "Swing (mm)",
  localOnly: "Test values apply to this preview only. They are not sent, not saved and trigger no vehicle commands.",
};

export const previewMessages: Record<"de" | "en", PreviewMessages> = { de, en };
