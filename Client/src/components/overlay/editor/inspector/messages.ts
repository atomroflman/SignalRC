// Texts of the property inspector and timeline (AP10); AP13 merges them into the shared translations.
import type { ControlMode } from "../../document/catalog";
import type { Trigger } from "../../document/types";

export type DynamicsMessages = {
  properties: string;
  noSelection: string;
  multiSelection: string;
  element: string;
  part: string;
  section: Record<"transform" | "appearance" | "widget", string>;
  modes: Record<ControlMode, string>;
  mode: string;
  inherited: string;
  overridden: string;
  isDefault: string;
  reset: string;
  resetToDefault: string;
  base: string;
  baseHint: string;
  channel: string;
  pickChannel: string;
  telemetry: string;
  outputs: string;
  signals: string;
  formula: string;
  editFormula: string;
  simpleBinding: string;
  noChannels: string;
  smoothing: string;
  timeConstant: string;
  angleShortest: string;
  rateHint: string;
  wrap: string;
  min: string;
  max: string;
  clipDriven: (clips: string) => string;
  openClip: string;
  conflict: string;
  live: string;
  liveState: Record<"valid" | "unchecked" | "invalid" | "none", string>;
  paused: string;
  noLive: string;
  offset: (n: number) => string;
  fromSource: (v: string) => string;
  fromAsset: string;
  center: string;
  onInvalid: string;
  onInvalidValues: Record<"hold" | "hide", string>;
  lidarSource: string;
  lidarSourceNone: string;
  lidarZones: (limits: string) => string;
  lidarSourceHint: string;
  invalidInput: Record<"type" | "range", string>;
  // Timeline
  timeline: string;
  clips: string;
  noClips: string;
  newClip: string;
  deleteClip: string;
  disableClip: string;
  clipName: string;
  duration: string;
  scaleKeyframes: string;
  repeat: string;
  infinite: string;
  endState: string;
  endStates: Record<"base" | "hold", string>;
  trigger: string;
  triggers: Record<Trigger["mode"], string>;
  condition: string;
  onDeactivate: string;
  onDeactivateValues: Record<"stop" | "finish", string>;
  retrigger: string;
  retriggerValues: Record<"restart" | "ignore", string>;
  tracks: string;
  noTracks: string;
  addTrack: string;
  addTrackFor: string;
  replaces: Record<"binding" | "rate" | "otherClip", string>;
  removeTrack: string;
  keyframe: string;
  time: string;
  value: string;
  easing: string;
  easings: Record<"linear" | "easeIn" | "easeOut" | "easeInOut" | "step", string>;
  addKeyframe: string;
  deleteKeyframe: string;
  scrub: string;
  baseValues: string;
  inheritedClip: string;
  overriddenFields: (f: string) => string;
};

const de: DynamicsMessages = {
  properties: "Eigenschaften",
  noSelection: "Element auswählen, um Eigenschaften zu bearbeiten",
  multiSelection: "Eigenschaften nur bei einem ausgewählten Element",
  element: "Element",
  part: "Teil",
  section: { transform: "Transformation", appearance: "Darstellung", widget: "Widget-Parameter" },
  modes: { static: "Statisch", binding: "Bindung", rate: "Rate", clip: "Clip" },
  mode: "Steuerung",
  inherited: "geerbt",
  overridden: "überschrieben",
  isDefault: "Standardwert",
  reset: "Überschreibung zurücksetzen",
  resetToDefault: "Auf Standardwert zurücksetzen",
  base: "Grundwert",
  baseHint: "Angezeigt im Gestaltungsmodus und solange kein gültiger Wert vorliegt; Startwert bei Raten",
  channel: "Kanal",
  pickChannel: "Kanal wählen …",
  telemetry: "Telemetrie",
  outputs: "Steuerausgänge",
  signals: "Signale",
  formula: "Formel",
  editFormula: "Als Formel bearbeiten",
  simpleBinding: "Einfache Kanalbindung",
  noChannels: "Keine Kanalliste verfügbar – Formel direkt eingeben",
  smoothing: "Glättung",
  timeConstant: "Zeitkonstante (s)",
  angleShortest: "Winkel folgen dem kürzesten Weg",
  rateHint: "Änderung pro Sekunde; negative Werte kehren die Richtung um",
  wrap: "Umbruch",
  min: "min",
  max: "max",
  clipDriven: (c) => `Gesteuert durch Clip ${c}`,
  openClip: "In Zeitachse öffnen",
  conflict: "Mehrere Treiber – einen Modus wählen",
  live: "Live",
  liveState: { valid: "gültig", unchecked: "ungeprüft", invalid: "ungültig", none: "—" },
  paused: "pausiert",
  noLive: "kein Livewert",
  offset: (n) => `Position ${n}`,
  fromSource: (v) => `aus Quelle${v ? ` (${v})` : ""}`,
  fromAsset: "aus Asset",
  center: "Mitte",
  onInvalid: "Bei ungültigen Daten",
  onInvalidValues: { hold: "Letzten Stand halten", hide: "Ausblenden" },
  lidarSource: "LiDAR-Quelle",
  lidarSourceNone: "keine",
  lidarZones: (l) => `Zonengrenzen der Quelle: ${l}`,
  lidarSourceHint: "Zonen, Gruppenerkennung und Montageversatz gehören zur Quelle (Kanalverwaltung), nicht zum HUD.",
  invalidInput: { type: "Wert passt nicht zum Typ", range: "Wert außerhalb des erlaubten Bereichs" },
  timeline: "Zeitachse",
  clips: "Clips",
  noClips: "Keine Clips",
  newClip: "Neuer Clip",
  deleteClip: "Clip löschen",
  disableClip: "Deaktiviert",
  clipName: "Name",
  duration: "Dauer (s)",
  scaleKeyframes: "Keyframes mitskalieren",
  repeat: "Wiederholungen",
  infinite: "endlos",
  endState: "Ende",
  endStates: { base: "Grundwerte", hold: "Endwert halten" },
  trigger: "Auslöser",
  triggers: { auto: "Automatisch", whileTrue: "Solange Bedingung wahr", pulse: "Impuls bei falsch → wahr" },
  condition: "Bedingung",
  onDeactivate: "Beim Deaktivieren",
  onDeactivateValues: { stop: "Sofort beenden", finish: "Durchlauf beenden" },
  retrigger: "Erneuter Impuls",
  retriggerValues: { restart: "Neu starten", ignore: "Ignorieren" },
  tracks: "Spuren",
  noTracks: "Noch keine Spuren",
  addTrack: "Spur hinzufügen",
  addTrackFor: "Eigenschaft",
  replaces: { binding: "ersetzt Bindung", rate: "ersetzt Rate", otherClip: "übernimmt aus anderem Clip" },
  removeTrack: "Spur entfernen",
  keyframe: "Keyframe",
  time: "Zeit (s)",
  value: "Wert",
  easing: "Übergang",
  easings: { linear: "Linear", easeIn: "Beschleunigen", easeOut: "Abbremsen", easeInOut: "Beschleunigen/Abbremsen", step: "Sprung" },
  addKeyframe: "Keyframe an Abspielposition",
  deleteKeyframe: "Keyframe löschen",
  scrub: "Abspielposition",
  baseValues: "Grundwerte zeigen",
  inheritedClip: "aus Standard geerbt",
  overriddenFields: (f) => `überschrieben: ${f}`,
};

