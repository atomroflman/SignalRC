// Texts of the editor foundation (AP09); AP13 merges them into the shared translations.
import type { SaveStatus } from "../persistence/autosave";
import type { ElementType } from "../../document/types";

export type EditorMessages = {
  status: Record<SaveStatus, string>;
  saveNow: string;
  undo: string;
  redo: string;
  add: string;
  types: Record<ElementType, string>;
  group: string;
  ungroup: string;
  duplicate: string;
  delete: string;
  align: Record<"left" | "centerX" | "right" | "top" | "centerY" | "bottom", string>;
  distributeX: string;
  distributeY: string;
  arrange: Record<"forward" | "backward" | "front" | "back", string>;
  zoomIn: string;
  zoomOut: string;
  zoomFit: string;
  grid: string;
  gridSize: string;
  snap: string;
  layers: string;
  lock: string;
  unlock: string;
  hide: string;
  show: string;
  disable: string;
  enable: string;
  inherited: string;
  overridden: string;
  addedInVariant: string;
  movedInVariant: string;
  reset: string;
  resetElement: string;
  transform: string;
  noSelection: string;
  multiSelection: (n: number) => string;
  dynamicHint: string;
  standard: string;
  variants: string;
  orphaned: string;
  createVariant: string;
  removeVariant: string;
  removeVariantConfirm: (id: string) => string;
  reassign: string;
  variantDisabled: string;
  overlayDisabled: string;
  workspace: string;
  areaOnly: string;
  fitContent: string;
  deleteTitle: string;
  deleteElements: (n: number) => string;
  deleteClips: (n: number) => string;
  deleteVariant: (id: string, parts: string) => string;
  confirmDelete: string;
  cancel: string;
  conflictTitle: string;
  conflictText: string;
  download: string;
  loadServer: string;
  localOnlyText: string;
  backupsTitle: string;
  backupContinue: string;
  backupOnlyDownload: string;
  dismiss: string;
  backupFailed: string;
  loadFailed: string;
  retry: string;
  diagnostics: (n: number) => string;
};

const types = (de: boolean): Record<ElementType, string> => ({
  group: de ? "Gruppe" : "Group",
  rect: de ? "Rechteck" : "Rectangle",
  ellipse: "Ellipse",
  line: de ? "Linie" : "Line",
  arc: de ? "Bogen" : "Arc",
  text: "Text",
  valueText: de ? "Wert" : "Value",
  linearGauge: de ? "Balkenanzeige" : "Linear gauge",
  radialGauge: de ? "Rundanzeige" : "Radial gauge",
  svgAsset: "SVG",
  lidarWidget: "LiDAR",
  videoStream: de ? "Video (Bild-in-Bild)" : "Video (picture-in-picture)",
});

const de: EditorMessages = {
  status: { loading: "lädt", unsaved: "ungespeichert", saving: "speichert", saved: "gespeichert", error: "Fehler", conflict: "Konflikt", localOnly: "nur lokal" },
  saveNow: "Jetzt speichern",
  undo: "Rückgängig",
  redo: "Wiederholen",
  add: "Einfügen",
  types: types(true),
  group: "Gruppieren",
  ungroup: "Gruppe auflösen",
  duplicate: "Duplizieren",
  delete: "Löschen",
  align: { left: "Links", centerX: "Horizontal mittig", right: "Rechts", top: "Oben", centerY: "Vertikal mittig", bottom: "Unten" },
  distributeX: "Horizontal verteilen",
  distributeY: "Vertikal verteilen",
  arrange: { forward: "Eine Ebene nach vorn", backward: "Eine Ebene nach hinten", front: "Ganz nach vorn", back: "Ganz nach hinten" },
  zoomIn: "Vergrößern",
  zoomOut: "Verkleinern",
  zoomFit: "Einpassen",
  grid: "Raster",
  gridSize: "Rasterweite",
  snap: "Einrasten",
  layers: "Ebenen",
  lock: "Sperren",
  unlock: "Entsperren",
  hide: "Im Editor ausblenden",
  show: "Im Editor einblenden",
  disable: "Deaktivieren",
  enable: "Aktivieren",
  inherited: "geerbt",
  overridden: "überschrieben",
  addedInVariant: "nur in dieser Variante",
  movedInVariant: "in dieser Variante umgruppiert",
  reset: "Zurücksetzen",
  resetElement: "Alle Überschreibungen zurücksetzen",
  transform: "Transformation",
  noSelection: "Nichts ausgewählt",
  multiSelection: (n) => `${n} Elemente ausgewählt`,
  dynamicHint: "dynamisch – Grundwert",
  standard: "Standard",
  variants: "Varianten",
  orphaned: "verwaist",
  createVariant: "Variante anlegen",
  removeVariant: "Variante löschen",
  removeVariantConfirm: (id) => `Variante „${id}“ mit allen Abweichungen löschen?`,
  reassign: "Zuordnen zu",
  variantDisabled: "Kein HUD für diesen Stream",
  overlayDisabled: "Overlay fahrzeugweit deaktiviert",
  workspace: "Arbeitsfläche",
  areaOnly: "Nur Fläche ändern",
  fitContent: "Inhalt einpassen",
  deleteTitle: "Löschen bestätigen",
  deleteElements: (n) => `${n} Element(e) einschließlich Unterelementen`,
  deleteClips: (n) => `Spuren in ${n} Clip(s) entfallen`,
  deleteVariant: (id, parts) => `Variante „${id}“: ${parts}`,
  confirmDelete: "Löschen",
  cancel: "Abbrechen",
  conflictTitle: "Speicherkonflikt",
  conflictText: "Der Entwurf wurde inzwischen an anderer Stelle gespeichert. Der Serverstand hat Vorrang; automatisches Speichern ist angehalten. Sichere deinen lokalen Stand bei Bedarf als Datei.",
  download: "Lokalen Stand herunterladen",
  loadServer: "Serverstand laden",
  localOnlyText: "Keine Fahrzeugkontrolle: Änderungen bleiben lokal und werden nicht gespeichert.",
  backupsTitle: "Lokale Sicherungen gefunden",
  backupContinue: "Weiterarbeiten",
  backupOnlyDownload: "Serverstand ist neuer – nur als Download",
  dismiss: "Schließen",
  backupFailed: "Lokale Sicherung nicht möglich",
  loadFailed: "Entwurf konnte nicht geladen werden",
  retry: "Erneut versuchen",
  diagnostics: (n) => `${n} Hinweis(e)`,
};

