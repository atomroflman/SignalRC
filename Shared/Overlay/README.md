# Overlay-Verträge (AP00) – Dokumentmodell v1

Status: **Entwurf**, Teil von AP00, noch nicht freigegeben. Entscheidungen
D01–D47 stehen in [Overlay-AP00-Vertraege.md](../../Overlay-AP00-Vertraege.md).
Dieses Verzeichnis ist nach D43 die gemeinsame Vertragsquelle für Client und Server.

| Datei | Inhalt |
| --- | --- |
| `schema/overlay-document.schema.json` | Strukturelles JSON-Schema (Draft 2020-12) des Gesamtdokuments. |
| `catalog/property-catalog.json` | Element-/Property-Katalog: Typen, Defaults, Grenzen, erlaubte Steuerungsmodi. |
| `fixtures/documents/` | Gültige und ungültige Referenzdokumente. |
| `fixtures/documents/cases.json` | Erwartetes Ergebnis je Fixture: Schema-Gültigkeit und Resolver-Diagnosen. |
| `expression/README.md` | Ausdruckssprache v1: Grammatik, Typen, Funktionen, Fehlerregeln. |
| `fixtures/expressions/cases.json` | Gemeinsame Referenzfälle der Ausdruckssprache. |

Gültig ist ein Dokument erst, wenn **Schema und Katalog-/Strukturprüfung** des
Resolvers (AP01) bestehen. Das Schema prüft nur die Form. Eigenschaftsnamen je
Typ, Wertebereiche, Modi, Baumstruktur und Clip-Zuständigkeit prüft der Resolver
anhand des Katalogs.

## 1. Gesamtdokument

Ein Dokument enthält Standard und alle Varianten eines Fahrzeugs (eine
Veröffentlichungseinheit). Felder:

- `schemaVersion` – derzeit `1`. Unbekannte Versionen werden abgelehnt, nicht
  interpretiert.
- `workspace` – Referenz-Arbeitsfläche in logischen Pixeln (D01, D22).
- `rootTransform` – optionales Einpassen nach D39: `p' = p · scale + offset`.
- `disabled` – fahrzeugweit deaktiviert; Gestaltung bleibt erhalten.
- `signals` – benannte Flow-Signale (D36).
- `sources.telemetry[kanal].staleAfterMs` – HUD-Fristüberschreibung je Kanal (D24).
- `elements` – flache Map `id → Element` des Standards.
- `children` – Wurzel-Reihenfolge des Standards, von unten nach oben.
- `clips` – flache Map `id → Clip`.
- `variants` – Map `streamId → Variante`.

Schema-Version, Entwurfsrevision und Veröffentlichungsidentität sind getrennt;
die beiden letzten gehören zum Persistenzvertrag, nicht ins Dokument.

## 2. Identitäten und Namen

- Element-, Teil- und Clip-IDs: `^[A-Za-z0-9_-]{1,64}$`. Neu erzeugte IDs
  verwenden das Präfix `e_` (Element) bzw. `c_` (Clip) und 10 zufällige Zeichen
  aus `[a-z0-9]`. IDs sind unveränderlich und werden nie wiederverwendet.
- `root` ist als Container-Name reserviert und keine gültige Element-ID.
- Element-IDs bilden **einen** Namensraum über Standard und alle
  `addedElements` aller Varianten (Umgruppieren nach D05 bleibt eindeutig).
- Teil-IDs (`parts`) stammen aus der normalisierten SVG-Assetbeschreibung (AP07).
- Kanal-/Streamreferenzen erfolgen über Namen: Telemetrie `ChannelName`,
  Steuerkanal `CarChannel.ChannelName`, Stream `StreamId`. Umbenennen bricht
  Referenzen; dafür gibt es die Warnungen der Kanalverwaltung.
- Quellreferenzen in Formeln (D46): `tel("…")`, `out("…")`, `sig("…")`,
  `driverActive()`. Grammatik und Funktionen: [expression/README.md](expression/README.md).

