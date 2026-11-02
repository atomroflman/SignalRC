# Overlay-Quellen v1.1: Telemetriequalität und Steuerungsanzeige

Status: **freigegeben** (AP00, 2026-11-01), Vertrag v1.1. Gegenüber v1
sparsamere Übertragung nach D59–D61. Grundlage: D06–D09, D24, D30, D31, D36,
D37, D56, D57, D59–D61 und die Qualitätsregeln des Produktplans.
Zuständig: AP03 (Onboard/Server), AP05 (Client), AP13 (Verdrahtung).
Referenzfälle: [`../fixtures/telemetry/cases.json`](../fixtures/telemetry/cases.json).

## 1. Ausgangslage (geprüft im Code)

- **Senden:** Onboard sendet `UpdateTelemetry(carId, name, value)` mit reinen
  Strings. Der Server leitet an die Gruppe `car:{carId}` weiter, prüft die
  Herkunft nicht und speichert nichts zwischen.
- **Empfangen:** Der Client stempelt `updatedAt` beim Empfang.
- **Protokolle:** Onboard ↔ Server verwendet MessagePack, der Webclient JSON.
  Telemetriekanäle haben eine numerische Server-ID (`CarTelemetry.Id`, im
  Channel-Map als `ServerId`), Steuerkanäle ebenso (`CarChannel.Id`).
- **Bedarf:** Onboard sendet heute alle konfigurierten Kanäle unabhängig vom
  Bedarf.
- **Reader:** `TelemetryReaderBase` kennt keine Qualität und kein Alter. CAN,
  LiDAR und BMS führen solche Informationen intern.
- **Steuerung:** Steuerwerte gehen per `UpdateChannel` an den Server. Den Fahrer
  prüft nur das Onboard anhand der `sessionId`.

## 2. Grundsätze der Übertragung (D59–D61)

1. **Nur bei Bedarf (D59):** Übertragen wird nur, was ein verbundener Client
   gerade braucht. Bedarf entsteht durch
   - die manuelle Telemetrieleiste,
   - ein aktives HUD,
   - die Editor-Vorschau,
   - einen Altclient (dieser gilt als „alle Kanäle“).

   Ohne Bedarf sendet das Onboard keine Telemetrie und der Fahrerclient keine
   Steuerungsanzeige.
2. **Nur Änderungen (D60):** Ein Wert wird vollständig nur gesendet, wenn sich
   Wert oder Zustand geändert hat, oder als Erstwert. Unveränderte Werte werden
   nur mit ihrer ID **bestätigt**; das aktualisiert ihr Messalter.
   - Bestätigungen höchstens alle 250 ms je Kanal.
   - Geänderte Werte gehen sofort mit dem nächsten Tick hinaus.
   - Die kürzeste zulässige HUD-Frist beträgt deshalb 500 ms (Schema).
3. **Kompakt (D61):**
   - numerische Kanal-IDs statt Namen,
   - positionsbasierte Arrays statt Objekten, kurze Methodennamen,
   - je Onboard-Tick genau eine Nachricht für alle Reader,
   - Kanalmetadaten (Name, Typ, Einheit, Intervall, LiDAR-Zonen) kommen einmalig
     per REST und nie im Datenstrom.

## 3. Qualitätsmodell je Wert

| Code | Zustand | Bedeutung |
| --- | --- | --- |
| 0 | `Valid` | Reader garantiert den Wert und kennt sein Messalter |
| 1 | `Unchecked` | ohne Qualitätsinformation (Alt-Onboard, Altpfad, Reader ohne Unterstützung) |
| 2 | `Stale` | Reader meldet selbst „zu alt“ (z. B. LiDAR-Stillstand); keine HUD-Frist heilt das |
| 3 | `Error` | Quellfehler |
| 4 | `NoData` | noch nie ein Wert |

- **Zeitbasis:** `ageMs` misst jeder Sender mit seiner monotonen Uhr; Uhrzeiten
  verschiedener Geräte werden nie verglichen. Beim Client gilt
  `age = ageMs(letzte Nachricht) + (clientNow − clientEmpfang)`. Die Netzlaufzeit
  ist nicht messbar und wird nicht addiert.
- **Erwartetes Intervall:** `100 ms · ReadIntervalTicks` des Kanals (Basistakt
  in `Onboard/Program.cs`). Es ist aus den Kanalmetadaten bekannt und wird nicht
  übertragen.
- **Frist:** `sources.telemetry[k].staleAfterMs` (≥ 500) oder
  `max(3 · erwartetes Intervall, 1000)` (D24).

