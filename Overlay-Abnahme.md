# Fahrzeug-Overlay: Abnahmebericht (AP14)

Stand: 2026-11-02, Branch `feature/overlay-ap14` auf dem Integrationsstand
AP01–AP13 (`80b6b22`).

Dieser Bericht hält fest, welche Produktregeln aus
[Overlay-Feature.md](Overlay-Feature.md) und welche Abnahmekriterien aus
[Overlay-Arbeitspakete.md](Overlay-Arbeitspakete.md) automatisiert geprüft
sind. Er nennt außerdem, was manuell oder auf Hardware offen bleibt.

Vorgabe des Auftraggebers für AP14: **keine Browser-Automatisierung**.
Playwright, jsdom oder ein Browser werden nicht installiert. Damit weicht AP14
bewusst von D42/D65 ab, die Playwright vorsahen. Alles, was einen Browser
braucht, steht als manuelle Checkliste in §6.

## 1. Statusbegriffe

| Status | Bedeutung |
| --- | --- |
| **automatisiert** | Ein Test im Standardlauf (`scripts/overlay-check.sh`) prüft die Regel. |
| **automatisiert (PG)** | Wie oben; zusätzlich läuft der Test gegen PostgreSQL, wenn `SIGNALRC_TEST_POSTGRES` gesetzt ist. |
| **live** | Live-Test über echtes HTTP/SignalR gegen einen lokalen Server (opt-in über `SIGNALRC_LIVE_URL` + `SIGNALRC_TEST_POSTGRES`); am 2026-11-02 bestanden (§5.1). |
| **manuell offen** | Braucht einen Browser oder ein Gerät; steht in der Checkliste (§6). |
| **Hardware offen** | Nur mit Fahrzeug oder Sensor möglich; nach gesonderter Vereinbarung. |
| **nicht erfüllt** | Abweichung, siehe Befunde (§7). |

## 2. Prüfumfang und Ergebnisse

Einstieg: `scripts/overlay-check.sh`.

- Das Skript führt der Reihe nach aus:
  - `tsc --noEmit`,
  - die Builds von Server und Onboard (Release),
  - `dotnet test Tests/SignalRC.Overlay.Tests`,
  - `vitest run`.
- Live-Tests laufen nur, wenn beide Variablen gesetzt sind.
- Mit `--start-server` startet das Skript selbst einen Server auf einem freien
  lokalen Port gegen `SIGNALRC_TEST_POSTGRES` und stoppt ihn danach wieder.
- `--perf` (oder `SIGNALRC_PERF=1`) schaltet die langen Leistungsläufe ein.
- Zugangsdaten stehen nicht im Repository.
- `.github/workflows/overlay-check.yml` führt dasselbe Skript in GitHub Actions
  aus, ohne Datenbank und ohne Live-Tests. Der Workflow ist nur angelegt, nicht
  gepusht.

| Lauf | Ergebnis |
| --- | --- |
| tsc | 0 Fehler |
| Vitest | 727 grün, 15 übersprungen (opt-in Live-Tests), 55 Dateien |
| xUnit mit PostgreSQL-Testdatenbank | 625 grün, 3 übersprungen (SQLite ohne Nebenläufigkeit) |
| Build Server/Onboard (Release) | 0 Fehler; Warnungen siehe §7 (NuGet) |
| Testdatenbank nach den Läufen | keine getaggten Fahrzeuge, Benutzer oder Assets übrig |

### Neue übergreifende Tests (AP14)

| Datei | Inhalt |
| --- | --- |
| `Client/src/components/overlay/acceptance/helpers.ts` | `World`: In-Memory-Server mit Asset-Menge je Veröffentlichung, Editor-Tabs (Store + SaveController), Betrachter über `PublishedOverlay` auf trennbarem Fake-Hub |
| `acceptance/scenarios.test.ts` | zwei Tabs, Kontrollwechsel, lokale Wiederherstellung, Veröffentlichen/Restore, historische Assets, Reconnect, fehlerhafte Konfiguration, Schemaversion |
| `acceptance/scenarios-sources.test.ts` | Telemetriequalität von Tlm über AP05 bis AP08 (gültig, ungeprüft/D71, alt, Sensorfehler, nie gemessen, Transportausfall) |
| `acceptance/simulation.test.ts` | Simulation über Editor, Vorschau, Livebestand und zweiten HUD-Verbraucher |
| `acceptance/security-expressions.{json,test.ts}` | Missbrauchskorpus mit 74 Formeln; Client und Server lesen dieselbe Datei |
| `acceptance/security-import.test.ts` | feindliche Austauschpakete |
| `acceptance/reference-huds.ts`, `performance.test.ts` | R1–R3, Frame-Kosten, Heap, Pause |
| `acceptance/live-acceptance.test.ts` | opt-in Live-Szenarien über HTTP/SignalR (§5.1) |
| `Tests/…/Acceptance/SecurityExpressionTests.cs` | Server-Analyse gegen denselben Korpus |
| `Tests/…/Acceptance/SecurityServiceTests.cs` | Berechtigungsmatrix, Betrachter, fremde Referenzen, Formeln beim Veröffentlichen, SVG-Upload, Controller mit Sitzungscookie, Asset-Header (SQLite + PG) |
| `Tests/…/Acceptance/SecurityHubOriginTests.cs` | echte Hub-Methoden: Herkunft D56/D57, Interessen D70 |
| `Tests/…/Acceptance/BandwidthTests.cs` | Bytes je Zuschauer und Uplink mit echten Onboard-/Relay-Bausteinen |

