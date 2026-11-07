# Overlay-Laufzeit v1: Zeit, Clips, Raten, Glättung

Status: **freigegeben** (AP00, 2026-11-01), Vertrag v1. Grundlage: D10–D14,
D23, D27, D28, D51 sowie die Animations- und Qualitätsregeln des Produktplans.
Referenzfälle: [`../fixtures/runtime/cases.json`](../fixtures/runtime/cases.json).

## 1. Uhr und Frames

- Die Laufzeit erhält eine **monotone Uhr in Sekunden** (Produktiv:
  `performance.now()/1000`; Tests/Simulation: kontrollierte Uhr). Es gibt keine
  Wanduhrzeit und keine Kopplung an Video- oder Telemetrieraten.
- Ein **Frame** ist ein Auswertungsschritt zum Zeitpunkt `t`. In jedem Frame
  werden in dieser Reihenfolge ausgewertet:
  1. Quellwerte,
  2. Clip-Bedingungen und Clip-Zustände,
  3. Raten,
  4. Bindungen samt Glättung,
  5. Clip-Spuren.

  Eine in Frame `t` beobachtete Bedingungsänderung wirkt im selben Frame.
- `dt` = Abstand zum vorherigen Frame derselben Sitzung. Für die Integration von
  **Raten** wird `dt` auf höchstens 0,25 s begrenzt; nach Rucklern springt die
  Bewegung also nicht. Clips und Glättung verwenden das ungekürzte `dt` bzw.
  die absolute Zeit.

## 2. Anzeigesitzung

Sämtlicher Laufzeitzustand (Clips, Raten, Glättung, Pulse-Historie) gehört zu
einer **Anzeigesitzung** und wird an ihrem Beginn frisch angelegt.

Eine Sitzung **beginnt** bei:
- Einblenden des HUDs,
- Sichtbarwerden der Seite (`visibilitychange`),
- Streamwechsel,
- Übernahme einer neuen Veröffentlichung,
- Eintritt in den Vorschau-Modus,
- Mounten der Ansicht.

Sie **endet** bei:
- Ausblenden des HUDs,
- unsichtbarer Seite,
- Streamwechsel,
- Unmount,
- Verlassen der Vorschau.

Zwischen Sitzungen läuft nichts weiter. Ausgefallene Zeit wird nicht
nachgerechnet; verpasste Ereignisse werden nicht nachgespielt.

Dynamische `visible`-Werte eines Elements beenden **keine** Sitzung. Ein Clip
kann `visible` selbst animieren und läuft deshalb weiter.

## 3. Qualität von Treibern

Für jede Bindung, Rate und Clip-Bedingung gilt der Zustand des Formelergebnisses
(Ausdrucksvertrag §4):

| Zustand | Bindung | Rate | Bedingung |
| --- | --- | --- | --- |
| `valid` | Wert anwenden | integrieren | auswerten |
| `unchecked` | Wert anwenden, gelbes Warndreieck | **anhalten**, Warndreieck | **wie ungültig** (abhängige Bewegung gestoppt), Warndreieck |
| `invalid` | letzten gültigen Wert halten, Ungültig-Markierung | anhalten, Ungültig-Markierung | Clip anhalten, Ungültig-Markierung |

Bei `unchecked` folgen also direkte Bindungen dem Wert mit Warndreieck; nur
Raten und bedingungsabhängige Clips halten an (D71).

`paused` setzt nur die Pausenmarkierung (D09) und hält nichts an.

Liefert eine Bindung seit Sitzungsbeginn noch keinen gültigen oder ungeprüften
Wert, zeigt die Eigenschaft ihren **Grundwert** (`base`) mit
Ungültig-Markierung. Der Grundwert ist ein Gestaltungswert, kein Messwert;
zahlenförmige Anzeigen (`valueText`) zeigen in diesem Fall „—“.

Nach Rückkehr zu `valid` gilt D14 (frischer Start):

- Bindungen übernehmen sofort den aktuellen Wert, auch geglättete.
- Raten beginnen wieder beim Grundwert.
- Clips werten ihren Auslöser wie zu Sitzungsbeginn aus.

### Markierungen

Der Renderer zeichnet je betroffenem Element ein Symbol in fester
Bildschirmgröße (16 CSS-px) an die obere rechte Ecke seiner Box, unabhängig
von der Elementskalierung:

| Zustand | Symbol | Wirkung auf das Element |
| --- | --- | --- |
| ungültig | graues durchgestrichenes Symbol | Deckkraft × 0,4 |
| ungeprüft | gelbes Warndreieck mit Ausrufezeichen | – |
| pausiert | graues Pausensymbol | – |

`onInvalid: "hide"` blendet das Element bei „ungültig“ stattdessen aus. Bei
„ungeprüft“ bleibt es sichtbar.

Treffen mehrere Zustände zusammen, gilt die Priorität ungültig > ungeprüft >
pausiert. Das LiDAR-Widget verwendet zusätzlich die Rasterwarnung des
LiDAR-Vertrags.

## 4. Bindungen und Glättung (D28)

- Ohne Glättung: Eigenschaft = Formelwert des Frames.
- Mit Zeitkonstante τ: `y ← y + (x − y) · (1 − e^(−dt/τ))`. Für `angle`-Eigenschaften
  wird `x − y` vorher auf `[−180, 180)` gewrappt (kürzester Weg). `y` selbst wird
  nicht gewrappt.
- Erster gültiger Wert der Sitzung bzw. nach Ungültigkeit: `y = x`, also ohne
  Einschwingen vom Grundwert.
- Geglättet werden nur Zahlen: Eigenschaften vom Typ Zahl außer ganzzahligen, und
  Eigenschaften vom Typ `any` (z. B. `valueText.value`), solange der Wert eine
  Zahl ist. Andere Werte übernimmt die Bindung sofort.

## 5. Raten

- Start der Sitzung: `v = base`.
- Je Frame mit gültiger Rate `r`: `v ← v + r · min(dt, 0,25)`. Mit `wrap {min,max}`
  folgt `v ← min + mod(v − min, max − min)` (Ergebnis in `[min, max)`).
- Frame mit nicht gültiger Rate: `v` bleibt, Markierung nach §3. Nächster
  gültiger Frame: `v = base` (frischer Start), Integration ab dem Folgeframe.

## 6. Clip-Zustandsmaschine

Zustände: `idle`, `running(start)`, `finishing(start)`, `ended`, `suspended`.
`d` = `durationS`, `n` = `repeat` (∞ bei `"infinite"`),
`e = t − start` (verstrichene Zeit).

### Ausgabe je Zustand

- `running` / `finishing`: lokale Zeit `τ = e − d · floor(e / d)`. Bei endlichem `n`
  und `e ≥ n · d` wechselt der Clip im selben Frame nach `ended`.
- `idle`, `ended` mit `endState: "base"`: Grundwerte der Spur-Eigenschaften.
- `ended` mit `endState: "hold"`: Spurwert bei `τ = d`.
- `suspended`: Spurwerte des letzten Frames vor dem Anhalten, mit Markierung.

### Übergänge

| Auslöser | Ereignis | Übergang |
| --- | --- | --- |
| `auto` | Sitzungsbeginn | → `running(t)` |
| `whileTrue` | Bedingung gültig wahr und Zustand `idle` | → `running(t)` |
| `whileTrue` | Bedingung gültig falsch in `running`, `onDeactivate: stop` | → `ended` |
| `whileTrue` | Bedingung gültig falsch in `running`, `onDeactivate: finish` | → `finishing(start)` |
| `whileTrue` | Bedingung gültig wahr in `finishing` | → `running(start)` (nahtlos, D23) |
| `whileTrue` | `finishing` erreicht das Ende der aktuellen Iteration | → `ended` |
| `whileTrue` | Bedingung gültig falsch in `ended` | → `idle` |
| `pulse` | beobachteter Wechsel gültig falsch → gültig wahr in `idle`/`ended` | → `running(t)` |
| `pulse` | derselbe Wechsel in `running`, `retrigger: restart` | → `running(t)` (Neustart bei 0) |
| `pulse` | derselbe Wechsel in `running`, `retrigger: ignore` | bleibt |
| `whileTrue`/`pulse` | Bedingung ungültig oder ungeprüft in `running`/`finishing` | → `suspended` |
| `whileTrue`/`pulse` | Bedingung ungültig oder ungeprüft in `idle`/`ended` | bleibt, Markierung |
| `whileTrue`/`pulse` | erster gültiger Frame nach `suspended` | wie Sitzungsbeginn auswerten |