const en: EditorMessages = {
  status: { loading: "loading", unsaved: "unsaved", saving: "saving", saved: "saved", error: "error", conflict: "conflict", localOnly: "local only" },
  saveNow: "Save now",
  undo: "Undo",
  redo: "Redo",
  add: "Insert",
  types: types(false),
  group: "Group",
  ungroup: "Ungroup",
  duplicate: "Duplicate",
  delete: "Delete",
  align: { left: "Left", centerX: "Center horizontally", right: "Right", top: "Top", centerY: "Center vertically", bottom: "Bottom" },
  distributeX: "Distribute horizontally",
  distributeY: "Distribute vertically",
  arrange: { forward: "Bring forward", backward: "Send backward", front: "Bring to front", back: "Send to back" },
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  zoomFit: "Fit",
  grid: "Grid",
  gridSize: "Grid size",
  snap: "Snap",
  layers: "Layers",
  lock: "Lock",
  unlock: "Unlock",
  hide: "Hide in editor",
  show: "Show in editor",
  disable: "Disable",
  enable: "Enable",
  inherited: "inherited",
  overridden: "overridden",
  addedInVariant: "only in this variant",
  movedInVariant: "regrouped in this variant",
  reset: "Reset",
  resetElement: "Reset all overrides",
  transform: "Transform",
  noSelection: "Nothing selected",
  multiSelection: (n) => `${n} elements selected`,
  dynamicHint: "dynamic – base value",
  standard: "Standard",
  variants: "Variants",
  orphaned: "orphaned",
  createVariant: "Create variant",
  removeVariant: "Delete variant",
  removeVariantConfirm: (id) => `Delete variant "${id}" with all its deviations?`,
  reassign: "Assign to",
  variantDisabled: "No HUD for this stream",
  overlayDisabled: "Overlay disabled for the vehicle",
  workspace: "Workspace",
  areaOnly: "Change area only",
  fitContent: "Fit content",
  deleteTitle: "Confirm deletion",
  deleteElements: (n) => `${n} element(s) including children`,
  deleteClips: (n) => `tracks in ${n} clip(s) are removed`,
  deleteVariant: (id, parts) => `Variant "${id}": ${parts}`,
  confirmDelete: "Delete",
  cancel: "Cancel",
  conflictTitle: "Save conflict",
  conflictText: "The draft was saved elsewhere in the meantime. The server state wins; autosave is paused. Download your local state if you need it.",
  download: "Download local state",
  loadServer: "Load server state",
  localOnlyText: "No vehicle control: changes stay local and are not saved.",
  backupsTitle: "Local backups found",
  backupContinue: "Continue",
  backupOnlyDownload: "Server state is newer – download only",
  dismiss: "Close",
  backupFailed: "Local backup not possible",
  loadFailed: "Draft could not be loaded",
  retry: "Retry",
  diagnostics: (n) => `${n} notice(s)`,
};

export const editorMessages: Record<"de" | "en", EditorMessages> = { de, en };
