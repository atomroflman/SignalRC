# Overlay-SVG-Assets v1 und Austauschformat

Status: **Entwurf**, Teil von AP00, noch nicht freigegeben. Grundlage: D18, D19,
D32, D34, D45, D52 und die Sicherheitsregeln des Produktplans.
Zuständig: AP07 (Bereinigung), AP02 (Speicherung/HTTP), AP08 (Darstellung),
AP12 (Austausch).

## 1. Verarbeitung (serverseitig, maßgeblich)

1. **Eingangsgrenze:** höchstens 256 kB Rohdaten (D32). UTF-8 oder UTF-16 mit BOM.
2. **XML-Parsing** mit verbotener DTD-Verarbeitung und ohne externe Auflösung:
   - Enthält die Datei ein `DOCTYPE`, wird sie abgelehnt.
   - Processing Instructions und Kommentare werden entfernt.
3. **CSS-Auflösung (D52):**
   - Was aufgelöst wird:
     - `<style>`-Regeln mit Typ-, Klassen- und ID-Selektoren sowie Selektorlisten,
     - `style="…"`-Attribute.
     - Nur erlaubte Eigenschaften (§2) werden in Präsentationsattribute
       umgerechnet.
   - Kaskade: Spezifität, bei Gleichstand die spätere Regel; `style` vor Regel
     vor Attribut. `!important` wird ignoriert und gemeldet.
   - Danach werden `class`, `style` und `<style>` entfernt.
4. **Auflösung von Referenzen:**
   - `<use>`/`<symbol>` werden inline expandiert und zählen zur Elementgrenze;
     Zyklen führen zur Ablehnung.
   - Gradient-Vererbung über `href` wird flach aufgelöst.
   - Danach gibt es kein `href` mehr.
5. **Bereinigung** nach Positivliste (§2):
   - Alles andere wird entfernt und im Bericht gezählt.
   - `display="none"`-Elemente werden entfernt.
   - `<a>` und `<switch>` werden zu `<g>` bzw. entfernt.
6. **Normalisierung:**
   - Wurzel `<svg xmlns viewBox="0 0 W H">` ohne `width`/`height`, `x`/`y` oder
     `preserveAspectRatio`. Deren Wirkung wird in eine Wurzel-`<g transform>`
     eingerechnet.
   - Einheiten: `mm`/`cm`/`in`/`pt`/`pc` werden nach px umgerechnet (96 dpi).
     `%`-Längen werden gegen die ViewBox aufgelöst. `em`/`ex` führen zur
     Entfernung des Attributs.
   - Farben werden zu `#rrggbb`/`#rrggbbaa`/`none`/`url(#id)` normalisiert; CSS-3-Farbnamen
     sind erlaubt. `currentColor` wird aufgelöst (Standard Schwarz).
   - Schriften werden auf generische Familien abgebildet (D45):
     - enthält `mono`, `courier` oder `consol` → `monospace`,
     - enthält `condensed` oder `narrow` → `condensed`,
     - Serifenfamilien (`serif`, `times`, `georgia`, `garamond`) → `serif`,
     - sonst `sans-serif`.
   - Zahlen müssen endlich sein, mit `|v| ≤ 1e6`.
7. **Grenzen prüfen** (§3). Bei Überschreitung wird abgelehnt, nicht gekürzt.
8. **Identität:** `assetId = "sha256-" + hex(sha256(UTF-8 der normalisierten
   Ausgabe))`. Assets sind unveränderlich.

## 2. Positivliste

**Elemente:** `svg` (nur Wurzel), `g`, `defs`, `path`, `rect`, `circle`,
`ellipse`, `line`, `polyline`, `polygon`, `text`, `tspan`, `linearGradient`,
`radialGradient`, `stop`, `clipPath`.

**Attribute** (je nach Element gemäß SVG 1.1):

- Identität und Geometrie: `id`, `transform`, `d`, `x`, `y`, `x1`, `y1`, `x2`,
  `y2`, `cx`, `cy`, `r`, `rx`, `ry`, `fx`, `fy`, `fr`, `width`, `height`, `points`
- Füllung und Kontur: `fill`, `fill-opacity`, `fill-rule`, `stroke`,
  `stroke-width`, `stroke-opacity`, `stroke-linecap`, `stroke-linejoin`,
  `stroke-miterlimit`, `stroke-dasharray`, `stroke-dashoffset`, `opacity`
- Beschneidung: `clip-path`, `clip-rule`, `clipPathUnits`
- Text: `font-family`, `font-size`, `font-weight`, `font-style`,
  `text-anchor`, `letter-spacing`, `dx`, `dy`
- Verläufe: `gradientUnits`, `gradientTransform`, `spreadMethod`, `offset`,
  `stop-color`, `stop-opacity`
- nur Wurzel: `viewBox`

`url(#…)` ist nur als Verweis auf einen Verlauf oder `clipPath` desselben Assets
erlaubt.

**Immer entfernt und gemeldet:**

- alle `on*`-Attribute,
- `script`, `foreignObject`, `image`, `mask`, `filter`, `pattern`, `marker`,
- Animationselemente (`animate*`, `set`), CSS-Animationen und -Transitions,
- externe oder `data:`-URLs, `xml:base`,
- `vector-effect` (D02: Striche skalieren mit),
- fremde Namensräume (Inkscape/Sodipodi/Illustrator-Metadaten; zusammengefasst
  gemeldet).

