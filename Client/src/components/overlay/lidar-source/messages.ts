// Texts of the LiDAR source helper; AP13 merges them into the shared translations.
import type { OptionError } from "./options";

export type LidarSourceMessages = {
  title: string;
  loading: string;
  loadFailed: string;
  missing: string;
  setup: string;
  confirmQuestion: string;
  confirm: string;
  cancel: string;
  created: string;
  alreadyPresent: string;
  present: string;
  mountYaw: string;
  mountYawHint: string;
  zoneLimits: string;
  zoneLimitsHint: string;
  neighborMax: string;
  minGroupPoints: string;
  scannerClockwise: string;
  scannerClockwiseHint: string;
  save: string;
  saved: string;
  saveFailed: string;
  errors: Record<OptionError, string>;
  denied: Record<"OVL_API_SESSION_REQUIRED" | "OVL_API_NOT_DRIVER" | "other", string>;
};

const de: LidarSourceMessages = {
  title: "LiDAR-HUD-Quelle",
  loading: "Laden...",
  loadFailed: "Kanäle konnten nicht geladen werden.",
  missing: "Für dieses Fahrzeug ist noch kein LiDAR-Rasterkanal eingerichtet. HUDs können LiDAR-Daten erst danach anzeigen.",
  setup: "LiDAR-HUD-Quelle einrichten",
  confirmQuestion: "Kanal „lidarGrid“ mit Standardwerten anlegen? Das Fahrzeug liest danach zusätzlich das LiDAR-Raster.",
  confirm: "Einrichten",
  cancel: "Abbrechen",
  created: "LiDAR-HUD-Quelle eingerichtet.",
  alreadyPresent: "Der Kanal war bereits vorhanden; nichts geändert.",
  present: "Kanal „lidarGrid“ ist eingerichtet.",
  mountYaw: "Montageversatz (°)",
  mountYawHint: "Drehung des Sensors gegen die Fahrzeugfront, im Uhrzeigersinn positiv",
  zoneLimits: "Zonengrenzen (mm)",
  zoneLimitsHint: "fünf streng steigende Obergrenzen, höchstens 65534",
  neighborMax: "Nachbarabstand (mm)",
  minGroupPoints: "Mindestpunkte je Gruppe",
  scannerClockwise: "Scanner zählt im Uhrzeigersinn",
  scannerClockwiseHint: "vorläufig, bis die Zählrichtung am Fahrzeug gemessen ist",
  save: "Speichern",
  saved: "Gespeichert.",
  saveFailed: "Speichern fehlgeschlagen.",
  errors: {
    mountYaw: "Montageversatz muss eine Zahl sein.",
    zoneCount: "Genau fünf Zonengrenzen angeben.",
    zonePositive: "Die erste Zonengrenze muss größer als 0 sein.",
    zoneIncreasing: "Zonengrenzen müssen streng steigen.",
    zoneMax: "Die letzte Zonengrenze darf höchstens 65534 mm sein.",
    zoneInteger: "Zonengrenzen sind ganze Millimeter.",
    neighbor: "Nachbarabstand muss eine ganze Zahl größer 0 sein.",
    minPoints: "Mindestpunkte zwischen 1 und 1440.",
  },
  denied: {
    OVL_API_SESSION_REQUIRED: "Keine Benutzersitzung.",
    OVL_API_NOT_DRIVER: "Nur wer die Steuerung des Fahrzeugs hält, darf die Quelle einrichten.",
    other: "Einrichten fehlgeschlagen.",
  },
};

const en: LidarSourceMessages = {
  title: "LiDAR HUD source",
  loading: "Loading...",
  loadFailed: "Could not load channels.",
  missing: "This vehicle has no LiDAR grid channel yet. HUDs can show LiDAR data only after it is set up.",
  setup: "Set up LiDAR HUD source",
  confirmQuestion: "Create channel \"lidarGrid\" with default values? The vehicle will then also read the LiDAR grid.",
  confirm: "Set up",
  cancel: "Cancel",
  created: "LiDAR HUD source set up.",
  alreadyPresent: "The channel already existed; nothing changed.",
  present: "Channel \"lidarGrid\" is set up.",
  mountYaw: "Mounting offset (°)",
  mountYawHint: "rotation of the sensor against the vehicle front, clockwise positive",
  zoneLimits: "Zone limits (mm)",
  zoneLimitsHint: "five strictly increasing upper bounds, at most 65534",
  neighborMax: "Neighbour distance (mm)",
  minGroupPoints: "Minimum points per group",
  scannerClockwise: "Scanner counts clockwise",
  scannerClockwiseHint: "provisional until the direction is measured on the vehicle",
  save: "Save",
  saved: "Saved.",
  saveFailed: "Saving failed.",
  errors: {
    mountYaw: "Mounting offset must be a number.",
    zoneCount: "Enter exactly five zone limits.",
    zonePositive: "The first zone limit must be greater than 0.",
    zoneIncreasing: "Zone limits must be strictly increasing.",
    zoneMax: "The last zone limit must be at most 65534 mm.",
    zoneInteger: "Zone limits are whole millimetres.",
    neighbor: "Neighbour distance must be a whole number above 0.",
    minPoints: "Minimum points between 1 and 1440.",
  },
  denied: {
    OVL_API_SESSION_REQUIRED: "No user session.",
    OVL_API_NOT_DRIVER: "Only whoever holds control of the vehicle may set up the source.",
    other: "Setup failed.",
  },
};

export const lidarSourceMessages: Record<"de" | "en", LidarSourceMessages> = { de, en };
