// Texts of the template inserter (AP12); AP13 merges them into the shared translations.
import type { Locale } from "../runtime/types";
import type { MappingIssue } from "./instantiate";

export type TemplateMessages = {
  title: string;
  choose: string;
  channel: string;
  none: string;
  conversion: string;
  custom: string;
  factor: string;
  offset: string;
  params: string;
  preview: string;
  insert: string;
  cancel: string;
  noChannels: string;
  unitMismatch: (channelUnit: string, slotUnit: string) => string;
  issue: (i: MappingIssue) => string;
  hint: string;
};

const de: TemplateMessages = {
  title: "Vorlagen",
  choose: "Vorlage wählen",
  channel: "Kanal",
  none: "— Kanal wählen —",
  conversion: "Umrechnung",
  custom: "eigene (Faktor/Offset)",
  factor: "Faktor",
  offset: "Offset",
  params: "Einstellungen",
  preview: "Vorschau (Grundwerte, keine Messwerte)",
  insert: "Einfügen",
  cancel: "Abbrechen",
  noChannels: "Kein passender Kanal auf diesem Fahrzeug – die Vorlage braucht vorhandene Messwerte.",
  unitMismatch: (c, s) => `Der Kanal liefert ${c}, die Vorlage erwartet ${s}. Keine Umrechnung passt – Faktor selbst prüfen oder einen Kanal in ${s} wählen.`,
  issue: (i) => {
    switch (i.code) {
      case "TPL_SLOT_UNASSIGNED": return "Bitte allen Eingängen einen Kanal zuordnen.";
      case "TPL_CHANNEL_UNKNOWN": return `Kanal „${i.channel}“ gibt es nicht.`;
      case "TPL_CHANNEL_TYPE": return `Kanal „${i.channel}“ hat den unpassenden Typ ${i.dataType}.`;
      case "TPL_CONVERSION_INVALID": return "Die Umrechnung braucht einen endlichen Faktor ungleich 0.";
      case "TPL_PARAM_INVALID": return "Eine Einstellung liegt außerhalb des erlaubten Bereichs.";
    }
  },
  hint: "Die Vorlage wird als normale Elemente eingefügt (ein Undo-Schritt) und bleibt frei bearbeitbar.",
};

const en: TemplateMessages = {
  title: "Templates",
  choose: "Choose template",
  channel: "Channel",
  none: "— choose channel —",
  conversion: "Conversion",
  custom: "custom (factor/offset)",
  factor: "Factor",
  offset: "Offset",
  params: "Settings",
  preview: "Preview (base values, no measurements)",
  insert: "Insert",
  cancel: "Cancel",
  noChannels: "No fitting channel on this vehicle – the template needs existing measurements.",
  unitMismatch: (c, s) => `The channel delivers ${c}, the template expects ${s}. No conversion fits – check the factor yourself or choose a channel in ${s}.`,
  issue: (i) => {
    switch (i.code) {
      case "TPL_SLOT_UNASSIGNED": return "Please map a channel to every input.";
      case "TPL_CHANNEL_UNKNOWN": return `Channel “${i.channel}” does not exist.`;
      case "TPL_CHANNEL_TYPE": return `Channel “${i.channel}” has the unsuitable type ${i.dataType}.`;
      case "TPL_CONVERSION_INVALID": return "The conversion needs a finite factor other than 0.";
      case "TPL_PARAM_INVALID": return "A setting is out of range.";
    }
  },
  hint: "The template is inserted as ordinary elements (one undo step) and stays fully editable.",
};

export const templateMessages: Record<Locale, TemplateMessages> = { de, en };
