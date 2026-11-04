# Overlay-LiDAR v1: Gruppen, Grundraster, Widget-Sektoren

Status: **freigegeben** (AP00, 2026-11-01), Vertrag v1. Grundlage: T01,
D15–D17, D40, D41, D58, D62 und die LiDAR-Regeln des Produktplans.
Zuständig: AP04 (Onboard), AP03 (Transport), AP08 (Widget).
Referenzfälle: [`../fixtures/lidar/cases.json`](../fixtures/lidar/cases.json).

## 1. Quelle

- Neuer Reader `LidarGridTelemetryReader` (AP04) liest `ILidarSource.LatestRawScan`,
  nicht den gefilterten `LatestScan` (D15).
- Der bestehende `LidarTelemetryReader`, `LidarScanFilter` und deren
  Konfiguration bleiben unverändert.
- Ein Scan wird nur einmal verarbeitet; Kennung ist `LidarScan.Sequence`
  (D16). Ohne neuen Scan liefert der Reader kein Sample, das Alter wächst also
  weiter.
- Kanal: `readIntervalTicks = 2`, also höchstens 5 Hz (D16), und eine eigene
  `groupKey` `lidarGrid`.
- Neuer `TelemetryDataType.LidarGrid = 4`.

Kanaloptionen (Quellkonfiguration, je LiDAR-Quelle):

| Option | Standard | Bedeutung |
| --- | --- | --- |
| `pinManager` | `lidar` | LiDAR-Modul |
| `mountYawDeg` | 0 | Montageversatz, im Uhrzeigersinn positiv (D41) |
| `zoneLimitsMm` | `[500, 1000, 2000, 3000, 5000]` | fünf Zonen-Obergrenzen, streng steigend |
| `neighborMaxMm` | 50 | räumlicher Nachbarabstand (inklusive) |
| `minGroupPoints` | 3 | Mindestgröße einer Gruppe |
| `scannerClockwise` | `true` | Zählrichtung der Rohindizes, vorläufig (§2, D58) |

Präzisierungen aus der Umsetzung (AP04):

- Prüfung der Optionen: genau fünf ganzzahlige Zonengrenzen, `L0 > 0`,
  streng steigend, `L4 ≤ 65534`; `neighborMaxMm > 0`;
  `1 ≤ minGroupPoints ≤ 1440`; `mountYawDeg` endlich, beliebig groß (wird
  umgebrochen). Ungültige Optionen ergeben einmal ein Sample mit leerem Wert
  und Zustand `Error`, danach nichts.
- `scannerClockwise` ist die Quellkonfiguration für die Konstante aus §2. Die
  Einrichtungsaktion schreibt sie nicht; es gilt der Standard des Readers.

## 2. Winkel

- Rohindex `i ∈ [0, 1440)`; `a_raw = i · 0,25°`, Index 0 = vorne.
- Zählrichtung: Der Produzent bildet auf **im Uhrzeigersinn von oben** ab.
  Die Richtung des Scanners wird in AP04 bestimmt (D58); bis dahin gilt die
  Konstante `ScannerClockwise = true` als vorläufig. Umgesetzt ist sie als
  Kanaloption `scannerClockwise` (§1); `false` bedeutet `a = −a_raw + mountYawDeg`.
- Korrigierter Winkel: `a = wrap(±a_raw + mountYawDeg, 0, 360)`.

## 3. Gruppenerkennung (auf dem ganzen Rundscan)

1. Ein Punkt `i` ist **brauchbar**, wenn
   `DistanceMm[i] > 0`, `≠ LidarScan.Missing` und `< LidarProtocol.NoReturnThresholdMm`.
2. Nachbarn sind `i` und `(i + 1) mod 1440`. Sie sind **verbunden**, wenn beide
   brauchbar sind und `r1² + r2² − 2·r1·r2·cos(0,25°) ≤ neighborMaxMm²` gilt
   (Draufsicht, Rechnung in double).