**Bewertung im Client:**

| Bedingung | Ergebnis |
| --- | --- |
| `Valid` und `age ≤ frist` | `valid` |
| `Unchecked` und `age ≤ frist` | `unchecked` |
| `Stale`, `Error` oder `NoData` | `invalid` |
| `age > frist` | `invalid` |
| keine Hub-Verbindung | `invalid` |
| Fahrzeug offline | `invalid` |
| leerer oder nicht parsbarer Wert | `invalid` |

Gründe: `source-error`, `stale`, `no-data`, `transport`, `vehicle-offline`,
`parse`, `waiting` (angefordert, noch kein Wert).

## 4. Onboard (AP03)

- Neue virtuelle Methode `TelemetryReaderBase.ReadAllSamplesAsync(channelKey)`.
  Sie liefert je Wert `(value, state, ageMs)`. Die Standardimplementierung
  verpackt `ReadAllTelemetryAsync` mit `Unchecked`/0. Die Abbildung der
  Qualitätsquellen je Reader ist dieselbe wie in v1:
  - CAN-Knoten- und Steueralter,
  - LiDAR `ScanAgeSeconds`/`Spinning`,
  - BMS `FetchedAtUtc`,
  - direkt lesende Reader `Valid`.
- Readers ohne Bedarf werden weiterhin gelesen, wenn andere Onboard-Funktionen
  sie brauchen. Ihre Werte werden nur nicht gesendet.
- Das Onboard merkt sich je Kanal den zuletzt **gesendeten** `(value, state)`
  und den Zeitpunkt der letzten Bestätigung.
- **Bedarf:** Der Server sendet `SetTelemetryDemand(int[] channelIds)` (leere
  Liste = nichts). Das Onboard sendet nur diese Kanäle. Neu angeforderte
  Kanäle gehen beim nächsten Lesen vollständig hinaus. Bis zum ersten
  `SetTelemetryDemand` nach einer (Wieder-)Verbindung sendet das Onboard nichts.
- **Je Tick eine Nachricht** `TelemetryDelta` (MessagePack, `[Key]`-indiziert,
  Wire-DTO in `Shared/Telemetry/`):

  ```
  TelemetryDelta {
    [0] epoch: string        // je Prozessstart zufällig
    [1] seq: long            // streng steigend je Epoche
    [2] ageMs: int           // Standardalter: häufigstes Alter des Ticks, bei Gleichstand das kleinste
    [3] changed: [id, value, state, ageMs?][]   // ageMs nur wenn ≠ [2]
    [4] touched: int[]                           // unverändert, Alter = [2]
    [5] touchedAged: int[]                       // flache Paare id, ageMs
  }
  ```

  Ohne Inhalt (alles leer) wird nichts gesendet.
- Vollständig gesendet wird ein Wert
  - beim ersten Lesen nach Prozessstart oder Wiederverbindung,
  - wenn er neu angefordert ist,
  - wenn sich Wert oder Zustand geändert haben.

  Sonst wird er bestätigt, sofern die letzte Bestätigung oder Sendung
  ≥ 250 ms zurückliegt. Liefert ein Reader in einem Tick keinen Wert, wird
  nichts gesendet; das Alter wächst weiter.
- Nach einer Wiederverbindung gilt eine neue Basis: Alle angeforderten Werte
  werden erneut vollständig gesendet.
- Präzisierungen aus der Umsetzung (AP03):
  - Das Standardalter wird nur über die tatsächlich gesendeten Einträge
    bestimmt.
  - Fällt ein Kanal aus dem Bedarf, wird sein Sendestand vergessen; bei
    erneutem Bedarf geht er vollständig hinaus.
  - Einträge sind nach Kanal-ID sortiert. `seq` steigt nur, wenn eine Nachricht
    entsteht, und bleibt über Wiederverbindungen innerhalb einer Epoche
    steigend.
  - Ein fehlgeschlagener Versand setzt den Sendestand zurück.
  - Qualität je Reader:
    - CAN-Knotenwerte: Alter des Knotens; Stale nach `NodeTimeoutMs`, Error
      bei Bus-off, NoData vor dem ersten Kontakt.
    - Odometrie: der schlechtere der beiden Knoten, NoData solange
      unkalibriert.
    - Befehls- und Diagnosewerte des Managers: Valid mit Alter 0.
    - LiDAR: Alter aus `ScanAgeSeconds`; Error bei geschlossenem Port oder
      `Problem`, NoData ohne Scan, Stale ohne Rotation; Pico-Werte Unchecked.
    - BMS: Alter aus dem Abrufzeitpunkt; bei Lesefehler die alten Werte als
      Error.
    - CPU-Temperatur und Laufzeit: Valid. Store-basierte Reader: Unchecked.
