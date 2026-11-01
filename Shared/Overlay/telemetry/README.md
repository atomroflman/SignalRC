# Overlay-Quellen v1: Telemetriequalität und Steuerungsanzeige

Status: **freigegeben** (AP00, 2026-11-01), Vertrag v1. Grundlage: D06–D09,
D24, D30, D31, D36, D37, D56, D57 und die Qualitätsregeln des Produktplans.
Zuständig: AP03 (Onboard/Server), AP05 (Client), AP13 (Verdrahtung).

## 1. Ausgangslage (geprüft im Code)

- **Senden:** Onboard sendet `UpdateTelemetry(carId, name, value)` mit reinen Strings an
  `CarConnectionHub`. Der Server leitet an die Gruppe `car:{carId}` weiter,
  prüft die Herkunft nicht und speichert nichts zwischen.
- **Empfangen:** Der Client stempelt `updatedAt` beim Empfang.
- **Reader:** `TelemetryReaderBase` kennt keine Qualität und kein Alter. CAN
  (`TrackNodeState.AgeSeconds`, `ControlAgeSeconds`), LiDAR
  (`LidarHealth.ScanAgeSeconds`, `Spinning`) und JBD-BMS (Cache `FetchedAtUtc`)
  führen solche Informationen intern.
- **Steuerung:** Steuerwerte gehen per `UpdateChannel(carId, sessionId, channelId,
  value)` an den Server. Den Fahrer prüft nur das Onboard anhand der `sessionId`.

## 2. Qualitätsmodell je Wert

```
TelemetrySample {
  channel: string            // CarTelemetry.ChannelName
  value: string              // invariant formatiert wie bisher; "" bei fehlendem Wert erlaubt
  state: Valid | Unchecked | Stale | Error | NoData
  ageMs: int                 // Messalter beim Absenden durch den jeweiligen Sender
  expectedIntervalMs: int    // erwartetes Leseintervall der Quelle
}
```

- `Valid`: Der Reader garantiert den Wert und kennt sein Messalter.
- `Unchecked`: Der Reader liefert keine Qualitätsinformation, etwa ein
  Alt-Onboard, ein Altpfad oder ein Reader ohne Unterstützung.
- `Stale`: Der Reader meldet selbst, dass der Wert zu alt ist, z. B. bei
  LiDAR-Stillstand. Eine HUD-Frist kann das nicht heilen.
- `Error`: Quellfehler, z. B. ein geschlossener Port oder ein Bus-off.
- `NoData`: Es gab noch nie einen Wert.

**Zeitbasis:** `ageMs` misst jeder Sender mit seiner monotonen Uhr. Es werden keine
Uhrzeiten zwischen Geräten verglichen. Das Messalter beim Client ist:

```
age = ageMs(Server-Weitergabe) + (clientNow − clientEmpfang)
```

Dabei gilt `ageMs(Server-Weitergabe) = ageMs(Onboard) + Verweildauer im Server-Cache`.
Die Netzlaufzeit selbst ist nicht messbar und wird nicht addiert. Das ist eine
bewusste Grenze; im ersten Umfang gibt es keine Videosynchronisierung.

**Bewertung im Client** (Abbildung auf den Ausdruckszustand):

| Bedingung | Zustand |
| --- | --- |
| `Valid` und `age ≤ frist` | `valid` |
| `Unchecked` und `age ≤ frist` | `unchecked` |
| `Stale`, `Error`, `NoData` | `invalid` |
| `age > frist` | `invalid` |
| keine Hub-Verbindung | `invalid` |
| Fahrzeug offline (`CarStateUpdated.IsConnected == false`) | `invalid` |
| leerer Wert oder nicht parsbar | `invalid` |

Die Frist ist die HUD-Überschreibung (`sources.telemetry[k].staleAfterMs`) oder
sonst `max(3 · expectedIntervalMs, 1000)` (D24).

Für ungültige Werte wird ein Grund geführt (`source-error`, `stale`, `no-data`,
`transport`, `vehicle-offline`, `parse`). Er erscheint in Editor-Diagnosen und
in der Werte-Inspektion, nicht im Fahrer-HUD.

## 3. Onboard (AP03)