3. Gruppen sind maximale Ketten verbundener Punkte, auch über 1439 → 0. Sind
   alle 1440 Punkte verbunden, ist das eine einzige Gruppe.
4. Gültig ist eine Gruppe mit mindestens `minGroupPoints` Punkten.
5. Fehlende Punkte unterbrechen Ketten; es wird nicht überbrückt.

## 4. Grundraster

- 96 Zellen, Zelle `k` = `[k · 3,75°, (k + 1) · 3,75°)` im korrigierten Winkel.
  Ein Punkt genau auf einer Grenze gehört zur höheren Zelle.
- Zone `z` (0–4): `(0, L0]`, `(L0, L1]`, … `(L3, L4]` mit `L = zoneLimitsMm`.
  Abstände `> L4` gehören zu keiner Zone.
- Zellwert `[k][z]` = kleinster Abstand (mm) eines Punktes einer gültigen
  Gruppe in Zelle `k` und Zone `z`, sonst `0xFFFF`.
- Werte ≥ `0xFFFF` können wegen `L4 ≤ 65534` nicht auftreten. Die Prüfung der
  Optionen verlangt `L4 ≤ 65534`.

## 5. Drahtformat (D40, geändert durch D62)

Der Sample-`value` ist ein **reiner Text** ohne JSON (kein Escaping im
umgebenden JSON). Aufbau: `<Version><Vollständig><Kodierung>:<Base64>`:

- `Version` = `1`,
- `Vollständig` = `1`/`0` (`LidarScan.Complete`),
- `Kodierung` = `d` (dicht) oder `s` (dünn),
- Base64 im Standard-Alphabet mit Padding.

Beispiel: `11s:AQBkAA==`.

- **Einheit:** Zentimeter als uint16 Little Endian, `cm = floor((mm + 5) / 10)`.
  Gruppenerkennung und Zonenzuordnung rechnen weiter in mm (§3, §4). Der
  Zonenindex steckt im Feldindex, nicht im Wert.
- **Dicht (`d`):** 480 Werte in der Reihenfolge `(k · 5 + z)`, `0xFFFF` =
  unbelegt; 960 Bytes.
- **Dünn (`s`):** nur belegte Felder als Paare `(index: uint16, cm: uint16)`,
  aufsteigend nach `index = k · 5 + z`; 4 Bytes je Feld. Ein leeres Raster
  ergibt `11s:`.
- **Wahl:** dünn, solange höchstens 239 Felder belegt sind (dann kleiner als
  dicht), sonst dicht.
- **Zonengrenzen** stehen in den Kanalmetadaten (REST, Optionen
  `zoneLimitsMm`) und werden nicht im Datenstrom übertragen.
- **Totband gegen Messrauschen:** Das Onboard vergleicht jedes neue Raster mit
  dem zuletzt **gesendeten**. Unverändert ist es, wenn alle drei Bedingungen
  gelten:
  - dieselben Felder sind belegt,
  - jeder Wert weicht um höchstens 2 cm ab,
  - `Vollständig` ist gleich.

  Dann wird der Kanal nur bestätigt (Telemetrievertrag §4) und die Anzeige darf
  bis zu 2 cm hinterherhinken. Sonst wird das ganze Raster neu gesendet.
- `state`/`ageMs` laut Telemetrievertrag:
  - `ageMs` = jetzt − `ReceivedUtc` des zuletzt verarbeiteten Scans,
  - `Stale` bei `Spinning == false`,
  - `Error` bei geschlossenem Port oder `Problem`,
  - `NoData` vor dem ersten Scan.

  Bestätigt wird nur nach einem **neuen** Scan (neue `Sequence`).
