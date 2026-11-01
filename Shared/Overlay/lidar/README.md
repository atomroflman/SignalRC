# Overlay-LiDAR v1: Gruppen, Grundraster, Widget-Sektoren

Status: **freigegeben** (AP00, 2026-11-01), Vertrag v1. Grundlage: T01,
D15–D17, D40, D41, D58 und die LiDAR-Regeln des Produktplans.
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

## 2. Winkel

- Rohindex `i ∈ [0, 1440)`; `a_raw = i · 0,25°`, Index 0 = vorne.
- Zählrichtung: Der Produzent bildet auf **im Uhrzeigersinn von oben** ab.
  Die Richtung des Scanners wird in AP04 bestimmt (D58); bis dahin gilt die
  Konstante `ScannerClockwise = true` als vorläufig.
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

## 5. Drahtformat (D40)

Der Sample-`value` ist ein kompakter JSON-Text:

```json
{"v":1,"seq":123456,"complete":true,"zonesMm":[500,1000,2000,3000,5000],"cells":"<base64>"}
```

- `cells`: 480 × uint16 Little Endian, Index `(k · 5 + z)`, Base64 (Standard-
  Alphabet, mit Padding) = 1280 Zeichen.
- `seq` = `LidarScan.Sequence`; `complete` = `LidarScan.Complete`.
- `state`/`ageMs` laut Telemetrievertrag:
  - `ageMs` = jetzt − `ReceivedUtc`,
  - `Stale` bei `Spinning == false`,
  - `Error` bei geschlossenem Port oder `Problem`,
  - `NoData` vor dem ersten Scan.
- Budget ohne Transport-Overhead: etwa 1,4 kB je Snapshot, etwa 7 kB/s bei
  5 Hz. Der Nachweis der gemessenen Bandbreite erfolgt in AP14 (Ziel ≤ 8 kB/s
  für diesen Kanal einschließlich Batch-Hülle).

## 6. Widget-Sektoren (AP08)

Für `S ∈ {4, 6, 8, 12, 16, 24}`: Breite `W = 360/S`, Sektor `j` (0 = vorne,
im Uhrzeigersinn) umfasst `[j·W − W/2, j·W + W/2)`.

- Zellen je Sektor: `c = 96/S`. Erste Zelle:
  `k0 = (j·c − c/2) mod 96`, wobei `c/2 = W/2 / 3,75` immer ganzzahlig ist.
- Feld `[j][z]` = Minimum der Zellwerte `[k0 … k0+c−1 (mod 96)][z]`.
  `0xFFFF` = unbelegt.

Darstellung, Farben, Blinken und Nachleuchten regelt der Produktplan; die
Parameter stehen im Katalog (`lidarWidget`). Der Rasterzustand folgt dem
Telemetrievertrag:

- `complete == false` bei sonst gültigem Sample: gelbes Warndreieck am ganzen
  Raster. Erkannte Gruppen werden gezeigt.
- ungültig: allgemeiner Ungültig-Zustand.
- Nachleuchten verlängert keine Gültigkeit.

## 7. Einrichtung bestehender Installationen (D17)

- Aktion „LiDAR-HUD-Quelle einrichten“, nur für regulären aktiven Fahrer
  (wie die HUD-Verwaltung). Sie legt über die bestehende Kanalverwaltung
  einen `CarTelemetry`-Kanal `lidarGrid` an:
  - Typ `LidarGridTelemetryReader`,
  - `DataType = LidarGrid`,
  - die Optionen aus §1.
- Gibt es den Kanal schon, ändert die Aktion nichts und meldet das.
- Anzeigen oder Veröffentlichen eines HUDs legt nie Kanäle an.