## 3. Elementtypen

| Typ | Zusatzfelder | Lokaler Ursprung |
| --- | --- | --- |
| `group` | `children` (unten → oben) | Gruppen-Koordinatensystem |
| `rect`, `ellipse` | – | Ecke oben links der Box `width × height` |
| `line` | – | Startpunkt; Ende bei `(x2, y2)` |
| `arc`, `radialGauge` | – | oben links; Mittelpunkt bei `(radius, radius)` |
| `lidarWidget` | `source` (Kanalname des Rasters) | oben links; Mittelpunkt bei `(radius, radius)` |
| `text`, `valueText` | – | Ausrichtungspunkt (`align`) auf der alphabetischen Grundlinie |
| `linearGauge` | – | Ecke oben links der Box |
| `svgAsset` | `assetId`, `parts` | Ursprung der normalisierten Asset-ViewBox |

Gemeinsame Attribute (keine animierbaren Eigenschaften):
`name`, `disabled`, `locked`, `editorHidden`, `lockAspect`, `onInvalid`.

- `disabled` – ausdrücklich deaktiviert (gilt für den ganzen Teilbaum).
  Laufzeit: nicht vorhanden. Veröffentlichung: Referenz-/Formelfehler nur Warnung;
  Struktur, Sicherheit und Limits werden weiterhin voll geprüft.
- `visible` (Eigenschaft) – dynamische Sichtbarkeit; **keine** Deaktivierung.
- `locked`, `editorHidden` – nur Editor, im Entwurf gespeichert und undo-fähig,
  ohne Wirkung auf das veröffentlichte HUD (D47).
- `lockAspect` – Standard `true` für `group` und `svgAsset` (D02), sonst `false`.
  Bei `true` gibt es kein `scaleY`; `scaleX` gilt für beide Achsen.
- `onInvalid` – `hold` (Standard: letzte gültige Darstellung, als ungültig
  markiert) oder `hide`.

Winkel: Grad, im Uhrzeigersinn, 0° zeigt nach oben (12 Uhr). Das gilt für
`rotation`, Bogen-/Anzeigewinkel und die LiDAR-Ausrichtung (vorne oben).

## 4. Transformation (D03)

Für jedes Element und jeden SVG-Teil gilt in genau dieser Reihenfolge, in
SVG-Notation von außen nach innen:

```
translate(x, y) translate(pivotX, pivotY) rotate(rotation) scale(scaleX, scaleY) translate(-pivotX, -pivotY)
```

- `x/y` verschieben den lokalen Ursprung im Eltern-Koordinatensystem.
- `pivotX/pivotY` sind lokale Koordinaten (logische Pixel), nur statisch. Ist kein
  Wert gespeichert, gilt die Mitte der lokalen Box (`"center"` im Katalog).
  Gruppen erhalten beim Anlegen einen festen Pivot (Mitte der damaligen Box).
  Spätere Kinderänderungen verschieben ihn nicht.
- Die Elterntransformation wirkt auf den gesamten Teilbaum (Texte und
  Strichstärken skalieren mit, D02).
- Oberhalb der Wurzel wirken `rootTransform` und danach das Einpassen der
  Arbeitsfläche in den tatsächlichen Videoframe (D01).

## 5. Eigenschaftswerte und Steuerungsmodi

Eine Eigenschaft in `props` ist entweder

- ein **Literal** (Zahl, Text, Bool, `null`) – statisch, oder
- ein Objekt `{ "base": Literal, "binding" | "rate": … }` – genau ein Treiber.

Fehlt die Eigenschaft, gilt der Katalog-Default. `base` ist der statische
Grundwert (D13) und zugleich die Startposition bei Raten.

| Modus | Darstellung | Bedeutung |
| --- | --- | --- |
| `static` | Literal | fester Wert |
| `binding` | `binding.expr`, optional `smoothing.timeConstantS` | direkter Formelwert (D28) |
| `rate` | `rate.expr`, optional `wrap {min,max}` | `wert += expr · dt`; mit `wrap` modulo in `[min, max)` |
| `clip` | Spur in genau einem Clip | Keyframes (D12) |