- `TelemetryReaderBase` erhält eine virtuelle Methode
  `ReadAllSamplesAsync(channelKey) → IReadOnlyDictionary<string, TelemetrySample>?`.
  Ihre Standardimplementierung verpackt `ReadAllTelemetryAsync` mit
  `state = Unchecked`, `ageMs = 0`.
- Reader mit Qualitätsunterstützung überschreiben sie:
  - CAN: Knotenwerte aus `AgeSeconds`/`Seen`, Steuerwerte aus `ControlAgeSeconds`,
    Odometrie unkalibriert = `NoData`, Bus-off = `Error`.
  - LiDAR: `ScanAgeSeconds`; `Spinning == false` = `Stale`; Port zu = `Error`.
  - JBD-BMS: Alter aus `FetchedAtUtc`, Lesefehler = `Error`.
  - Direkt lesende Reader wie CPU-Temperatur: `Valid`, Alter ab Lesezeitpunkt.
- `expectedIntervalMs = 100 · ReadIntervalTicks` (Basistakt in `Onboard/Program.cs`),
  sofern der Reader keinen eigenen Wert angibt.
- Neuer Hub-Aufruf `UpdateTelemetrySamples(TelemetryBatch)`:

  ```
  TelemetryBatch { epoch: string, seq: long, samples: TelemetrySample[] }
  ```

  Ein Batch entspricht einem Reader-Tick. `epoch` wird je Onboard-Prozessstart
  zufällig erzeugt; `seq` steigt innerhalb einer Epoche streng.
- Ein neues Onboard ruft nur noch `UpdateTelemetrySamples` auf. `UpdateTelemetry`
  bleibt am Server für Alt-Onboards erhalten.

## 4. Server (AP03)

- **Herkunft (D56):** Die `carId` ergibt sich bei `UpdateTelemetrySamples` aus
  `CarConnectionStore` über die aufrufende Verbindung; einen Parameter `carId`
  gibt es nicht. Beim Altpfad muss die übergebene `carId` zur registrierten
  Onboard-Verbindung passen. Sonst wird der Aufruf verworfen und
  ratenbegrenzt protokolliert.
- **Altpfad-Werte** werden zu `state = Unchecked`, `ageMs = 0`, mit
  `expectedIntervalMs` aus `CarTelemetry.ReadIntervalTicks · 100`.
- **Cache:** Je Fahrzeug und Kanal hält der Server im Speicher das letzte
  Sample, Epoche/Seq und seine Server-Empfangszeit (monoton). Er verwirft
  Batches mit `seq ≤ letzter seq` derselben Epoche; eine neue Epoche ersetzt die
  alte. Beim Onboard-Disconnect wird der Cache des Fahrzeugs geleert.
- **Gruppen:**
  - `telemetry:{carId}` erhält neue Batches. Clients treten über
    `SubscribeToCarTelemetrySamples(carId)` bei; das liefert sofort einen
    Snapshot aus dem Cache mit fortgeschriebenem `ageMs`.
  - `telemetry-legacy:{carId}` erhält wie bisher `UpdateTelemetry(name, value)`.
    Der bestehende `SubscribeToCarTelemetry` tritt dieser Gruppe zusätzlich zu
    `car:{carId}` bei. Der Server sendet `UpdateTelemetry` nicht mehr an
    `car:{carId}`.
  - Für Altclients übersetzt der Server neue Samples: Wert unverändert; `NoData`
    wird nicht gesendet.
- **Leseberechtigung:** Die Abonnements verwenden dieselbe Prüfung wie das Ansehen
  des Fahrzeugstreams. Heute prüfen weder `GetVideoStreamsForCar` noch
  `SubscribeToCarTelemetry` etwas, jeder Client darf sehen. Alle Overlay-
  Lesezugriffe (Telemetrie-Samples, Steuerungsanzeige, Veröffentlichung, Assets)
  laufen über einen gemeinsamen Helfer `CanViewCarAsync(carId)`, der diese
  Regel zentral abbildet (siehe API-Vertrag). Eine spätere Verschärfung wirkt
  dann überall gleich.
