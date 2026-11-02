// Texts of the package exchange (AP12); AP13 merges them into the shared translations.
import type { Locale } from "../runtime/types";
import type { PackageErrorCode } from "./package";
import type { AssetIssue, UnresolvedReference } from "./import";

export type ExchangeMessages = {
  export: string;
  exporting: string;
  import: string;
  importTitle: string;
  reading: string;
  uploading: string;
  errors: Record<PackageErrorCode | "PKG_DOCUMENT_INVALID" | "PKG_ASSETS_MISSING" | "PKG_READ" | "STREAM_TARGET_TWICE", string>;
  kindBackup: (revision?: number) => string;
  kindExport: (at: string) => string;
  draftOnly: string;
  telemetry: string;
  outputs: string;
  streams: string;
  keep: string;
  uses: (n: number) => string;
  assetIssue: (i: AssetIssue) => string;
  unresolvedTitle: string;
  unresolved: (u: UnresolvedReference) => string;
  blockingTitle: (n: number) => string;
  publishable: string;
  structureInvalid: string;
  preview: string;
  confirm: string;
  cancel: string;
  noVehicle: string;
  noControl: string;
};

const de: ExchangeMessages = {
  export: "Paket exportieren",
  exporting: "Export läuft …",
  import: "Paket importieren",
  importTitle: "HUD-Paket importieren",
  reading: "Paket wird gelesen …",
  uploading: "Assets werden auf dem Server erneut bereinigt …",
  errors: {
    PKG_TOO_LARGE: "Die Datei ist größer als 13 MB.",
    PKG_PARSE: "Die Datei ist kein gültiges JSON.",
    PKG_FORMAT: "Die Datei ist kein SignalRC-Overlay-Paket.",
    PKG_VERSION: "Diese Paketversion wird nicht unterstützt.",
    PKG_DOCUMENT_TOO_LARGE: "Das Dokument im Paket ist größer als 2 MB.",
    PKG_ASSETS_TOO_LARGE: "Die Assets im Paket sind zusammen größer als 10 MB.",
    PKG_DOCUMENT_INVALID: "Das Dokument im Paket ist strukturell ungültig und kann nicht übernommen werden.",
    PKG_ASSETS_MISSING: "Nicht alle verwendeten Assets konnten geladen werden; der Export wurde abgebrochen.",
    PKG_READ: "Die Datei konnte nicht gelesen werden.",
    STREAM_TARGET_TWICE: "Zwei Varianten sind demselben Stream zugeordnet.",
  },
  kindBackup: (r) => `Lokale Sicherung${r !== undefined ? ` (Basisrevision ${r})` : ""}`,
  kindExport: (at) => `Export vom ${at}`,
  draftOnly: "Der Import ersetzt nur den Entwurf (rückgängig machbar) und veröffentlicht nichts.",
  telemetry: "Telemetriekanäle",
  outputs: "Steuerausgänge",
  streams: "Streams (Varianten)",
  keep: "— nicht zugeordnet —",
  uses: (n) => (n === 1 ? "1 Verwendung" : `${n} Verwendungen`),
  assetIssue: (i) =>
    i.code === "ASSET_MISSING" ? `Asset ${short(i.ref)} fehlt im Paket.`
      : i.code === "ASSET_REJECTED" ? `Asset ${short(i.ref)} wurde bei der Bereinigung abgelehnt (${i.reason}).`
      : `Asset ${short(i.ref)} konnte nicht hochgeladen werden${i.reason ? ` (${i.reason})` : ""}.`,
  unresolvedTitle: "Ungelöste Referenzen",
  unresolved: (u) =>
    u.kind === "telemetry" ? `Telemetriekanal „${u.name}“ gibt es auf diesem Fahrzeug nicht`
      : u.kind === "output" ? `Steuerausgang „${u.name}“ gibt es auf diesem Fahrzeug nicht`
      : u.kind === "stream" ? `Stream „${u.name}“ gibt es nicht – die Variante bleibt verwaist erhalten`
      : `Asset ${short(u.name)} ist nicht vorhanden`,
  blockingTitle: (n) => `${n} aktive Probleme blockieren die Veröffentlichung, bis sie im Editor behoben sind:`,
  publishable: "Keine blockierenden Probleme; der Entwurf kann nach dem Import veröffentlicht werden.",
  structureInvalid: "Das Ergebnis wäre kein speicherbarer Entwurf.",
  preview: "Vorschau (Standard)",
  confirm: "Entwurf ersetzen",
  cancel: "Abbrechen",
  noVehicle: "Kanäle des Fahrzeugs werden geladen …",
  noControl: "Import nur mit Fahrzeugkontrolle (Assets werden auf dem Server bereinigt).",
};

const en: ExchangeMessages = {
  export: "Export package",
  exporting: "Exporting …",
  import: "Import package",
  importTitle: "Import HUD package",
  reading: "Reading package …",
  uploading: "Sanitizing assets on the server again …",
  errors: {
    PKG_TOO_LARGE: "The file is larger than 13 MB.",
    PKG_PARSE: "The file is not valid JSON.",
    PKG_FORMAT: "The file is not a SignalRC overlay package.",
    PKG_VERSION: "This package version is not supported.",
    PKG_DOCUMENT_TOO_LARGE: "The package document is larger than 2 MB.",
    PKG_ASSETS_TOO_LARGE: "The package assets are larger than 10 MB in total.",
    PKG_DOCUMENT_INVALID: "The package document is structurally invalid and cannot be used.",
    PKG_ASSETS_MISSING: "Not all used assets could be loaded; the export was cancelled.",
    PKG_READ: "The file could not be read.",
    STREAM_TARGET_TWICE: "Two variants are mapped to the same stream.",
  },
  kindBackup: (r) => `Local backup${r !== undefined ? ` (base revision ${r})` : ""}`,
  kindExport: (at) => `Export of ${at}`,
  draftOnly: "Importing only replaces the draft (undoable) and publishes nothing.",
  telemetry: "Telemetry channels",
  outputs: "Control outputs",
  streams: "Streams (variants)",
  keep: "— not mapped —",
  uses: (n) => (n === 1 ? "1 use" : `${n} uses`),
  assetIssue: (i) =>
    i.code === "ASSET_MISSING" ? `Asset ${short(i.ref)} is missing from the package.`
      : i.code === "ASSET_REJECTED" ? `Asset ${short(i.ref)} was rejected by the sanitizer (${i.reason}).`
      : `Asset ${short(i.ref)} could not be uploaded${i.reason ? ` (${i.reason})` : ""}.`,
  unresolvedTitle: "Unresolved references",
  unresolved: (u) =>
    u.kind === "telemetry" ? `Telemetry channel “${u.name}” does not exist on this vehicle`
      : u.kind === "output" ? `Control output “${u.name}” does not exist on this vehicle`
      : u.kind === "stream" ? `Stream “${u.name}” does not exist – the variant is kept as orphaned`
      : `Asset ${short(u.name)} is not available`,
  blockingTitle: (n) => `${n} active problems block publishing until they are fixed in the editor:`,
  publishable: "No blocking problems; the draft can be published after the import.",
  structureInvalid: "The result would not be a savable draft.",
  preview: "Preview (standard)",
  confirm: "Replace draft",
  cancel: "Cancel",
  noVehicle: "Loading the vehicle's channels …",
  noControl: "Import requires vehicle control (assets are sanitized on the server).",
};

function short(assetId: string) {
  return assetId.length > 19 ? `${assetId.slice(0, 15)}…` : assetId;
}

export const exchangeMessages: Record<Locale, ExchangeMessages> = { de, en };