## 3. Produktregeln (Overlay-Feature.md)

### 3.1 Konfiguration, Varianten, Berechtigung

| Regel | Status | Nachweis |
| --- | --- | --- |
| Standard/Varianten, Vererbung, Rücksetzen, stabile IDs, Löschfolgen, deaktivierte Variante = kein HUD | automatisiert | AP01 `document/*.test.ts`, `Documents/*Tests.cs` (gleiche Fixtures); Editor `editor/core` |
| Nur der Sitzungsbenutzer, der die Steuerung hält, verwaltet (D73); Prüfung bei jedem Zugriff | automatisiert (PG) / live | `SecurityServiceTests.EveryManagementOperationRequiresTheSessionUserHoldingControl`: alle 10 Verwaltungsoperationen × ohne Sitzung (401 `OVL_API_SESSION_REQUIRED`) / veraltetes `ActiveVehicleId` / Login ohne Setup / Login mit Setup ohne Steuerung / Fahrer eines anderen Fahrzeugs (je 403 `OVL_API_NOT_DRIVER`) / anonymer Fahrer (erlaubt); abgelehnte Schreibzugriffe ändern nichts. `OverlayServiceTests.AnonymousSessionUserWithControlSavesAndPublishesUntilRelease`: speichern/veröffentlichen, anderer Benutzer nicht, nach Release, Übernahme und Onboard-Trennung nicht mehr. `ControllerAppliesTheMatrixFromTheSessionCookie`: 401/403/428, gefälschtes Cookie 401. Live: `editor-live-server.test.ts` (anonymer Fahrer über Fake-Onboard veröffentlicht, zweiter anonymer Benutzer 403, nach `ReleaseCarControl` 403) |
| Veröffentlichtes HUD lesbar wie der Videostream, auch anonym (D69/D70); Asset nur bei Veröffentlichung | automatisiert (PG) | `ViewersReadOnlyPublishedStateAssetsAndTheSourceCatalog`; Client-Sicht in `scenarios.test.ts` |
| Kontrollverlust: lokal weiter, keine Serverzugriffe; nach Rückkehr Revisionsprüfung | automatisiert | `scenarios` › „losing control mid-edit …“; `editor/persistence/autosave.test.ts` |
| Genau ein Entwurf, Autosave, Statusanzeige | automatisiert | `autosave.test.ts`; `OverlayServiceTests` |
| Konflikt: Server hat Vorrang, kein Überschreiben, Sicherung als Download, auch bei zwei Tabs desselben Fahrers | automatisiert | `scenarios` › „tab B goes into conflict …“ (Download → Import als Entwurf in einem Undo-Schritt) |
| Lokale Wiederherstellung nur bei unveränderter Basisrevision; Sicherungen nicht still verworfen (D72) | automatisiert | `scenarios` › „local restore after reload“; `autosave.test.ts` (Rotation) |
| Undo/Redo trotz Autosave | automatisiert | `editor/core` (200 Schritte, Transaktionen) |
| Veröffentlichung unveränderlich; Restore nur als Entwurf; historische Assets bleiben | automatisiert (PG) | `OverlayServiceTests` (Revisionen, Asset-Aufräumen); `scenarios` › „a published state reaches an open viewer as a whole …“ |
| Veröffentlichungsprüfung: aktive Teile streng, deaktivierte mit Warnung, Struktur/Limits immer | automatisiert (PG) | `AbusiveFormulasBlockPublishingOnlyInActiveParts`, `FormulaLimitsApplyEvenToDisabledPartsAndBlockSaving`; AP01/AP02-Tests |
| Kanaländerung: Abhängigkeitswarnung, historische Stände unberührt | automatisiert | `OverlayServiceTests` (dependencies); UI-Einbindung manuell (§6) |
| Dieselben Regeln über echtes HTTP/SignalR | live | `live-acceptance.test.ts` (Berechtigungen, zwei Tabs) |