- Präzisierungen aus der Umsetzung (AP04):
  - Ein Scan gilt als neu, wenn sich `Sequence` oder `ReceivedUtc` ändert
    (der Pico zählt nach einem Neustart von vorn).
  - Ändert sich der Zustand ohne neuen Scan (Port zu, Stillstand), geht einmal
    der zuletzt erzeugte Wert mit dem neuen Zustand hinaus; sonst wären
    `Stale` und `Error` nie sichtbar. Vor dem ersten Scan geht einmal ein
    leerer Wert mit `NoData` hinaus.
  - Das Totband vergleicht mit dem zuletzt vom Reader erzeugten Wert. Liegt
    das neue Raster im Totband, liefert der Reader denselben Text noch einmal;
    der Delta-Tracker (Telemetrievertrag §4) macht daraus eine Bestätigung.
- **Datenmenge zum Client:**
  - Stillstand: etwa 0,3 kB/s (Bestätigungen),
  - Fahrt mit etwa 60 belegten Feldern: etwa 2 kB/s,
  - Obergrenze dicht: etwa 7 kB/s.

  Den Nachweis führt AP14.

## 6. Widget-Darstellung (AP08)

Die Widget-Eigenschaft `display` wählt die Darstellung: `sectors` (Standard,
§6.1) oder `contour` (§6.2, D74). Beide arbeiten nur im Client auf dem
Grundraster aus §4/§5; Drahtformat, Onboard und Server sind unabhängig davon.

### 6.1 Sektoren

Für `S ∈ {4, 6, 8, 12, 16, 24}`: Breite `W = 360/S`, Sektor `j` (0 = vorne,
im Uhrzeigersinn) umfasst `[j·W − W/2, j·W + W/2)`.

- Zellen je Sektor: `c = 96/S`. Erste Zelle:
  `k0 = (j·c − c/2) mod 96`, wobei `c/2 = W/2 / 3,75` immer ganzzahlig ist.
- Feld `[j][z]` = Minimum der Zellwerte `[k0 … k0+c−1 (mod 96)][z]`.
  `0xFFFF` = unbelegt.

### 6.2 Kontur (D74)

Macht zusammenhängende Objekte sichtbar. Referenzfälle: `contour` in
[`../fixtures/lidar/cases.json`](../fixtures/lidar/cases.json).

1. **Nächster Punkt je Zelle:** Für jede Zelle `k` ist `z(k)` die niedrigste
   belegte Zone und `r(k) = Zellwert[k][z(k)] · 10` in mm (Zentimeter des
   Drahtformats). Wegen der Rundung `floor((mm + 5) / 10)` ist das zugleich das
   Minimum über alle Zonen. Ohne belegte Zone ist die Zelle leer.
2. **Verbindung:** Zelle `k` und `(k + 1) mod 96` sind verbunden, wenn beide
   belegt sind und gilt (Draufsicht, Zellmitten im Abstand `Δ = 3,75°`,
   Rechnung in double):

   `r1² + r2² − 2·r1·r2·cos(Δ) ≤ (J + c · min(r1, r2))²`,
   `c = 2·sin(Δ/2) ≈ 0,0654`, `J = contourJoinMm`.

   `c · min(r1, r2)` ist der Bogenabstand zweier gleich weit entfernter
   Zellmitten. Gleich weit entfernte Nachbarn sind damit in jeder Entfernung
   verbunden, auch bei 5 m (Sehne ≈ 327 mm, ein fester Grenzwert von 300 mm
   würde dort jede Wand zerlegen). `J` ist die zusätzlich erlaubte Lücke,
   vor allem der Tiefensprung zwischen Objekten. Standard `J = 300` mm:
   - Eine Kiste in 1 m vor einer Wand in 2,5 m wird getrennt.
   - Ein Sprung von 1 m auf 1,4 m trennt (≈ 407 mm > 365 mm); 1 m auf 1,35 m
     verbindet (≈ 358 mm).
   - Schräg gesehene Wände bleiben bis etwa 60° Einfallswinkel verbunden
     (bei 3 m: Punktabstand ≈ 393 mm, Grenze ≈ 496 mm).

   Grenzen: `10 ≤ J ≤ 5000`. Mit `J > 0` liegt der Gleichabstand nie auf der
   Grenze, Rundungsfehler entscheiden also nicht.