Regeln:

- Je Eigenschaft höchstens ein Treiber. Eine Eigenschaft mit `binding`/`rate`
  darf keiner Clip-Spur gehören (`OVL_CLIP_PROPERTY_CONFLICT`).
- Erlaubte Modi je Eigenschaft: `modes` im Katalog, sonst die des `kind`.
- `config`-Eigenschaften (z. B. LiDAR-Parameter, Dezimalstellen) und `enum`
  sind nur statisch.
- Farben: `#rrggbb`, `#rrggbbaa` oder `none`. Formeln liefern Farben als Text,
  typischerweise per `if()` aus Literalen (D29). Ein ungültiger Farbtext
  ergibt einen ungültigen Wert.
- `opacity` wird auf `[0, 1]` geklemmt. Andere dynamische Ergebnisse werden nicht
  geklemmt; nicht endliche Werte sind ungültig. Statische Werte außerhalb der
  Katalog-Grenzen sind ein Strukturfehler (`OVL_PROP_OUT_OF_RANGE`).
- `valueText`: `decimals`/`unit` mit Default `"fromSource"` übernehmen die
  Kanalmetadaten. Ungültige Werte werden als „—“ angezeigt.
- Glättung von `angle`-Eigenschaften nimmt den kürzesten Weg; Keyframes
  interpolieren numerisch, damit mehrfache Umdrehungen möglich bleiben.

Interpolation zwischen Keyframes: `linear` für Zahlenarten, `linearRgba` für
Farben, `step` für `integer`, `bool`, `text`, `any`. `easing` eines Keyframes
gilt für das Segment bis zum nächsten Keyframe.

## 6. Clips (Datenform)

`durationS`, `repeat` (Anzahl ≥ 1 oder `"infinite"`, Standard 1), `trigger`,
`endState` (`base` | `hold`), `tracks`. Auslöser:

- `auto` – läuft, solange das Element angezeigt wird.
- `whileTrue` + `condition`, `onDeactivate` `stop` | `finish` (D23).
- `pulse` + `condition`, `retrigger` `restart` | `ignore` (D10, D11).

Keyframes je Spur: aufsteigend nach `t` (gleiche Zeiten unzulässig), `0 ≤ t ≤ durationS`.
Die Laufzeit-Zustandsmaschine wird in einem eigenen Vertrag beschrieben.

## 7. Varianten und Auflösung

Eine Variante (`variants[streamId]`) enthält nur Abweichungen:

- `disabled: true` – für diesen Stream **kein HUD**, kein Rückfall auf den Standard.
- `workspace`, `rootTransform` – eigene Arbeitsfläche/Einpassung.
- `elements[id]` – Überschreibungen geerbter Elemente: Attribute sowie `props`
  und `parts[pid].props` **je Eigenschaft vollständig ersetzend** (inklusive
  Treiber). Rücksetzen = Schlüssel entfernen.
- `addedElements` – eigene Elemente. Kinder hinzugefügter Gruppen stehen in
  deren `children`.
- `structure.parents[id]` – neuer Container (`root` oder Gruppen-ID) für ein
  geerbtes oder hinzugefügtes Element.
- `structure.order[container]` – Reihenfolge innerhalb eines Containers.
- `clips[id]` – Überschreibung geerbter Clips, je Feld vollständig ersetzend
  (`tracks` als ganze Liste). `addedClips` – eigene Clips.

Auflösung für einen Stream `s`:

1. Ohne Eintrag `variants[s]` gilt der Standard. Ist `variants[s].disabled` oder
   das Dokument `disabled`, ist das Ergebnis „kein HUD“.
2. Elementmenge = Standard ∪ `addedElements`; Attribute/Props = Standard,
   überlagert von `elements[id]`.
3. Deklarierter Elterncontainer = der Container, dessen `children` (Standard
   oder hinzugefügte Gruppe) die ID enthält. Effektiver Container =
   `structure.parents[id]`, falls vorhanden, sonst der deklarierte.