### 3.2 Darstellung und Laufzeit

| Regel | Status | Nachweis |
| --- | --- | --- |
| Einpassen in den tatsächlichen Videoframe, Letterbox frei, Resize/Seitenverhältnis | automatisiert (Rechnung) / manuell offen (Browser) | `integration/video-frame.test.ts`; Browser: §6 Nr. 1–3 |
| Persönliches Ausblenden je Fahrzeug, unabhängiger Stream-Status | automatisiert (Logik) / manuell offen | `integration/integration-ui.test.ts`; §6 Nr. 4 |
| Neue Veröffentlichung ohne Video-Neuverbindung, konsistenter Gesamtstand | automatisiert | `scenarios` (kein Mischstand aus Dokument und Assets); `published-overlay.test.ts`; Video selbst: §6 Nr. 5 |
| Reconnect gleicht verpasste Veröffentlichung ab | automatisiert / live | `scenarios` › „missed publication during a SignalR outage …“; live: `live-acceptance` |
| Unbrauchbare Konfiguration wird nicht aktiviert; bisheriger Stand läuft weiter; ohne Stand kein HUD | automatisiert | `scenarios` › „an unusable newer publication …“ (unbekanntes Schema, Zyklus, fehlendes Asset) |
| Unbekannte Schemaversion wird nicht interpretiert und nicht gespeichert | automatisiert | `scenarios` › „the editor does not save … unknown schema version“; `SchemaTests` |
| Formeltypen, Einheiten, nicht endliche Ergebnisse, Client = Server | automatisiert | AP06 (400 000 Vergleiche); `security-expressions` (Korpus mit gleichen Diagnosen auf beiden Seiten) |
| Raten, Glättung, Winkel-Wrap, Clips, Impulse, Scrubbing, Neustart ohne Nachholen | automatisiert | AP08 `runtime-fixtures.test.ts`; Pause/Neustart: `performance.test.ts` › „paused session“ |
| Keine unsichtbaren Daueranimationen (verborgener Tab, ausgeblendetes HUD) | automatisiert (Controller) / manuell offen (Browser) | `performance.test.ts`: 0 Frames, 0 DOM-Schreibvorgänge, Bedarf freigegeben; Browser: §6 Nr. 12 |
| HUD-Fehler beeinträchtigen Video und Steuerung nicht | teilweise automatisiert / manuell offen | Fehler bleiben je Element eingegrenzt (AP08-Tests); Video und Steuerung: §6 Nr. 5, 9 |

### 3.3 Telemetrie und Simulation

| Regel | Status | Nachweis |
| --- | --- | --- |
| Gemeinsamer Bestand; HUD-Bedarf ändert persönliche Auswahl nicht; Verbraucher unabhängig | automatisiert | `scenarios-sources` › „valid values drive …“; AP05 `provider.test.ts` |
| Alte, erneut gesendete Messwerte werden nicht frisch; Quellfehler nicht durch Frist heilbar | automatisiert | `scenarios-sources` › „re-sent old measurements …“ |
| Ungeprüfte Quelle (Alt-Onboard): Werte und direkte Bindungen mit Warndreieck, Raten und Clips stehen (D71) | automatisiert | `scenarios-sources` › „Alt-Onboard (unchecked) …“ |
| Keine erfundene Null ohne gültige Messung | automatisiert | `scenarios-sources` › „a never measured value …“ |
| Transportausfall unterscheidbar, Reconnect ohne Nachholen | automatisiert | `scenarios-sources` › „transport loss …“ |
| Simulation nur lokal: kein Bedarf, keine Schreibaufrufe, keine Präferenzänderung, keine Fahrzeugbefehle, nicht im Livebestand | automatisiert | `simulation.test.ts`: Editor mit Autosave, Vorschau, echter AP05-Bestand, zweiter Live-Verbraucher, pausierter Flow-Store; nur lesende Hub-Aufrufe, 0 Steueraufrufe, 0 Persistenzaufrufe; `preview/safety.test.ts` |
| Editor pausiert Steuerung, bewusste Freigabe, keine automatische Reaktivierung, Tastaturtrennung | automatisiert (Logik) / manuell offen | `integration/editor-control.test.ts`; `simulation.test.ts`; Browser: §6 Nr. 9 |
| Steuerungsanzeige nur von der Verbindung mit Kontrolle (D57), Resume nach Reconnect | automatisiert / live | `SecurityHubOriginTests.OnlyTheConnectionThatAcquiredControl…`; `Relay/ControlDisplayResumeTests.cs`; `integration/control-display-binding.test.ts`; live: `live-acceptance` › „driver resume …“ |
| Alt-Client und Alt-Onboard kompatibel (Altpfad, D56/D68) | automatisiert / live | `Relay/TelemetryRelayTests.cs`; `SecurityHubOriginTests.LegacyUpdateTelemetryChecksTheClaimedVehicle`; live: `live-acceptance` › „Alt-Onboard text path …“ |