3. **Ketten:** maximale Folgen verbundener Zellen, auch über 95 → 0, geordnet
   nach ihrer ersten Zelle (die Zelle, deren Vorgänger nicht verbunden ist).
   Sind alle 96 Paare verbunden, ist das eine geschlossene Kette ab Zelle 0.
   Eine Kette der Länge 1 ist eine isolierte Zelle.
4. **Lage im Widget:** Winkel wie im Raster (vorne oben, im Uhrzeigersinn).
   Radius linear im Ring der Zone `z = z(k)` (fünf gleich breite Ringe, Radius
   `R`): `ρ = R/5 · (z + clamp((r − L[z−1]) / (L[z] − L[z−1]), 0, 1))` mit
   `L[−1] = 0`. Die Darstellung ist wie das Raster nicht maßstabsgetreu, die
   Verbindung (2.) rechnet aber mit echten Abständen.
5. **Zeichnung:** Jede angezeigte Zelle `k` zeichnet ein Stück von der
   Zellgrenze `k · Δ` über die Zellmitte `(k + ½) · Δ` (Radius `ρ(k)`) zur
   Grenze `(k + 1) · Δ`. Der Radius an einer Grenze ist bei Verbindung der
   Mittelwert beider Zellen (die Stücke stoßen aneinander, Ketten erscheinen
   als Linienzug), sonst `ρ(k)` (Kettenende, isolierte Zelle: kurzer Bogen über
   die Zellbreite). Höchstens 96 Stücke.
   - Farbe je Stück nach `r(k)` auf derselben durchgehenden Skala wie die
     Sektoren; Pulsieren und Nachleuchten je Zelle wie je Feld in §6.1.
   - Nachleuchtende Zellen zählen mit ihrem letzten Abstand weiter für die
     Verbindung.
   - Optionaler Schatten (`contourShadow`, Deckkraft
     `contourShadowOpacity × Puls`): Fläche zwischen Stück und äußerem Ring.
   - Die fünf Ringe bleiben als ungefülltes Bezugsgitter (`idleColor`) mit
     Beschriftung, dazu Sweep, Warndreieck und Ungültig-Zustand wie in §6.1.
   - Neu berechnet wird nur bei neuem Raster, abgelaufenem Nachleuchten oder
     geänderten Optionen; sonst ändern sich nur die Deckkräfte.

### 6.3 Rasterzustand

Darstellung, Farben, Blinken und Nachleuchten regelt der Produktplan; die
Parameter stehen im Katalog (`lidarWidget`). Der Rasterzustand folgt dem
Telemetrievertrag:

- `complete == false` bei sonst gültigem Sample: gelbes Warndreieck am ganzen
  Raster. Erkannte Gruppen werden gezeigt.
- ungültig: allgemeiner Ungültig-Zustand.
- Nachleuchten verlängert keine Gültigkeit.

## 7. Einrichtung bestehender Installationen (D17)

- Aktion „LiDAR-HUD-Quelle einrichten“, nur für den Sitzungsbenutzer, der die Steuerung hält (D73)
  (wie die HUD-Verwaltung). Sie legt über die bestehende Kanalverwaltung
  einen `CarTelemetry`-Kanal `lidarGrid` an:
  - Typ `LidarGridTelemetryReader`,
  - `DataType = LidarGrid`,
  - die Optionen aus §1.
- Gibt es den Kanal schon, ändert die Aktion nichts und meldet das.
- Präzisierungen aus der Umsetzung (AP04):
  - `pinManager` ist `lidar`, wenn es diesen Pin-Manager gibt oder keinen
    bzw. mehrere vom Typ `LidarManager`; gibt es genau einen anderen, dessen
    Name.
  - Der neue Kanal geht wie bei der Kanalverwaltung sofort ans Onboard, mit
    `ServerId`. Die Optionen lassen sich danach über die bestehende
    Kanalverwaltung (`PUT …/channels/telemetry/lidarGrid`) ändern.
- Anzeigen oder Veröffentlichen eines HUDs legt nie Kanäle an.