## 3. Grenzen je Asset (D32)

| Grenze | Wert |
| --- | --- |
| Rohdatei | 256 kB |
| Elemente nach Normalisierung (inkl. expandierter `use`) | 2000 |
| Verschachtelungstiefe | 32 |
| Pfad-/Punktkoordinaten gesamt | 50 000 |
| Verläufe + Beschneidungspfade | 64 |
| `stop` je Verlauf | 32 |
| Textzeichen gesamt | 5000 |
| normalisierte Ausgabe | 256 kB |

## 4. Unterelemente (Parts)

- Auswählbare Teile sind:
  - jedes Formelement (`g`, `path`, `rect`, `circle`, `ellipse`, `line`,
    `polyline`, `polygon`, `text`) mit `id` in der Quelle,
  - die direkten Kinder der Wurzel. Fehlt ihnen eine `id`, bekommen sie
    `part-<n>` in Dokumentreihenfolge.
- Part-IDs werden auf `[A-Za-z0-9_-]{1,64}` bereinigt. Kollisionen bekommen
  `-2`, `-3` … in Dokumentreihenfolge. Bei unveränderter Quelle bleiben die IDs
  über Re-Importe stabil.
- In der normalisierten Ausgabe tragen Teile `data-part="<id>"`. Interne
  Referenz-IDs (Verläufe, `clipPath`) werden zu `r<n>` umbenannt.
- Asset-Metadaten:

  ```
  { assetId, width, height,
    parts: { [id]: { tag, bbox: [x, y, w, h], fill?, stroke?, strokeWidth? } } }
  ```

  `bbox` ist eine konservative Hülle aus Kontrollpunkten im Koordinatensystem
  des Elternelements des Teils. Sie dient als Standard-Pivot (Mitte).

## 5. Darstellung (AP08)

- Der Renderer bettet die normalisierte Ausgabe als SVG-Fragment ein. Alle
  `r<n>`-IDs und `url(#r<n>)` erhalten das Präfix `ovl-<elementId>-`, damit
  mehrere Instanzen nicht kollidieren.
- Animierte Teile werden mit einer äußeren `<g transform>` gemäß der
  Transformationsreihenfolge des Dokumentmodells umhüllt. Eine vorhandene
  `transform` des Teils bleibt innen.
- `fill`/`stroke`/`strokeWidth`-Überschreibungen setzen das Attribut am Teil.

## 6. Importablauf

1. `POST …/overlay/assets` mit der Rohdatei (siehe API-Vertrag) liefert entweder
   ein vorläufiges Asset (`pending`), die normalisierte Ausgabe, die Metadaten
   und den Bericht, oder eine Ablehnung mit Bericht.
2. Der Editor zeigt die Vorschau aus der **normalisierten Ausgabe**. Das
   Original wird nie dargestellt.
3. Nach Bestätigung entsteht ein `svgAsset`-Element mit `assetId` (Editor-Befehl);
   der nächste Autosave referenziert das Asset.
4. Nicht referenzierte `pending`-Assets werden nach 24 h entfernt.

Bericht: `[{ code, count, examples: string[≤3] }]`, Codes `SVG_REMOVED_ELEMENT`,
`SVG_REMOVED_ATTRIBUTE`, `SVG_EXTERNAL_REFERENCE`, `SVG_UNSUPPORTED_CSS`,
`SVG_FONT_MAPPED`, `SVG_UNIT_CONVERTED`, `SVG_METADATA_REMOVED`; Ablehnung:
`SVG_REJECTED_DOCTYPE`, `SVG_REJECTED_LIMIT`, `SVG_REJECTED_PARSE`,
`SVG_REJECTED_EMPTY`, `SVG_REJECTED_USE_CYCLE`.

## 7. Austauschpaket (D34)

```jsonc
{
  "format": "signalrc-overlay-package",
  "formatVersion": 1,
  "kind": "export",                    // oder "backup" (Konfliktsicherung)
  "exportedAt": "2026-11-01T12:00:00Z",
  "baseRevision": 17,                  // nur bei "backup"
  "source": {
    "streams":  [{ "streamId": "front", "name": "Front", "width": 1280, "height": 720 }],
    "telemetry": [{ "name": "odoSpeed", "dataType": "Number", "unit": "m/s" }],
    "outputs":  ["steering"]
  },
  "document": { "schemaVersion": 1 },
  "assets": { "sha256-…": { "svg": "<svg …>…</svg>" } }
}
```

- Enthält keine Livewerte, persönlichen Einstellungen, Berechtigungen,
  Benutzernamen oder Zugangsdaten.
- **Import:**
  1. Paketprüfung: höchstens 2 MB `document`, höchstens 10 MB Assets, höchstens
     13 MB Datei.
  2. Jedes Asset wird erneut über `POST …/overlay/assets` bereinigt.
     Abweichende `assetId`s werden im Dokument ersetzt.
  3. Zuordnungsdialog für Streams und Kanäle. Umbenennen in Formeln
     geschieht über den AST (Quellenargumente), nicht per Textersetzung.
  4. Vorschau und Bestätigung; danach ersetzt der Editor-Befehl
     `replaceDocument` den Entwurf (D19, Undo-fähig).
- Ungelöste Referenzen bleiben als `publish`-Diagnosen bestehen.