### 3.4 LiDAR

| Regel | Status | Nachweis |
| --- | --- | --- |
| Gruppen (1/2/3 Punkte, 5 cm räumlich, Lücken, 0°/360°, Feldgrenzen), Zonen, nächster Punkt, 4/6/8/12/16/24 | automatisiert | AP04 `Lidar/*Tests.cs` inklusive echter Aufnahme `pico-scan-10rev.bin`; AP08-Widget-Tests |
| Farbskala, Nahzone, Blinkfrequenz, Nachleuchten ohne Verlängerung der Gültigkeit, Teilscan-Warnung | automatisiert | AP08 `runtime/widgets/lidar` |
| Zählrichtung des Scanners (D58, `scannerClockwise`) | Hardware offen | Testaufnahme nach gesonderter Vereinbarung |
| LiDAR-Datenmenge im Budget | automatisiert | `BandwidthTests` (§4) |

### 3.5 Sicherheit und Portabilität

| Regel | Status | Nachweis |
| --- | --- | --- |
| Formeln: kein Code, Missbrauch kontrolliert abgewiesen, Limits | automatisiert (PG) | `security-expressions` + `SecurityExpressionTests` (§5.2) |
| SVG: Positivliste, keine Skripte, Handler, externen Ressourcen, `foreignObject`, SMIL/CSS-Animation; Limits; nichts ungeprüft gespeichert | automatisiert (PG) | `SecurityServiceTests.MaliciousSvgIsRejectedOrStoredOnlyInSanitizedForm` (23 Dateien), `OversizedSvgIsRefusedBeforeSanitizingAndNothingIsStored`; AP07-Fixtures |
| Asset-Antworten inert (CSP, `nosniff`, `immutable`) | automatisiert (Controller in-process) / live | `AssetResponsesCarryCspNosniffAndImmutableCaching`; über HTTP: `live-acceptance` |
| Vorschau führt das Original nie aus | automatisiert (Logik) / manuell offen | AP07 (die Vorschau zeigt nur die bereinigte Ausgabe als Bild); Browser: §6 Nr. 8 |
| Paketimport: Grenzen, `__proto__`, fremde Referenzen, erneute Serverbereinigung, Sperre ungelöster Referenzen | automatisiert (PG) | `security-import.test.ts`, `ForeignVehicleReferencesCannotBePublishedOrRestored`; AP12 `exchange.test.ts` |
| Export ohne Livewerte, Präferenzen, Zugangsdaten; Rundlauf erhält Assets | automatisiert | AP12 `exchange.test.ts`, `PackageExchangeTests.cs` |
| Herkunftsprüfung Onboard-Daten (D56) | automatisiert | `SecurityHubOriginTests.OnlyTheRegisteredOnboardFeedsTelemetryOfItsVehicle`, `LegacyUpdateTelemetryChecksTheClaimedVehicle` |

## 4. Leistung und Bandbreite (S09)

### 4.1 Bandbreite je Zuschauer (automatisiert, `BandwidthTests`)

Messaufbau:

- 60 s simuliert, Onboard-Tick 100 ms, LiDAR 5 Hz.
- Echte Bausteine: `TelemetryDeltaTracker`, `LidarGridProducer` (mit Totband),
  `TelemetryRelay` und `ControlDisplayRelay`.
- Gezählt wird beim Client: SignalR-JSON-Protokoll inklusive Record-Separator
  und Websocket-Frame-Header.
- Uplink zum Server: MessagePack.
- Kanäle wie R2: 7 numerische Kanäle mit 10 Hz, LiDAR-Raster und Ausgänge.
- Bei Fahrt ändert sich jeder Wert in jedem Tick (Worst Case).

