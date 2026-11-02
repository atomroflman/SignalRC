// Texts of the import preview as a separate part file; AP13 merges them
// into the shared translations.

export type AssetLocale = "de" | "en";

const de = {
  title: "SVG-Import prüfen",
  uploading: "SVG wird bereinigt …",
  previewAlt: "Bereinigte Vorschau",
  previewNote: "Angezeigt wird ausschließlich die serverseitig bereinigte Grafik.",
  size: (w: string, h: string) => `Größe: ${w} × ${h}`,
  parts: (n: number) => `${n} auswählbare Teile`,
  noChanges: "Keine Inhalte entfernt oder verändert.",
  changes: "Bereinigungsbericht",
  rejected: "Import abgelehnt",
  failed: "Upload fehlgeschlagen",
  confirm: "Bereinigte Grafik übernehmen",
  cancel: "Abbrechen",
  count: (n: number) => `${n}×`,
  codes: {
    SVG_REMOVED_ELEMENT: "Nicht unterstützte Elemente entfernt",
    SVG_REMOVED_ATTRIBUTE: "Nicht unterstützte oder ungültige Attribute entfernt",
    SVG_EXTERNAL_REFERENCE: "Externe Verweise entfernt",
    SVG_UNSUPPORTED_CSS: "Nicht unterstütztes CSS entfernt",
    SVG_FONT_MAPPED: "Schriften auf Systemschriften abgebildet",
    SVG_UNIT_CONVERTED: "Einheiten umgerechnet",
    SVG_METADATA_REMOVED: "Editor-Metadaten entfernt",
    SVG_REJECTED_DOCTYPE: "DOCTYPE/DTD ist nicht erlaubt",
    SVG_REJECTED_LIMIT: "Grafik überschreitet die Grenzen (Größe, Elemente, Tiefe, Koordinaten, Verläufe oder Text); bitte vereinfachen",
    SVG_REJECTED_PARSE: "Datei ist kein gültiges SVG",
    SVG_REJECTED_EMPTY: "Nach der Bereinigung bleibt nichts Sichtbares übrig",
    SVG_REJECTED_USE_CYCLE: "Zyklische <use>-Verweise",
  } as Record<string, string>,
  unknownCode: (code: string) => `Hinweis ${code}`,
  errors: {
    OVL_API_TOO_LARGE: "Datei ist größer als 256 kB",
    OVL_API_NOT_AVAILABLE: "SVG-Import ist auf dem Server nicht verfügbar",
    OVL_API_SESSION_REQUIRED: "Keine Benutzersitzung",
    OVL_API_NOT_DRIVER: "Nur wer die Steuerung des Fahrzeugs hält, darf importieren",
  } as Record<string, string>,
};

const en: typeof de = {
  title: "Review SVG import",
  uploading: "Sanitizing SVG …",
  previewAlt: "Sanitized preview",
  previewNote: "Only the server-sanitized graphic is shown.",
  size: (w, h) => `Size: ${w} × ${h}`,
  parts: n => `${n} selectable parts`,
  noChanges: "Nothing was removed or changed.",
  changes: "Sanitizing report",
  rejected: "Import rejected",
  failed: "Upload failed",
  confirm: "Use sanitized graphic",
  cancel: "Cancel",
  count: n => `${n}×`,
  codes: {
    SVG_REMOVED_ELEMENT: "Unsupported elements removed",
    SVG_REMOVED_ATTRIBUTE: "Unsupported or invalid attributes removed",
    SVG_EXTERNAL_REFERENCE: "External references removed",
    SVG_UNSUPPORTED_CSS: "Unsupported CSS removed",
    SVG_FONT_MAPPED: "Fonts mapped to system fonts",
    SVG_UNIT_CONVERTED: "Units converted",
    SVG_METADATA_REMOVED: "Editor metadata removed",
    SVG_REJECTED_DOCTYPE: "DOCTYPE/DTD is not allowed",
    SVG_REJECTED_LIMIT: "Graphic exceeds the limits (size, elements, depth, coordinates, gradients or text); please simplify",
    SVG_REJECTED_PARSE: "File is not a valid SVG",
    SVG_REJECTED_EMPTY: "Nothing visible remains after sanitizing",
    SVG_REJECTED_USE_CYCLE: "Cyclic <use> references",
  },
  unknownCode: code => `Note ${code}`,
  errors: {
    OVL_API_TOO_LARGE: "File is larger than 256 kB",
    OVL_API_NOT_AVAILABLE: "SVG import is not available on the server",
    OVL_API_SESSION_REQUIRED: "No user session",
    OVL_API_NOT_DRIVER: "Only whoever holds control of the vehicle may import",
  },
};

export const assetMessages: Record<AssetLocale, typeof de> = { de, en };
export type AssetMessages = typeof de;