Ein `whileTrue`-Clip mit endlichem `n`, der bei weiter wahrer Bedingung endet,
bleibt `ended`. Er startet erst nach einem gültigen `false` (→ `idle`) und
erneutem `true`.

### Pulse-Historie (D10, D14)

`prev ∈ { unknown, false, true }`, zu Sitzungsbeginn `unknown`.

- Ein gültiger Frame setzt `prev` auf den Bedingungswert.
- Ein ungültiger oder ungeprüfter Frame setzt `prev = unknown`.
- Nur `prev = false` und aktueller Wert gültig `true` ist eine Flanke.
- Ein laufender Puls spielt unabhängig von späteren `false`-Werten zu Ende.

### Keyframe-Auswertung bei τ

- Vor dem ersten Keyframe gilt dessen Wert, nach dem letzten der letzte.
- Dazwischen gilt das Segment `[k_i, k_{i+1}]` mit `easing` von `k_i`:
  - `linear`
  - `easeIn` = cubic-bezier(0.42, 0, 1, 1)
  - `easeOut` = cubic-bezier(0, 0, 0.58, 1)
  - `easeInOut` = cubic-bezier(0.42, 0, 0.58, 1)
  - `step`: Wert von `k_i` bis zum nächsten Keyframe
- Für `step`-Arten (Katalog) gilt immer `step`.
- Farben werden je RGBA-Kanal (0–255) linear interpoliert und gerundet. `none`
  wird nicht interpoliert (`step`).

## 7. Gestaltungsmodus und Scrubbing

- Die Gestaltungsfläche zeigt **Grundwerte**. Bindungen, Raten und Clips
  laufen nicht; Formelergebnisse zeigt live nur der Eigenschaftseditor.
- Scrubbing: Für genau einen ausgewählten Clip wird `τ` gesetzt. Dessen Spuren
  zeigen den Wert bei `τ`, alle anderen Eigenschaften ihre Grundwerte.
- Der Vorschau-Modus nutzt dieselbe Laufzeit wie die Fahreransicht (neue
  Sitzung beim Eintritt).

## 8. Laufzeitdiagnosen

Der Renderer meldet Laufzeitdiagnosen in der Form `{ code, severity, location,
message }` mit `location` wie im Dokumentmodell §8. Er meldet nur bei einer
Änderung der Menge, nicht pro Frame. Sie sind keine Dokumentdiagnosen und
blockieren weder Speichern noch Veröffentlichen.

| Code | Schwere | Bedeutung |
| --- | --- | --- |
| `OVL_EXPR_*`, `OVL_REF_UNKNOWN_SOURCE` | error | Formel nicht auswertbar (statische Analyse) |
| `OVL_EXPR_DIV_ZERO`, `OVL_EXPR_DOMAIN`, `OVL_EXPR_NOT_FINITE`, `OVL_EXPR_SOURCE_PARSE` | warning | Formel liefert in diesem Frame keinen gültigen Wert |
| `OVL_CLIP_PROPERTY_CONFLICT` | error | Spur auf bereits gesteuerter Eigenschaft wird nicht angewendet |
| `OVL_REF_UNKNOWN_ASSET` | warning | Asset zur Laufzeit nicht vorhanden; Element ungültig markiert |
| `OVL_RUNTIME_ASSET_INVALID` | warning | Asset ist nicht in normalisierter Form lesbar; Element ungültig markiert |
| `OVL_RUNTIME_INVALID_VALUE` | warning | Formelwert für die Eigenschaft nicht darstellbar (Typ, Farbtext, außerhalb der Katalog-Grenzen; `opacity` wird geklemmt) |
| `OVL_RUNTIME_INVALID_GRAPHIC` | warning | ungültiger Grafikzustand, z. B. Anzeige mit `max ≤ min` |
| `OVL_RUNTIME_ELEMENT_ERROR` | warning | Fehler beim Darstellen eines Elements; die letzte Darstellung bleibt, andere Elemente sind nicht betroffen |
| `OVL_RUNTIME_ERROR` | error | Frame nicht berechenbar; das letzte Bild bleibt stehen |

Bei `invalid` gelten die Markierungsregeln aus §3.