| Szenario | Telemetrie B/s (davon LiDAR) | Ctl B/s | gesamt B/s | Uplink B/s | Budget S09 | Bewertung |
| --- | --- | --- | --- | --- | --- | --- |
| R2, Fahrt, LiDAR dünn (60 Felder) | 3115 (1695) | 1069 | **4184** | 3179 | ≤ 6000, LiDAR ≤ 3000 | erfüllt |
| R2, Stillstand | 358 (6) | 83 | **441** | 253 | ≤ 1500 | erfüllt |
| R2, Fahrt, LiDAR dicht (480 Felder) | 7915 (7013) | 1069 | 8984 | 7979 | (nicht im S09-Szenario) | Hinweis, §7 B4 |
| ohne Bedarf und ohne Leiste | 0 | 0 | 0 Nachrichten | 0 | 0 | erfüllt |

Nicht enthalten sind TLS-, TCP-, Ping- und Handshake-Overhead. Ctl wird im
Test mit der D31-Rate nachgebildet und nicht über den echten
TS-Publisher gesendet. Eine Messung am echten Websocket gehört zu den
Browserprüfungen (§6 Nr. 11).

### 4.2 Laufzeitkosten pro Frame in Node (automatisiert, `performance.test.ts`)

Messaufbau:

- Gemessen wird der echte `OverlayController`: Laufzeit, Szene und DOM-Patch
  auf dem Fake-DOM.
- 30 fps; Quellen 10 Hz, LiDAR 5 Hz synthetisch mit etwa 60 Feldern.
- 5 s Aufwärmen, langer Lauf mit 1800 Frames.
- R3 wird an den D33-Grenzen erzeugt: 500 Elemente, 200 Clips, 300 Formeln,
  2 Assets mit je etwa 2000 Elementen, LiDAR mit 24 Sektoren und Sweep.

| HUD | Mittel | p95 | max | DOM-Schreibvorgänge/Frame | p95 × 4 (Näherung) | Ziel |
| --- | --- | --- | --- | --- | --- | --- |
| R1 | 0,05 ms | 0,08 ms | 0,8 ms | 1 | 0,3 ms | p95 ≤ 33,4 ms |
| R2 | 0,17–0,30 ms | 0,46–0,59 ms | 1,9 ms | 15 | 1,8–2,4 ms | p95 ≤ 33,4 ms |
| R3 | 1,5–1,8 ms | 2,0–5,4 ms | 10,7 ms | ≈ 315 | 8–22 ms | p95 ≤ 50 ms |

Der Faktor 4 ersetzt die Chromium-CPU-Drosselung nur grob. Layout, Paint,
Compositing, ein echtes DOM und das Video fehlen. Die Werte zeigen deshalb
nur, dass die JS-Seite der Laufzeit das Budget nicht ausschöpft. Die Abnahme
der Bildzeit nach D42 bleibt manuell offen (§6 Nr. 10).

### 4.3 Speicher und Pause

- **Heap über 10 min simuliert** (18 000 Frames, `SIGNALRC_PERF=1`, mit
  erzwungenem GC): R2 +0,01 MB, R3 −1,8 MB. Das Ziel < 10 MB ist erfüllt.
  Die Spitzen ohne GC (46/63 MB) sind kurzlebiger Müll, kein Leck.
- **Pause** (verborgener Tab oder ausgeblendetes HUD, über `setShown(false)`):
  - 0 Frame-Listener, 0 gerenderte Frames, 0 DOM-Schreibvorgänge bei
    1 min weiter eintreffender Werte;
  - der Telemetriebedarf wird freigegeben;
  - nach dem Wiederanzeigen läuft der erste Frame zur aktuellen Zeit, ohne
    die verborgene Zeit nachzuholen.
- Ob der Browser bei verborgenem Tab wirklich keine Frames anstößt (Observer
  und `visibilitychange`), prüft §6 Nr. 12.

## 5. Live-Tests und Sicherheitsdetails

### 5.1 Live-Tests gegen einen lokalen Server

`acceptance/live-acceptance.test.ts` deckt sechs Szenarien über echtes HTTP und
SignalR ab:

1. Berechtigungsmatrix: ohne Sitzung, anderer anonymer Sitzungsbenutzer,
   Fahrer nach Release und anonymer Fahrer mit Steuerung (D73).
2. Bösartige SVG-Uploads; Asset-Header.
3. Zwei Tabs: 409, 403 und Revisionsprüfung.
4. Veröffentlichen an einen anonymen Betrachter, historische Veröffentlichung
   mit ihrem Asset nach 55 Speicherungen, Restore, verpasste Veröffentlichung
   nach Reconnect.