4. Kinderreihenfolge eines Containers: zuerst die Einträge aus
   `structure.order[container]`, die effektiv in diesem Container liegen. Danach
   die übrigen in ihrer deklarierten Reihenfolge, danach hineinverschobene
   Elemente ohne Ordnungseintrag in ordinaler Sortierung ihrer ID.
5. Variante gewinnt bei Strukturkonflikten (D38). Verweist eine Überschreibung
   auf ein gelöschtes Element, muss die Löschaktion sie mit entfernt haben;
   ein verbleibender Verweis ist `OVL_REF_UNKNOWN_ELEMENT`.
6. Clips = Standard ∪ `addedClips`, überlagert von `clips[id]`. Die
   Clip-Zuständigkeit (D12) wird auf dem effektiven Ergebnis geprüft.
7. `disabled` eines Elements deaktiviert seinen effektiven Teilbaum.

Strukturregeln auf dem Standard und jeder effektiven Variante: jedes Element
genau einmal in genau einem Container, keine Zyklen, keine unbekannten IDs.

## 8. Diagnosen

```json
{ "code": "OVL_…", "category": "structure|publish|warning", "severity": "error|warning",
  "location": { "variant": "…", "element": "…", "part": "…", "property": "…",
                "clip": "…", "track": 0, "keyframe": 0, "container": "…", "ref": "…" },
  "message": "…" }
```

- `structure` – verhindert das Speichern des Entwurfs (Struktur/Sicherheit/Limits).
- `publish` – Entwurf speicherbar, Veröffentlichung blockiert. In deaktivierten
  Teilen wird daraus eine `warning`.
- `warning` – nicht blockierend.
- `location` enthält nur die zutreffenden Felder; ohne `variant` betrifft die
  Diagnose den Standard.

Fehler in Standard-Strukturen sind `structure`. Strukturfehler, die erst in einer
effektiven Variante entstehen (D38), sind `publish`, damit der Entwurf trotz
einer späteren Standard-Umstrukturierung speicherbar bleibt.

Bisher definierte Codes: `OVL_STRUCT_MULTIPLE_PARENTS`, `OVL_STRUCT_ORPHAN`,
`OVL_STRUCT_CYCLE`, `OVL_REF_UNKNOWN_ELEMENT`, `OVL_REF_UNKNOWN_SOURCE`,
`OVL_ID_DUPLICATE`, `OVL_PROP_UNKNOWN`, `OVL_PROP_MODE_NOT_ALLOWED`,
`OVL_PROP_LOCKED_ASPECT`, `OVL_PROP_OUT_OF_RANGE`, `OVL_PROP_INVALID_WRAP`,
`OVL_CLIP_PROPERTY_CONFLICT`, `OVL_CLIP_KEYFRAME_ORDER`, `OVL_CLIP_KEYFRAME_RANGE`,
`OVL_LIMIT_EXCEEDED` (D33). Die Formelcodes folgen mit dem Ausdrucksvertrag.

## 9. Grenzen (D33)

Das Schema erzwingt nur Feldlängen (Formeln ≤ 1000 Zeichen, ≤ 500 Keyframes je
Spur, ≤ 200 Spuren je Clip). Die Dokumentgrenzen prüft der Resolver mit
`OVL_LIMIT_EXCEEDED` (`structure`): ≤ 500 Elemente je effektiver Ansicht, ≤ 200
Clips, ≤ 300 Formeln, Ausdruckstiefe ≤ 32, ≤ 2 MB JSON, Assets gesamt ≤ 10 MB.

## 10. Änderungen an diesem Vertrag

Nur koordiniert: Änderungsvorschlag, betroffene Pakete, aktualisierte Fixtures
und `cases.json` gehören in dieselbe Änderung. Kompatible Erweiterungen erhöhen
`catalogVersion`; inkompatible Änderungen erhöhen `schemaVersion`.
