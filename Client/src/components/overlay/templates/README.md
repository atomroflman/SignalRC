# Overlay-Startvorlagen (AP12)

Editierbare Vorlagen nach `Overlay-Feature.md` („Startvorlagen“). Eine Vorlage
wird als gewöhnliche Elemente und Clips über Editor-Befehle eingefügt
(`addElements`, `addClip` in einer Transaktion = ein Undo-Schritt), in der
aktiven Sicht (Standard oder Variante). Danach ist sie mit den regulären
Werkzeugen bearbeitbar; es gibt keine Verknüpfung zur Vorlage.

| Vorlage | Eingänge | Dynamik |
| --- | --- | --- |
| `compass` | Kurs (Grad) | Rose dreht mit `-Kurs` (Glättung), Gradanzeige |
| `attitude` | Pitch, Roll (Grad) | Roll dreht den Horizont, Pitch verschiebt die Leiter (Pixel je Grad) |
| `trackRun` | Geschwindigkeit links/rechts (m/s) | Glieder per `rate` mit `wrap` auf den Gliederabstand |
| `distanceWarning` | Abstand (m) | Farbbalken, Hinweis unter der Warnschwelle, Blink-Clip (`whileTrue`) unter der kritischen Schwelle |
| `lidarGrid` | LiDAR-Rasterkanal | LiDAR-Widget, Sektoren, optional Sweep |
| `lidarContour` | LiDAR-Rasterkanal | LiDAR-Widget im Kontur-Modus (D74), optional Schatten und Sweep |

- **Kanalzuordnung:** Jeder Eingang braucht einen vorhandenen Kanal passenden
  Typs (`Integer`/`Number` bzw. `LidarGrid`) aus dem Kanalkatalog (AP05).
  Ohne Zuordnung wird nichts eingefügt; es gibt keine Platzhalter- oder
  erfundenen Werte. Die Vorschau zeigt nur Grundwerte (Gestaltungsmodus).
- **Umrechnung:** ausdrücklich je Eingang, als `tel("k") · Faktor + Offset` in
  der Formel. Voreinstellungen (z. B. rad → Grad, km/h → m/s, cm → m) werden
  nach der Kanaleinheit vorgeschlagen; eigene Faktoren sind möglich (z. B. `-1`
  für eine umgekehrte Richtung).
- **IDs:** neue `e_`/`c_`-IDs; Wurzel ist eine Gruppe mit festem Pivot,
  mittig in der Arbeitsfläche platziert.

| Datei | Inhalt |
| --- | --- |
| `types.ts` | Vorlagen-, Eingangs-, Parameter- und Zuordnungstypen |
| `library.ts` | die fünf Vorlagen |
| `conversions.ts` | Umrechnungsvoreinstellungen, Formelbausteine |
| `instantiate.ts` | `checkMapping`, `instantiate`, `insertTemplate` |
| `template-inserter.tsx` | Auswahl, Zuordnung, Einstellungen, Vorschau (`OverlayRenderer`), Einfügen |

Tests: `npx vitest run src/components/overlay/templates` – gültige Dokumente
(AP01, ohne Diagnosen), Darstellung ohne Laufzeitdiagnosen (AP08, Gestaltung
und live), nur zugeordnete Quellen, Einfügen/Undo/Variante.