5. Alt-Onboard über `UpdateTelemetry` und Alt-Client; fremde Verbindung wird
   verworfen.
6. `ResumeCarControl`.

Alle Live-Tests nutzen anonyme Sitzungsbenutzer (`GET /api/user/me`) und
erwerben die Steuerung über ein simuliertes Onboard (`testing/live.ts`), wie
auf der Webseite. Sie legen eigene getaggte Fahrzeuge an und räumen
Fahrzeuge und ihre Sitzungsbenutzer danach wieder auf (B6).

**Live-Lauf am 2026-11-02 bestanden** mit `scripts/overlay-check.sh
--start-server` gegen die PostgreSQL-Testdatenbank: alle 6 Szenarien grün,
zusammen mit den Live-Tests aus AP05 (3), AP09 (5) und AP13 (1); Vitest
gesamt 742/742, alle Schritte des Skripts ok. Nach D73 erneut bestanden
(2026-11-02, Vitest 745/745); Datenbank danach im Ausgangsstand.

Nach dem Lauf waren vier anonyme Sitzungsbenutzer (`User_<n>`) aus früheren
Live-Läufen der Pakete übrig. Sie wurden entfernt. Anonyme Hub-/HTTP-Zugriffe
legen solche Benutzer an; die Live-Tests räumen sie bisher nicht auf.

Beim ersten Lauf sind diese Annahmen zu bestätigen:

- Textform von `Ctl` an Betrachter;
- die bereinigte Ausgabe enthält keine `http(s)`-URL außer Namespaces;
- eine zu große Datei ergibt 413 (ersatzweise 422);
- die Upload-Antwort enthält `svg`.

Aufruf: `SIGNALRC_TEST_POSTGRES=… scripts/overlay-check.sh --start-server`.

Über in-process-Tests nicht abgedeckt und damit nur live prüfbar:

- Request-Dekompression (gzip) inklusive Kompressionsbombe;
- echtes Multipart;
- Antwortkompression für SVG.

### 5.2 Geprüfte Sicherheitsfälle (Kurzliste)

- **Formeln:**
  - 74 Missbrauchsfälle mit identischen Diagnosen in Client und Server:
    - Prototyp-Namen als Quelle oder Funktion;
    - `eval`, `Function`, `import`, `require`, `globalThis`, `this`;
    - Template-Strings, Kommentare, Member- und Indexzugriff, Literale,
      Zuweisung, `new`, `delete`, `typeof`, `?:`, `=>`;
    - Zahlenmissbrauch, Escapes und Steuerzeichen, Zero-Width-Space.
  - Grenzen: Länge 1000/1001, Tiefe 31/32, 5000-fache Verschachtelung ohne
    Stapelüberlauf, 300 Formeln an den Grenzen in begrenzter Zeit.
  - Nicht endliche Ergebnisse bleiben ungültig. Der Evaluator wirft nie.
- **SVG:**
  - 23 feindliche Dateien: AP07-Fixtures plus `javascript:`, `data:`,
    externe `use`/`url()`, `@import`, `@keyframes`, Style-Attribut, SMIL,
    Processing Instruction, XHTML-iframe, Handler in Großschreibung,
    2001 Elemente, manipulierte bereinigte Ausgabe.
  - Jede Datei wird abgelehnt (422) oder nur in bereinigter Form gespeichert
    und besteht `SvgSafetyCheck`.
  - Mehr als 256 kB ergeben 413 ohne DB-Zeile.
- **Paketimport:**
  - `__proto__`/`constructor` in Wurzel, Assets und Elementen;
  - eingebettete Assets gehen genau einmal zum Server, nur dessen Ausgabe
    zählt;
  - abgelehnte oder fehlende Assets bleiben ungelöst und blockieren;
  - fremde Streams werden nur über einen eindeutigen Namen zugeordnet;
  - mehr als 500 Elemente werden vor jedem Upload abgelehnt;
  - fremde Assets, Kanäle und Veröffentlichungs-IDs bleiben ungelöst bzw.
    ergeben 404.
- **Berechtigungen und Herkunft:** siehe §3.1 und §3.5. Zusätzlich:
  - NaN/∞ in `Ctl` werden gefiltert;
  - Interesse an einem unbekannten Fahrzeug wirft `HubException`;
  - das Zurückziehen eines Interesses scheitert nie.

## 6. Manuelle Browser-Checkliste