- Es gibt keinen Rückfall auf den Altpfad: Ohne Bedarfsmeldung vom Server
  sendet ein neues Onboard keine Telemetrie. Rollout-Reihenfolge: erst Server,
  dann Fahrzeug (D68).

## 5. Server (AP03)

- **Herkunft (D56):** Bei `TelemetryDelta` ergibt sich die `carId` aus der
  aufrufenden, per `OpenCarConnection` registrierten Verbindung. Beim Altpfad
  `UpdateTelemetry(carId, …)` muss die `carId` zu dieser Verbindung passen.
  Sonst wird verworfen und ratenbegrenzt protokolliert.
- **Altpfad-Werte:** `Unchecked`, Alter 0. Der Server wendet darauf dieselbe
  Änderungs- und Bestätigungslogik an wie das Onboard.
- **Cache je Fahrzeug:** letzter `(value, state)` je Kanal-ID, Alter und
  Server-Empfangszeit (monoton). Er wird bei neuer Epoche und beim
  Onboard-Disconnect geleert. Batches mit `seq ≤` letzter `seq` derselben
  Epoche werden verworfen.
- **Bedarf:** Je Client-Verbindung hält der Server eine Interessenmenge. Der
  Bedarf an das Onboard ist die Vereinigung aller Interessen dieses Fahrzeugs;
  Altclients zählen als „alle Kanäle“. Der Server sendet
  `SetTelemetryDemand` nach `OpenCarConnection` und bei jeder Änderung der
  Vereinigung, höchstens alle 200 ms (zusammengefasst).
- **An Clients**, je Verbindung gefiltert auf ihr Interesse. Pro empfangenem
  `TelemetryDelta` geht höchstens eine Nachricht:

  ```
  Tlm(carId, seq, ageMs, changed, touched, touchedAged)
  ```

  - `changed`-Einträge: `[id, value]` (`Valid`, Standardalter),
    `[id, value, state]` oder `[id, value, state, ageMs]`.
  - `seq` vergibt der Server streng steigend je Fahrzeug.
  - `ageMs` wird um die Verweildauer fortgeschrieben (praktisch 0).
  - Leere Nachrichten werden nicht gesendet.
- **Interesse setzen:** `SetTelemetryInterest(carId, int[] channelIds)` ersetzt
  die Menge dieser Verbindung. Der Server antwortet sofort mit einem `Tlm`, das
  alle neu hinzugekommenen IDs aus dem Cache enthält, als `changed` mit eigenem
  Alter. Fehlt ein Wert im Cache, wird er nicht gesendet; er kommt mit dem
  nächsten Onboard-Tick.
- **Altclients:** Gruppe `telemetry-legacy:{carId}`. Beitritt über den
  bestehenden `SubscribeToCarTelemetry`, der zusätzlich `car:{carId}` beitritt.
  Sie erhalten wie bisher `UpdateTelemetry(name, value)`, aber nur bei
  geänderten Werten; `NoData` wird nicht gesendet. Der Server sendet
  `UpdateTelemetry` nicht mehr an `car:{carId}`.
- **Leseberechtigung:** über `CanViewCarAsync(carId)` (API-Vertrag). Heute prüft
  das Ansehen eines Streams nichts; jeder Client darf sehen.

## 6. Client (AP05)

- Ein gemeinsamer, typisierter Bestand je Fahrzeug, unabhängig vom Mounten der
  Telemetrieleiste. Verbraucher melden Bedarf mit Referenzzählung an; die
  Vereinigung geht als `SetTelemetryInterest` an den Server, zusammengefasst
  höchstens alle 200 ms.
- Die manuelle Leiste zeigt weiterhin nur die persönlich gewählten Kanäle; deren
  Speicherung (`SubscribeToChannel`) bleibt unverändert.
- Kanalmetadaten kommen aus `/api/car/{id}/telemetry`, erweitert um `id`,
  `dataType`, `unit`, `decimals`, `readIntervalTicks` und bei LiDAR um die
  Zonengrenzen. Bei unbekannter Kanal-ID werden die Metadaten einmal neu
  geladen.
- Eine Bestätigung setzt nur Alter und Empfangszeit; Wert und Zustand bleiben.
- Nach Reconnect: Interesse erneut setzen; der Snapshot ersetzt den Bestand.
  Bis dahin ist alles `invalid` (`transport`). Nachrichten mit kleinerer `seq`
  werden verworfen.

