// Texts of the AP13 integration (HUD layer, channel warnings, HUD-Signal node);
// merged into the shared translations (src/i18n/translations.ts → messages.overlay).
import type { PublicationProblem } from "./published-overlay";

const de = {
  hud: {
    show: "HUD einblenden",
    hide: "HUD ausblenden",
    fullscreen: "Vollbild",
    exitFullscreen: "Vollbild beenden",
    controlPaused: "Steuerung pausiert – angezeigte Steuerwerte werden nicht gesendet",
    problem: {
      load: "Aktuelle HUD-Version konnte nicht geladen werden.",
      unsupported: "Veröffentlichtes HUD hat eine nicht unterstützte Schemaversion.",
      invalid: "Veröffentlichtes HUD ist fehlerhaft.",
      assets: "Grafiken des HUD konnten nicht geladen werden.",
    } satisfies Record<PublicationProblem, string>,
    keepsRunning: "Der bisherige Stand läuft weiter.",
    runtimeError: "Das HUD konnte nicht vollständig dargestellt werden.",
  },
  channels: {
    lidarGridType: "LidarGrid",
    usedBy: (name: string) => `Kanal „${name}“ wird im HUD verwendet:`,
    inPublished: (n: number) => `${n}× im veröffentlichten HUD`,
    inDraft: (n: number) => `${n}× im gemeinsamen Entwurf`,
    consequence: "Betroffene Bindungen zeigen danach ihren Fehlerzustand. Vor der nächsten Veröffentlichung muss der Entwurf repariert werden.",
    notChecked: "HUD-Abhängigkeiten konnten nicht geprüft werden (nur mit aktiver Fahrzeugkontrolle möglich).",
    proceed: "Trotzdem fortfahren?",
  },
  flowNode: {
    hudSignalMissing: "Kein Signalname – nicht verfügbar",
    hudSignalDuplicate: "Signal mehrfach zugeordnet – nicht verfügbar",
  },
};

const en: typeof de = {
  hud: {
    show: "Show HUD",
    hide: "Hide HUD",
    fullscreen: "Fullscreen",
    exitFullscreen: "Exit fullscreen",
    controlPaused: "Control paused – displayed control values are not being sent",
    problem: {
      load: "The current HUD version could not be loaded.",
      unsupported: "The published HUD has an unsupported schema version.",
      invalid: "The published HUD is invalid.",
      assets: "The HUD graphics could not be loaded.",
    },
    keepsRunning: "The previous version keeps running.",
    runtimeError: "The HUD could not be rendered completely.",
  },
  channels: {
    lidarGridType: "LidarGrid",
    usedBy: (name: string) => `Channel "${name}" is used by the HUD:`,
    inPublished: (n: number) => `${n}× in the published HUD`,
    inDraft: (n: number) => `${n}× in the shared draft`,
    consequence: "Affected bindings will show their error state. The draft must be repaired before the next publication.",
    notChecked: "HUD dependencies could not be checked (requires active vehicle control).",
    proceed: "Continue anyway?",
  },
  flowNode: {
    hudSignalMissing: "No signal name – not available",
    hudSignalDuplicate: "Signal mapped more than once – not available",
  },
};

export type IntegrationMessages = typeof de;
export const integrationMessages: Record<"de" | "en", IntegrationMessages> = { de, en };