Jeweils in aktuellem Chromium und Firefox auf dem Desktop; mobil mindestens
Android Chrome und iOS Safari. Ergebnis, Browserversion und Gerät eintragen.

| Nr. | Prüfung | Erwartung | Ergebnis |
| --- | --- | --- | --- |
| 1 | HUD auf dem Videoframe bei 16:9- und 4:3-Stream im breiten und im hohen Player | HUD exakt auf dem dargestellten Frame; Letterbox-Bereiche frei; kein Verzerren oder Beschneiden | |
| 2 | Fenstergröße ändern, Stream mit anderem Seitenverhältnis wählen | Ausrichtung bleibt; Wechsel der Variante je `StreamId` | |
| 3 | Container-Vollbild (Desktop, Android Chrome, **iOS Safari**) | HUD bleibt im Vollbild auf dem Frame; wo Safari kein Container-Vollbild erlaubt, dokumentieren (natives Video-Vollbild/PiP nicht zugesichert) | |
| 4 | Mobile Anzeige 412 × 915: HUD sichtbar, Touch auf der Fahransicht | HUD fängt keine Eingaben ab; persönliches Ausblenden bleibt nach Neuladen und neuer Veröffentlichung; Stream-Status unabhängig schaltbar | |
| 5 | Veröffentlichen, während ein zweiter Tab das Video zeigt | HUD wechselt ohne Video-Neuverbindung (Netzwerk-Tab: keine neue Janus-Sitzung); bei Fehlern im HUD laufen Video und Steuerung weiter | |
| 6 | Editor, Zeigerbedienung: Auswahl, Rahmenauswahl, Griffe (Verschieben, Skalieren, Drehen, Pivot), Zoom/Pan, Raster mit Einrasten, Ebenen-Drag | flüssig; ein Drag ist ein Undo-Schritt | |
| 7 | Zeitachse: Keyframes ziehen, Scrubbing, Clip-Dauer; Vorschau-Modus sperrt Drag-and-drop | Scrubbing ändert kein Dokument; Vorschau beginnt bei t = 0 | |
| 8 | Dialoge: SVG-Import (bereinigte Vorschau, Bericht, Bestätigung), Paket-Import/-Export, Vorlagen, Veröffentlichen mit Notiz, Verlauf/Restore mit Bestätigung, Konfliktdialog mit Download | Texte deutsch (`messages.overlay`); keine Netzwerkanfragen aus der SVG-Vorschau (Netzwerk-Tab leer) | |
| 9 | Tastaturtrennung: im Editor tippen (Zahlenfelder, Formelfeld, Pfeiltasten, Leertaste), PTT-Taste | keine Fahrzeugbefehle und kein PTT; Banner zeigt die Steuerungspause; nach Verlassen keine automatische Reaktivierung | |
| 10 | Leistung R1, R2, R3 in Chromium mit 4× CPU-Drosselung, Viewports 412 × 915 (DPR 2,625) und 1920 × 1080, Testvideo 30 fps, 5 s Aufwärmen + 60 s Messen | p95 Frame-Intervall R1/R2 ≤ 33,4 ms, R3 ≤ 50 ms, Video spielt weiter | |
| 11 | Websocket-Datenmenge im Netzwerk-Tab mit R2 bei Fahrt bzw. Stillstand (60 s) | ≤ 6 kB/s, LiDAR ≤ 3 kB/s, Stillstand ≤ 1,5 kB/s; ohne HUD und Leiste keine Telemetrie | |
| 12 | Tab verbergen bzw. HUD ausblenden (Performance-Aufzeichnung) | 0 HUD-Frames; nach Rückkehr Neustart ohne Nachholen | |
| 13 | React-Observer: Resize-/Intersection-/Visibility-Observer hängen sich beim Unmount ab (Seitenwechsel, Streamwechsel, 10 × Editor öffnen/schließen) | keine wachsenden Listener (Memory-Snapshot); JS-Heap über 10 min < 10 MB Zuwachs | |
| 14 | Echter Mittelklasse-Android-Gerät (D21/D42) mit R2 | flüssig ≥ 30 fps; **Gerätebezeichnung dokumentieren** | |

Ein Bildschirm-Reader-Test ist nicht Teil der Abnahme.

## 7. Befunde und verbleibende Einschränkungen