## 7. Steuerungsanzeige: Ausgänge und Flow-Signale (D07–D09, D30, D31, D37, D57)

**Bedarf:**

- Clients, deren HUD `out()`/`sig()` verwendet, setzen
  `SetControlDisplayInterest(carId, bool)`.
- Der Server meldet dem Fahrerclient `CtlDemand(carId, bool)`: wahr, sobald
  irgendeine andere Verbindung Interesse hat. Nur dann sendet der Fahrerclient.

**Fahrerclient → Server:**

```
Ctl(carId, seq, paused, outputs, signals, removedOutputs, removedSignals)
```

- `outputs`: `[[CarChannel.Id, value]]`; `signals`: `[[name, value]]`.
- Werte sind auf 6 signifikante Stellen gerundet.
- `removed…`: nicht mehr verfügbare Ausgänge/Signale, z. B. ein entfernter
  HUD-Signal-Knoten.
- Vollständig nach `CtlDemand(true)` und nach Reconnect, danach nur
  Änderungen. Höchstens alle 100 ms.
- Ohne Änderung genügt spätestens nach 1 s eine leere Nachricht (Keepalive mit
  aktuellem `paused`). Eine Änderung von `paused` wird sofort gesendet.
- `paused = !updatesEnabled || isInConfigMode`.
- Das Lesen löst keine Flow-Neuberechnung, kein `sendOutput` und keine
  Reaktivierung aus (D09).

**Server-Prüfung (D57):**

- `AquireCarControl` merkt sich bei Erfolg in `CarConnectionInfo` die
  `DriverConnectionId` und eine neue `DriverEpoch`.
- `Ctl` wird nur von dieser Verbindung und mit steigender `seq` angenommen.
  Sonst wird verworfen und ratenbegrenzt protokolliert. Die Nachricht erreicht
  nie das Onboard.
- `ReleaseCarControl`, ein Disconnect der Fahrerverbindung oder ein neuer
  Erwerb lösen Folgendes aus:
  - den Cache leeren,
  - `CtlCleared(carId, driverEpoch)` an Interessenten senden.

**Server → Clients mit Interesse:**

```
Ctl(carId, driverEpoch, seq, paused, ageMs, outputs, signals, removedOutputs, removedSignals)
```

- Die Nachricht wird 1:1 weitergereicht, Keepalives eingeschlossen.
- Beim Setzen des Interesses folgt sofort ein vollständiger Snapshot aus dem
  Cache.

**Bewertung im Client:**

| Fall | Ergebnis |
| --- | --- |
| Wert vorhanden, letzte Nachricht ≤ 1000 ms alt | `valid`, `paused` laut letzter Nachricht |
| nie gesendet oder entfernt | `invalid` |
| Nachricht älter als 1000 ms | `invalid` |
| `CtlCleared` | `invalid` |
| andere `driverEpoch` | `invalid` |
| keine Verbindung | `invalid` |
| `driverActive()` | `valid`; wahr, wenn `CarStateModel.DriverId` gesetzt ist |

Der Fahrerclient verwendet seine lokalen Werte direkt, mit demselben
`paused`-Kennzeichen. Die automatische Reaktivierung in `setConfigMode(false)`
ändert AP13 für den Overlay-Editor (Produktplan, API-Vertrag §6).

## 8. Erwartete Datenmengen (gemessen mit Beispielnachrichten, JSON zum Client)

| Strom | Szenario | Rate |
| --- | --- | --- |
| Telemetrie, 12 Antriebswerte bei 10 Hz | 4 ändern sich je Tick | ≈ 1,5 kB/s |
| | alle ändern sich | ≈ 2,3 kB/s |
| | nichts ändert sich (Bestätigung alle 250 ms) | ≈ 0,4 kB/s |
| LiDAR (Vertrag LiDAR §5) | Fahrt, ca. 60 belegte Felder | ≈ 2 kB/s |
| | Stillstand (nur Bestätigung) | ≈ 0,3 kB/s |
| Steuerungsanzeige | Lenken, 3 Werte ändern sich | ≈ 1,1 kB/s |
| | Keepalive | ≈ 0,07 kB/s |
| Ohne Bedarf | – | 0 |

Typischer Zuschauer mit vollem Referenz-HUD bei Fahrt: etwa 4–5 kB/s, vorher
rund 23 kB/s. Der Uplink des Fahrzeugs (MessagePack) liegt darunter.