const en: DynamicsMessages = {
  properties: "Properties",
  noSelection: "Select an element to edit its properties",
  multiSelection: "Properties are edited for one selected element",
  element: "Element",
  part: "Part",
  section: { transform: "Transform", appearance: "Appearance", widget: "Widget parameters" },
  modes: { static: "Static", binding: "Binding", rate: "Rate", clip: "Clip" },
  mode: "Control",
  inherited: "inherited",
  overridden: "overridden",
  isDefault: "default",
  reset: "Reset override",
  resetToDefault: "Reset to default",
  base: "Base value",
  baseHint: "Shown in design mode and while no valid value exists; start value of rates",
  channel: "Channel",
  pickChannel: "Pick a channel …",
  telemetry: "Telemetry",
  outputs: "Control outputs",
  signals: "Signals",
  formula: "Formula",
  editFormula: "Edit as formula",
  simpleBinding: "Simple channel binding",
  noChannels: "No channel list available – enter a formula",
  smoothing: "Smoothing",
  timeConstant: "Time constant (s)",
  angleShortest: "Angles take the shortest way",
  rateHint: "Change per second; negative values reverse the direction",
  wrap: "Wrap",
  min: "min",
  max: "max",
  clipDriven: (c) => `Driven by clip ${c}`,
  openClip: "Open in timeline",
  conflict: "Several drivers – choose one mode",
  live: "Live",
  liveState: { valid: "valid", unchecked: "unchecked", invalid: "invalid", none: "—" },
  paused: "paused",
  noLive: "no live value",
  offset: (n) => `position ${n}`,
  fromSource: (v) => `from source${v ? ` (${v})` : ""}`,
  fromAsset: "from asset",
  center: "center",
  onInvalid: "On invalid data",
  onInvalidValues: { hold: "Hold last state", hide: "Hide" },
  lidarSource: "LiDAR source",
  lidarSourceNone: "none",
  lidarZones: (l) => `Zone limits of the source: ${l}`,
  lidarSourceHint: "Zones, group detection and mounting offset belong to the source (channel settings), not to the HUD.",
  invalidInput: { type: "Value does not fit the type", range: "Value out of the allowed range" },
  timeline: "Timeline",
  clips: "Clips",
  noClips: "No clips",
  newClip: "New clip",
  deleteClip: "Delete clip",
  disableClip: "Disabled",
  clipName: "Name",
  duration: "Duration (s)",
  scaleKeyframes: "Scale keyframes",
  repeat: "Repeat",
  infinite: "infinite",
  endState: "End",
  endStates: { base: "Base values", hold: "Hold end value" },
  trigger: "Trigger",
  triggers: { auto: "Automatic", whileTrue: "While condition is true", pulse: "Pulse on false → true" },
  condition: "Condition",
  onDeactivate: "On deactivation",
  onDeactivateValues: { stop: "Stop immediately", finish: "Finish iteration" },
  retrigger: "Renewed pulse",
  retriggerValues: { restart: "Restart", ignore: "Ignore" },
  tracks: "Tracks",
  noTracks: "No tracks yet",
  addTrack: "Add track",
  addTrackFor: "Property",
  replaces: { binding: "replaces binding", rate: "replaces rate", otherClip: "takes over from another clip" },
  removeTrack: "Remove track",
  keyframe: "Keyframe",
  time: "Time (s)",
  value: "Value",
  easing: "Easing",
  easings: { linear: "Linear", easeIn: "Ease in", easeOut: "Ease out", easeInOut: "Ease in/out", step: "Step" },
  addKeyframe: "Keyframe at playhead",
  deleteKeyframe: "Delete keyframe",
  scrub: "Playhead",
  baseValues: "Show base values",
  inheritedClip: "inherited from standard",
  overriddenFields: (f) => `overridden: ${f}`,
};

export const dynamicsMessages: Record<"de" | "en", DynamicsMessages> = { de, en };