| ID | Schwere | Befund | Stand |
| --- | --- | --- | --- |
| B1 | mittel | Unlesbares `OverlayAsset.MetadataJson` ließ `OverlayService.ContextAsync`/`Metadata` werfen. Dadurch waren Speichern und Veröffentlichen für das ganze Fahrzeug blockiert. | **behoben** in AP14: Unlesbare Metadaten werden übersprungen wie in `AssetMetadataAsync`. Das Asset gilt dann als fehlend: Speichern geht, Veröffentlichen mit diesem Asset ist mit `OVL_REF_UNKNOWN_ASSET` blockiert. Test `UnreadableAssetMetadataDoesNotBlockSavingOrOtherPublications` (SQLite + PG). |
| B2 | niedrig | Textliterale in Formeln akzeptieren NUL- und Bidi-Steuerzeichen (z. B. U+202E). Beschriftungen ließen sich damit optisch verfälschen; die Darstellung erfolgt nur als Text, nie als Markup. | offen; Vorschlag: Steuerzeichen in der Analyse beidseitig ablehnen (Vertragsänderung AP06). |
| B3 | niedrig | Eine Formel mit mehr als 1000 Zeichen wird beim Speichern mit `OVL_SCHEMA_INVALID` (Schema `maxLength`) abgelehnt, die Analyse meldet dagegen `OVL_LIMIT_EXCEEDED`. Blockiert ist beides; nur der Code unterscheidet sich. | offen; betrifft die Editoranzeige. |
| B4 | niedrig | Ein dichtes LiDAR-Raster (mehr als 239 Felder) braucht bei Fahrt etwa 7 kB/s, gesamt etwa 9 kB/s je Zuschauer. Das entspricht der Rechnung in T01; das S09-Budget ist für etwa 60 Felder definiert. | bekannte Grenze, kein Fix. |
| B5 | Info | Ctl kostet bei 10 Hz etwa 107 B je Nachricht, weil die Fahrer-Epoche jedes Mal mitreist. Das liegt im Budget. | Optimierung optional. |
| B6 | Prozess | Die Live-Tests (§5.1) waren in AP14 zunächst nicht ausgeführt. Bei anonymen Zugriffen legt der Server Sitzungsbenutzer an, die die Live-Tests nicht aufräumen. | **behoben** mit D73: Live-Tests legen ihre anonymen Sitzungsbenutzer gezielt an und löschen sie (nur ohne `LoginName`) samt Setups. |
| B7 | hoch (Abhängigkeiten) | NuGet-Warnungen im Server-Build: `MessagePack` 2.5.187 (NU1902/NU1903, u. a. GHSA-hv8m-jj95-wg3x, GHSA-vh6j-jc39-fggf), `Microsoft.AspNetCore.SignalR.Protocols.MessagePack` 9.0.3 und `Microsoft.AspNetCore.SignalR.Common` 9.0.3 (NU1903), dazu NU1510 (überflüssige Paketreferenzen). | Bestand vor dem Overlay, nicht in AP14 geändert; Update als eigenes Paket mit Onboard-Kompatibilitätstest empfohlen. |
| E1 | – | D58: Zählrichtung der LiDAR-Indizes (`scannerClockwise`, Standard `true`) | Hardwaretest nach gesonderter Vereinbarung. |
| E2 | – | Lesepfade CAN, LiDAR, BMS und CPU nur über die Zustandsabbildung getestet (AP03) | Hardwaretest. |
| E3 | – | Trennt sich das Onboard, läuft die Steuerungsanzeige erst nach erneutem Erwerben der Kontrolle weiter (AP13) | bekannte Grenze. |
| E4 | – | Browser-Automatisierung (D42/D65) entfällt auf Wunsch des Auftraggebers; Bildzeit, Layout und Observer nur manuell (§6) | Abweichung vom Vertrag, dokumentiert. |
| E5 | – | Leistungswerte in Node sind eine Näherung (§4.2); die Bandbreite ist ohne TLS/TCP gemessen (§4.1) | siehe §6 Nr. 10–11. |

Hardware- und Vor-Ort-Tests sind ausdrücklich nicht durchgeführt. Sie
erfolgen nur nach gesonderter Vereinbarung:

- D58-Testaufnahme;
- echte Sensoren;
- echter Fahrzeug-Uplink;
- Android-Referenzgerät.

Ein Rollout ist nicht Bestandteil dieser Abnahme.

## 8. Gesamtbewertung

- Alle Paket- und übergreifenden Tests ohne Browser bestehen.
- Die S09-Budgets für Bandbreite, Speicher und Pause sind erfüllt, soweit sie
  ohne Browser messbar sind.
- Ein mittlerer Fehler (B1) ist behoben.
- Für M5 fehlen noch:
  - die manuelle Browser-Checkliste (§6);
  - die Hardwaretests (E1, E2).