- **Client-Nachricht:**

  ```
  UpdateTelemetrySamples(ClientTelemetryBatch { carId, epoch, seq, samples })
  ```

  Die `ageMs` darin sind bereits fortgeschrieben.

## 5. Client (AP05)

- Ein gemeinsamer, typisierter Bestand je Fahrzeug, unabhängig vom Mounten der
  Telemetrieleiste. Verbraucher melden Kanalbedarf mit Referenzzählung an; die
  manuelle Leiste zeigt weiterhin nur die persönlich gewählten Kanäle.
- Nach Reconnect: erneut abonnieren und den Snapshot übernehmen. Bis dahin sind
  alle Werte `invalid` (`transport`).
- Batches mit kleinerer `seq` derselben Epoche werden verworfen.
- Kanalmetadaten (`dataType`, `unit`, `decimals`, `readIntervalTicks`) kommen aus
  `/api/car/{id}/telemetry`. Das TS-Interface wird um diese Felder erweitert.

## 6. Steuerungsanzeige: Ausgänge und Flow-Signale (D07–D09, D30, D31, D37)

**Fahrerclient → Server:**

```
PublishControlDisplay(carId: int, ControlDisplayBatch {
  sessionId: string,           // Steuerungssitzung aus AquireCarControl
  seq: long,
  paused: bool,                // !updatesEnabled || isInConfigMode
  outputs: { [channelName]: number },   // berechnete Werte der Output-Knoten (CarChannel.ChannelName)
  signals: { [signalName]: number }     // Werte der HUD-Signal-Knoten (D37)
})
```

- Gesendet wird bei Änderung, höchstens alle 100 ms, sonst als Keepalive
  spätestens nach 1 s. Das gilt auch während der Pause. Werte im Batch sind der
  jeweils vollständige aktuelle Stand, keine Deltas.
- Das Lesen löst keine Flow-Neuberechnung, kein `sendOutput` und kein
  Aufheben der Pause aus (D09). Der Client liest den vorhandenen Store-Zustand.

**Server-Prüfung (D57):**

- `AquireCarControl` merkt sich bei Erfolg in `CarConnectionInfo` die
  `DriverConnectionId`, die erteilte `SessionId` und eine neue `DriverEpoch`.
- `PublishControlDisplay` wird nur angenommen, wenn alle drei Bedingungen gelten:
  - die Verbindung ist `DriverConnectionId`,
  - `sessionId` stimmt mit der erteilten Sitzung überein,
  - `seq` steigt.

  Sonst wird verworfen und ratenbegrenzt protokolliert. Die Nachricht ist kein
  Steuerbefehl und erreicht das Onboard nicht.
- `ReleaseCarControl`, Disconnect der Fahrerverbindung oder ein neuer Erwerb
  lösen Folgendes aus:
  - den Cache leeren,
  - `ControlDisplayCleared(carId, driverEpoch)` an die Gruppe senden.

**Server → Clients:**

- Gruppe `control-display:{carId}`, Beitritt mit `SubscribeToControlDisplay(carId)`;
  Leseberechtigung wie in §4. Beim Beitritt kommt ein Snapshot.
- Nachricht:

  ```
  UpdateControlDisplay({ carId, driverEpoch, seq, paused, ageMs, outputs, signals })
  ```

**Bewertung im Client:**

| Quelle | Zustand |
| --- | --- |
| `out(k)` / `sig(k)` vorhanden, Alter ≤ 1000 ms | `valid`, `paused` laut Nachricht |
| Schlüssel fehlt (Ausgang/Signal beim Fahrer nicht zugeordnet) | `invalid` |
| Alter > 1000 ms, `ControlDisplayCleared`, andere `driverEpoch`, keine Verbindung | `invalid` |
| `driverActive()` | `valid`; wahr, wenn `CarStateModel.DriverId` gesetzt ist |

Der Fahrerclient selbst verwendet seine lokalen Werte direkt, mit demselben
`paused`-Kennzeichen. Er wartet nicht auf den Rundweg über den Server.

Der Fahrerclient ermittelt `paused` aus `updatesEnabled`/`isInConfigMode`
(`control-flow-store.ts`). Die heutige automatische Reaktivierung in
`setConfigMode(false)` ändert AP13 für den Overlay-Editor (Produktplan).
