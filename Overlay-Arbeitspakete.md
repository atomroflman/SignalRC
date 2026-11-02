# Fahrzeug-Overlay: Arbeitspakete und Parallelisierung

Stand: 2026-11-02.
- AP00 ist freigegeben.
- AP01 bis AP14 sind umgesetzt; offen sind der Live-Lauf der Abnahmetests,
  die manuelle Browser-Checkliste und Hardwaretests (siehe `Overlay-Abnahme.md`).
- M0 ist erreicht (T0 mit AP01).

„Umgesetzt“ heißt: implementiert, getestet und lokal committet. Die gemeinsame
Abnahme aller Pakete erfolgt in AP14, ein Rollout ist damit nicht verbunden.

## Zweck und maßgeblicher Gesamtplan

Dieses Dokument fasst die Umsetzung des dynamischen Fahrzeug-HUDs in klar
abgegrenzte Arbeitspakete. Maßgeblich für Produktumfang und Verhaltensregeln ist
[Overlay-Feature.md](Overlay-Feature.md). Bei Widersprüchen ist der Gesamtplan
zu klären, nicht unabhängig je Paket eine eigene Regel zu erfinden.

Die Pakete werden nach Modulgrenzen und Abhängigkeiten geschnitten. Es gibt
keine feste Begrenzung gleichzeitig möglicher Bearbeiter. Neue Laufzeitbibliotheken
sollen möglichst vermieden werden; zusätzliche Entwicklungs-/Testwerkzeuge
sind erlaubt. Keine Implementierung, Installation oder Bereitstellung wird durch
dieses Dokument automatisch gestartet.

## Arbeitsmodell

### Startvoraussetzung und Fertigstellungsabhängigkeit unterscheiden

- **Vor AP00-Freigabe:** technische Verträge, Referenzfälle und Zuständigkeiten
  festlegen. Testplanung kann bereits mitlaufen; unabhängige Implementierungen
  dürfen keine abweichenden Verträge vorwegnehmen.
- **Nach AP00-Freigabe:** AP01 bis AP12 können gegen festgeschriebene Ports,
  Testdoubles und Referenzdaten parallel starten. AP13 integriert fortlaufend;
  AP14 entwickelt die übergreifenden Tests mit.
- **Vollständige Integration:** benötigt die realen Implementierungen der in der
  Tabelle genannten Zulieferer. Ein Paket gegen Testdoubles fertigzustellen
  bedeutet noch nicht, dass der gesamte Funktionspfad abgenommen ist.
- **Produktive Zusammensetzung:** keine versehentlich aktivierten Testdoubles,
  keine simulierten Messwerte im Live-Telemetriepfad und keine offenen Platzhalter.

Jeder Paketverantwortliche implementiert seine Modultests selbst. AP14 ergänzt
systemübergreifende Prüfungen und ist keine nachgelagerte Testabteilung, an die
ungetestete Module übergeben werden.

### Überblick

AP00 ist das gemeinsame Start-Gate für die nachfolgenden Implementierungspakete.
Die letzte Spalte benennt Zulieferer für die Fertigstellung mit realen Modulen,
nicht ein zusätzliches Verbot, vorher gegen deren vereinbarte Ports zu arbeiten.

| ID | Status | Ergebnis / Zuständigkeit | Reale Zulieferer zur Integration |
| --- | --- | --- | --- |
| AP00 | ✅ freigegeben | Vertragsfundament, Referenzfälle, Modulgerüste und Schreibzuständigkeiten | Keine; setzt den abgestimmten Gesamtplan um. |
| AP01 | ✅ umgesetzt | Variantenauflösung und strukturelle Dokumentprüfung | AP00-Verträge. |
| AP02 | ✅ umgesetzt | Serverpersistenz, Revisionen, Berechtigungen und Veröffentlichung | AP01, AP06, AP07. |
| AP03 | ✅ umgesetzt | Telemetriequalität, Reader-Anbindung und Servertransport | AP00-Verträge; Anwendungsverdrahtung über AP13. |
| AP04 | ✅ umgesetzt (Ausrichtung D58 offen) | LiDAR-Gruppen und kompaktes Winkel-/Distanzraster | AP03 für Qualität und Transport. |
| AP05 | ✅ umgesetzt | Client-Telemetrie, Metadaten, Alterung und Verbraucher | AP03; LiDAR-Daten aus AP04. |
| AP06 | ✅ umgesetzt | Sicheres Ausdruckssystem in Client und Server | AP00-Verträge. |
| AP07 | ✅ umgesetzt | SVG-Bereinigung, normalisierte Assets und Importvorschau | AP00-Verträge; Speicherung/HTTP-Anbindung über AP02/AP13. |
| AP08 | ✅ umgesetzt | SVG-/Animationslaufzeit und LiDAR-Widget | AP01, AP05, AP06, AP07. |
| AP09 | ✅ umgesetzt | Editorzustand, Gestaltungsfläche, Undo/Redo und Autosave | AP01, AP02, AP08. |
| AP10 | ✅ umgesetzt | Eigenschaften, Bindungen und Keyframe-Zeitachse | AP06, AP08, AP09. |
| AP11 | ✅ umgesetzt | Lokale Simulation und dynamische Vorschau | AP05, AP08, AP09. |
| AP12 | ✅ umgesetzt | Startvorlagen, Paket-Import/-Export und Zuordnung | AP01, AP02, AP07, AP09. |
| AP13 | ✅ umgesetzt | Video-, UI-, Steuerungs- und Anwendungsintegration | Verbindet AP01 bis AP12 schrittweise. |
| AP14 | ◐ umgesetzt ohne Browser; Live-Lauf offen | Browser-, Sicherheits-, Reconnect- und Leistungsabnahme | Gemeinsame Referenzfälle und integrierbare Funktionspfade. |

## AP00 – Vertragsfundament und Freigabe-Gate ✅

Entscheidungen D01–D58 und Spezifikationsstand S01–S09 stehen in
[Overlay-AP00-Vertraege.md](Overlay-AP00-Vertraege.md); die Verträge selbst
liegen unter [Shared/Overlay/](Shared/Overlay/README.md). AP00 ist seit
2026-11-01 freigegeben.

**Ziel:** Alle Bearbeiter arbeiten gegen dieselben versionierten Modelle und
Verhaltensregeln. Noch offene technische Details werden hier entschieden, nicht
parallel in mehreren Implementierungen.

**Lieferumfang:**

- Konfigurationsschema mit Elementidentitäten, Gruppen, Arbeitsflächen,
  Standard/Varianten, Deaktivierung, Bindungen, Clips und Asset-Referenzen.
- Property-Katalog: Typen, Koordinaten, Pivot/Transformationsreihenfolge,
  Einheiten, erlaubte Steuerungsmodi, Interpolation und Grenzen.
- Variantenregeln einschließlich Ergänzen, Überschreiben, Rücksetzen,
  Gruppenumstrukturierung, Löschfolgen und deaktivierter Teilbäume.
- Persistenz-/API-Vertrag: Entwurfsrevisionen, Veröffentlichung, Historie,
  Wiederherstellen, Berechtigung, Konflikte, Asset-Lebenszyklus und Ereignisse.
- Ausdrucksgrammatik, Operatoren/Funktionen, Typ-/Fehlerregeln, statische
  Kanalabhängigkeiten und Komplexitätsgrenzen; gemeinsame Sprachtestfälle.
- Clip-Zustandsmodell: Auslöser, Stoppen/Deaktivieren, erneute Impulse,
  Wiederholung, Endzustand, Scrubbing, Ratenintegration und Glättung.
- Telemetriequalität: Quellstatus, Messalter/Zeitbasis, erwartete Rate,
  Reihenfolge, Reconnect, Altversionen und überprüfbare Datenherkunft.
- Konkrete Standardfristen sowie Autosave-/Sicherungsparameter; keine Werte
  stillschweigend aus verschiedenen Modulen übernehmen.
- LiDAR-Vertrag mit Orientierung, Quellenparametern, 5-cm-Gruppenprüfung,
  fünf Distanzzonen und exakter Ableitung aller erlaubten Widget-Sektorenzahlen.
- Prüfung des Vorschlags **96 Winkelabschnitte × fünf Distanzzonen** einschließlich
  Drahtformat, Bandbreite, Aktualisierungsrate und Snapshot-/Qualitätsmetadaten.
- Einbindung in den vorhandenen LiDAR-Mehrscanfilter ohne unbeabsichtigte
  Zusatzlatenz; Bereitstellung des neuen Rasterkanals für bestehende Installationen.
- SVG-Positivliste, sichere normalisierte Darstellung, Unterelement-IDs,
  Ressourcenlimits, Austauschformat und Import-/Ersetzungsregeln.
- Browser-/Referenzgeräteprofil, messbare Leistungsgrenzen und Testwerkzeuge.
- Modulports, gemeinsame gültige/ungültige Beispieldaten und eindeutige
  Dateiverantwortung; bei Bedarf minimale gemeinsame Modulgerüste.

**Abnahme:**

- Alle genannten Verträge sind konkret genug für unabhängige Implementierung.
- Es gibt Referenzfälle für Varianten, Formeln, Qualitätszustände, LiDAR,
  Assets, Speicher-/Berechtigungskonflikte und Zeitverhalten.
- Implementierungs- und Testdoubles können dieselben Schnittstellen erfüllen.
- Kein offener Vertragskonflikt wird als scheinbar unabhängige Paketentscheidung
  weitergereicht. Neu auftauchende Produktfragen werden vor Freigabe abgestimmt.

**Nicht enthalten:** Vollständige Featureimplementierung oder Rollout.

## AP01 – Variantenauflösung und Dokumentprüfung ✅

**Status (2026-11-02):** umgesetzt.
- TS (`Client/src/components/overlay/document/`) und C#
  (`Server/Overlay/Documents/`), beide gegen dieselben Fixtures getestet
  (Vitest, xUnit).
- Die Formelprüfung nutzt AP06.
- Speichern und Veröffentlichen sind über AP02 eingebunden.
- T0 (Testgerüste) ist hier mit erledigt.

**Ziel:** Aus einem Gesamtstand und ausgewähltem Stream eine eindeutig bestimmte
effektive Konfiguration erzeugen, unabhängig von UI, Netzwerk und Zeitmodell.

**Lieferumfang:**

- Stabile Elementidentitäten und Auflösung von Standard plus Überschreibungen.
- Eigene Varianten-Elemente, Ausblenden/Deaktivieren, Rücksetzen und Arbeitsflächen.
- Kein Standard-Fallback bei ausdrücklich deaktivierter Variante.
- Strukturelle Prüfung von Gruppen, Referenzen und Eigenschaftsformen.
- Ermittlung betroffener Varianten/Unterelemente vor Standard-Löschaktionen.
- Unterscheidung ausdrücklich deaktivierter und nur dynamisch unsichtbarer Teile.
- Übereinstimmende Server-/Client-Auflösung anhand gemeinsamer Referenzfälle.

**Schnittstellen:** Dokument, Streamidentität und Metadaten hinein; effektive
Konfiguration und ortsgenaue Diagnosen heraus. Keine Persistenz, Formel-Laufzeit
oder direkten Editorzustandsänderungen.

**Abnahme:** Alle Vererbungs-, Lösch-, Deaktivierungs- und Grenzfälle sind
deterministisch getestet; Server und Client stimmen überein.

## AP02 – Serverpersistenz, Berechtigungen und Veröffentlichung ✅

**Status (2026-11-02):** umgesetzt in `Server/Overlay/` mit Migration
`AddOverlay`, einschließlich Abhängigkeitsauskunft und Formelprüfung beim
Veröffentlichen (AP06).
- Getestet gegen SQLite und die PostgreSQL-Testdatenbank, inklusive
  Nebenläufigkeit.
- Zusätzlich End-to-End über HTTP und Hub gegen einen lokal gestarteten Server.
- SVG-Upload mit der Bereinigung aus AP07 umgesetzt; D67 entfällt.

**Ziel:** Gemeinsamen Entwurf und unveränderliche Veröffentlichungen sicher
speichern und berechtigten Clients zugänglich machen.

**Lieferumfang:**

- Datenmodell/Migrationen für Entwurf, Revisionen, Veröffentlichungen und Assets.
- Genau ein gemeinsamer Entwurf je Fahrzeug und revisionsgeprüfte Schreibzugriffe.
- Serverseitige Prüfung auf regulären aktiven Fahrer bei Verwaltungsoperationen;
  veröffentlichte Daten gemäß Fahrzeugstream-Leseberechtigung zugänglich machen.
- Entwurfsspeicherung auch bei zulässigen semantischen Bearbeitungsfehlern.
- Veröffentlichungsprüfung über AP01/AP06/AP07; deaktivierte Teile semantisch
  warnen, Struktur/Sicherheit/Limits immer prüfen.
- Atomarer Gesamtstand aus Standard, Varianten und unveränderlichen Assets.
- Versionsverlauf und bestätigtes Wiederherstellen als Entwurf, nicht sofort live.
- Änderungsbenachrichtigung und Abfrage der aktuellen Veröffentlichung für Reconnect.
- Asset-Speicherung und -Abruf; Bereinigung selbst stammt aus AP07.
- Abhängigkeitsauskunft für Warnungen vor Kanal-Löschen/-Umbenennen.

**Schnittstellen:** Persistenz-/Veröffentlichungsport aus AP00. Parser,
Dokumentauflösung und Sanitizer werden eingebunden, nicht hier erneut erfunden.

**Abnahme:** Unberechtigte und veraltete Schreibzugriffe scheitern kontrolliert;
Veröffentlichungen und historische Assets bleiben unverändert; Restore wirkt
erst nach erneutem Veröffentlichen. Integrationstests decken Kontrollwechsel ab.

## AP03 – Quellqualität und rückwärtsverträgliche Telemetrie ✅

**Status (2026-11-02):** umgesetzt.
- **Onboard** (`Onboard/Telemetry/`): Reader-Qualität, Delta-Tracker,
  bedarfsgesteuertes Senden ohne Rückfall (D68).
- **Server** (`Server/Telemetry/`, `CarConnectionHub.Telemetry.cs`):
  Telemetrie-Relay mit Cache, Interessen, Bedarf, Alt-Clients und
  Alt-Onboards sowie Herkunftsprüfung (D56); Relay der Steuerungsanzeige
  (D57).
- **Tests:** xUnit gegen die gemeinsamen Delta-Fälle. Zusätzlich End-to-End
  über SignalR gegen einen lokal gestarteten Server mit simuliertem Onboard,
  neuem und altem Client, Fahrer, Zuschauer und Störer.
- **Nicht ohne Hardware getestet:** die Lesepfade von CAN, LiDAR, BMS und
  CPU. Geprüft ist dort nur die reine Abbildung auf Zustände und Alter.
- **Client-Seite:** mit AP05 umgesetzt; die Telemetrieleiste nutzt den
  Altpfad nicht mehr.
- **Nachträglich behoben (in AP04 gefunden):** `TelemetryDelta.IsEmpty` fehlte
  `[IgnoreMember]`, MessagePack-Serialisierung schlug dadurch fehl.

**Ziel:** Werte einschließlich ihrer tatsächlichen Quellaktualität transportieren,
ohne die bisherige manuelle Telemetrie oder ältere Clients zu brechen.

**Lieferumfang:**

- Reader-/Service-Anbindung für Gültigkeitsstatus, Messalter und erwartete Rate.
- Vorhandene Health-/Altersinformationen aus CAN, LiDAR und Batterie korrekt
  einbinden; Reader ohne Qualitätsunterstützung als ungeprüft kennzeichnen.
- Wiederholt gesendete Cache-/Sensorwerte behalten ihr tatsächliches Messalter.
- Erweiterte Übertragung Onboard → Server → Client einschließlich Reconnect-
  und Reihenfolgeregeln sowie Prüfung der passenden Onboard-Herkunft.
- Kompatibilität der bestehenden textbasierten Telemetrie und persönlichen
  Abonnementpräferenzen; keine automatische HUD-Abonnementpersistenz.
- Anbindungspunkt für den spezialisierten LiDAR-Produzenten aus AP04.
- Serverseitiger Anzeigetransport der Eingabe-/Flow-Signale des aktiven Fahrers
  einschließlich Herkunft, Kontrollwechsel und Pausenstatus. Diese Signale
  sind keine Sensormessungen und werden nicht als Fahrzeugbefehle behandelt.

**Schnittstellen:** Telemetrievertrag aus AP00. Keine HUD-Darstellung, kein
LiDAR-Widget und keine neue fahrzeugseitige Sicherheitslogik.

**Abnahme:** Alte, aber erneut gesendete Messwerte werden nicht frisch;
Quellfehler, unbekannte Qualität und Transportausfall bleiben unterscheidbar.
Altclients/-Onboard werden gemäß Kompatibilitätsvertrag behandelt.

## AP04 – LiDAR-Gruppen und kompaktes Grundraster ✅

**Status (2026-11-02):** umgesetzt.
- **Onboard** (`Onboard/Telemetry/LidarGrid/`): `LidarGridTelemetryReader`
  rechnet aus dem Rohscan vor dem Mehrscanfilter, ohne dessen Fensterlatenz.
  Gruppen über den ganzen Rundscan inklusive 0°/360°, Montagekorrektur,
  96 × 5 Raster, Zentimeter-Kodierung dünn/dicht, Totband (D62).
- **Server** (`Server/Overlay/Lidar/`): Einrichtungsaktion
  `POST api/cars/{carId}/overlay/lidar-grid-source`, idempotent, ohne
  Migration; Kanal wird sofort mit `ServerId` ans Onboard gemeldet.
- **Client** (`Client/src/components/overlay/lidar-source/`): eigenständige
  Konfigurationshilfe `LidarSourceSetup`; Einbindung über AP13.
- **Tests:** xUnit ohne Hardware gegen alle LiDAR-Fixtures und
  Abnahmefälle, echte Aufnahme `pico-scan-10rev.bin`, Transport über
  MessagePack und JSON, Einrichtung gegen SQLite und PostgreSQL.
- **Offen:** Zählrichtung (D58) als Option `scannerClockwise` (Standard
  `true`); Bestätigung per Testaufnahme nur nach gesonderter Vereinbarung.
- **Nebenbei behoben:** `ChannelsController.ToMapItem` sendete ohne
  `ServerId` (Telemetriekanäle; Steuerkanäle haben dieselbe Lücke, offen).

**Ziel:** Aus Rundscans kompakte Daten für die vereinbarte HUD-Draufsicht bilden,
ohne Rohpunktwolken an den Browser zu übertragen.

**Lieferumfang:**

- Fehlende/unbrauchbare Messungen erkennen; direkte Winkelnachbarschaft erhalten.
- Gruppen ab drei Punkten mit räumlichem Nachbarabstand höchstens standardmäßig
  5 cm; räumliche Geometrie statt bloßer radialer Differenz verwenden.
- Gruppen vor Rasterzuordnung erkennen, auch über 0°/360° und spätere Feldgrenzen.
- Montagekorrektur und fünf quellseitige Distanzzonen; Standardgrenzen
  0,5 / 1 / 2 / 3 / 5 m und einstellbare Abstandsschwelle.
- Gemeinsames feines Winkelraster gemäß AP00; pro Zelle nächster gültiger
  Gruppenabstand/Nichtbelegung und erforderliche Qualitäts-/Snapshot-Metadaten.
- Daten müssen Widget-Sektorenanzahlen 4/6/8/12/16/24 exakt ermöglichen.
- Unvollständige Scans liefern erkannte gültige Gruppen mit Qualitätswarnung.
- Quellparameter-/Kanalkonfiguration und Anbindung an AP03; zugehörige isolierte
  Konfigurationshilfe liefern, Einbindung in bestehende Seiten über AP13.

**Nicht enthalten:** Prozentbasierte Belegungslogik, Widget-Farben/Blinken,
Punktwolken oder Änderung bestehender Kollisions-/Sicherheitsfunktionen.

**Abnahme:** Hardwarefreie Tests für ein/zwei/drei Punkte, exakte 5-cm-Grenze,
Entfernungssprünge, Lücken, Rundscan-/Rastergrenzen, Montagekorrektur, Zonenränder,
Teilscans und mehrere Gruppen pro Feld. Datenumfang entspricht dem AP00-Budget.

## AP05 – Client-Telemetrie und Verbrauchertrennung ✅

**Status (2026-11-02):** umgesetzt.
- **Client** (`Client/src/components/overlay/sources/`): gemeinsamer,
  typisierter Wertebestand je Fahrzeug auf einer Hub-Verbindung. Verbraucher
  melden sich getrennt an; die Vereinigung geht als ein
  `SetTelemetryInterest` hinaus (höchstens alle 200 ms).
  - Qualität und Alter mit Gründen, Alterung per Timer, injizierbare Uhr.
  - Reconnect/`seq` laut Vertrag; LiDAR-Raster dekodiert (`lidarGrid()`).
  - Steuerungsanzeige: Zuschauerbestand und `ControlDisplayPublisher` als
    Fahrer-Port (Verdrahtung AP13). Testdoubles unter `sources/testing/`.
- **Manuelle Leiste** (`telemetry-store.ts`, `telemetry.tsx`): Verbraucher des
  gemeinsamen Bestands, nur persönliche Auswahl, kein Altpfad mehr. Behoben:
  Verlassen der Seite löschte gespeicherte Präferenzen.
- **Server:** `GET api/cars/{carId}/overlay/sources` mit Metadaten und
  Ausgangsnamen, lesbar wie der Videostream (D69, D70).
- **Tests:** Vitest gegen `fixtures/telemetry` und `fixtures/lidar` (`wire`),
  Verhaltenstests, xUnit für den Quellkatalog, Live-Test gegen lokalen Server.
- **Offen für AP13:** Publisher an die Steuerverbindung anbinden;
  `pages/car/[carId]/test.tsx` nutzt noch den Altpfad.

**Ziel:** Typisierten, qualitätsbewussten Wertebestand für mehrere Verbraucher
bereitstellen, ohne persönliche Auswahl zu verändern.

**Lieferumfang:**

- Kanalmetadaten, typisierte Werte und Qualitäts-/Altersauswertung.
- Vereinigung der Anforderungen manueller Anzeige, aktivem HUD und Vorschau;
  getrennte Anforderungen/Lebenszyklen und bereinigtes Ab-/Ummelden.
- Manuelle Telemetrieleiste zeigt weiter ausschließlich manuelle Auswahl.
- Verbindungsverwaltung unabhängig vom alleinigen Mounten dieser Leiste.
- Fristen automatisch vorbelegen und HUD-Kanalüberschreibungen auswerten;
  ein Quellfehler lässt sich nicht durch längere Frist heilen.
- Altwerte/Alt-Onboard, Reihenfolge und Reconnect entsprechend AP00 behandeln.
- Strukturierte kompakte LiDAR-Daten als definierten Typ zugänglich machen.
- Eingabe-/Flow-Anzeigesignale des aktiven Fahrers über einen getrennten
  Quelladapter mit Typen, Aktualität und Übertragungsstatus bereitstellen;
  keine fremden persönlichen Knoten-IDs als HUD-Referenzen verwenden.

**Schnittstellen:** Lesender Telemetrieanbieter und Verbraucheranforderungen;
keine Renderer-DOM-Zugriffe und keine Simulation im gemeinsamen Livebestand.

**Abnahme:** Manuelles Abwählen unterbricht das HUD nicht; Entfernen eines
Verbrauchers stört andere nicht. Alterung tritt auch ohne weitere Nachrichten
ein. Persönliche gespeicherte Präferenzen bleiben unverändert.

## AP06 – Sicheres Ausdruckssystem ✅

**Status (2026-11-02):** umgesetzt.
- Client (`Client/src/components/overlay/expression/`): Analyse und Auswertung.
- Server (`Server/Overlay/Expressions/`): Analyse.
- Alle gemeinsamen Referenzfälle bestehen. Zusätzlich bestätigt ein
  Differenztest mit 400 000 Vergleichen, dass Client und Server gleich
  analysieren.

**Ziel:** Gleiche sichere Formelsemantik für Client-Laufzeit und serverseitige
Veröffentlichungsprüfung.

**Lieferumfang:**

- Parser, Typprüfung, Abhängigkeitsanalyse und begrenzte Auswertung nach AP00.
- Grundrechenarten, Vergleiche, Bedingungen und festgelegte Funktionen.
- Kanalauswahl-/Syntaxhilfe durch analysierbare Referenzen und genaue Diagnosen.
- Explizite Einheitenumrechnung; kein automatisches Ersetzen fehlender Werte
  durch null und keine unkontrollierten Typumwandlungen.
- Definierte Behandlung ungültiger Eingaben, Division durch null und nicht
  endlicher Ergebnisse; Ressourcen-/Komplexitätsgrenzen.
- Gemeinsame Client-/Server-Testdaten für gültige und ungültige Ausdrücke.

**Schnittstellen:** Parse/Analyse/Prüfung und Auswertung gegen typisierten
Wertekontext. Kein `eval`, `Function`-Konstruktor oder beliebiger Plattformzugriff.

**Abnahme:** Übereinstimmende Semantik und Diagnosen; missbräuchliche Ausdrücke
werden kontrolliert abgewiesen. Keine eigene UI oder eigene Telemetrieverbindung.

## AP07 – SVG-Assets und Importvorschau ✅

**Status (2026-11-02):** umgesetzt.
- **Server** (`Server/Overlay/Assets/`): Positivlisten-Bereinigung
  `SvgAssetSanitizer` mit .NET-Bordmitteln (XmlReader ohne DTD/Resolver);
  ersetzt den D67-Platzhalter.
  - CSS-Auflösung (D52), `use`/`symbol`-Expansion mit Zyklen- und
    Expansionsbudget, Normalisierung (Einheiten, Farben, Schriften, absolute
    Pfade, kanonische Zahlen), Teile mit stabilen IDs und `bbox`, Grenzen D32
    (ablehnen statt kürzen), `assetId` = sha256 der Ausgabe.
  - Unabhängige Sicherheitsprüfung `SvgSafetyCheck` auf der Ausgabe;
    erneutes Bereinigen ist idempotent (Austausch, AP12).
- **Client** (`Client/src/components/overlay/assets/`): `SvgImportPreview`
  zeigt nur die bereinigte Ausgabe als Bild mit ausdrücklicher Bestätigung;
  Upload-Helfer. Einbindung über AP09/AP13.
- **Tests:** gemeinsame Fixtures `Shared/Overlay/fixtures/svg/` mit
  byte-genauen Ausgaben; Negativfälle (Skripte, Handler, foreignObject,
  externe/data-URLs, CSS-Importe, SMIL, XXE, Billion Laughs, use-Bomben,
  Grenzen). Ein adversarialer Review fand keinen Weg zu ausführbarem Code oder
  externen Abrufen; gefundene Robustheitsprobleme (u. a. Stapelüberlauf,
  quadratische Laufzeiten) sind behoben und durch Regressionstests abgedeckt.
  End-to-End-Upload über HTTP gegen lokalen Server mit Test-DB.
- **Offen für AP14:** Browserprüfung der Vorschau.

**Ziel:** Statische importierte Geometrie sicher und reproduzierbar bereitstellen.

**Lieferumfang:**

- Serverseitige Positivlisten-Bereinigung und unabhängige Sicherheitsprüfung.
- Keine Skripte, Event-Handler, externen Ressourcen, `foreignObject` oder
  importierten SMIL-/CSS-Animationen; begrenzte unterstützte statische Teilmenge.
- XML-/Referenz-/Komplexitätsprüfungen und Ressourcenlimits nach AP00.
- Normalisierte Geometrie, stabile Unterelement-Referenzen und sichere SVG-IDs
  auch bei mehrfacher Verwendung desselben Assets.
- Verständlicher Bericht entfernter/nicht unterstützter Inhalte.
- Wiederverwendbare bereinigte Vorschau mit ausdrücklicher Bestätigung;
  unbrauchbare oder zu große Ergebnisse werden abgelehnt.

**Schnittstellen:** Importdaten hinein; normalisiertes sicheres Asset und Bericht
heraus. Speicherung/Asset-HTTP-Operationen besitzt AP02. Die Vorschau darf niemals
das unsichere Original ausführen.

**Abnahme:** Umfangreiche Negativtests und repräsentative erlaubte Grafiken;
interne Referenzen/Elementauswahl bleiben stabil. Keine externen Requests aus
importierten Dateien, auch nicht während der Vorschau.

## AP08 – SVG-/Animationslaufzeit und LiDAR-Widget ✅

**Status (2026-11-02):** umgesetzt.
- **Kern** (`Client/src/components/overlay/runtime/`):
  `createRuntime(config, options).step(t, source)` mit Clip-Zustandsmaschine,
  Raten (dt-Kappung 0,25 s, Wrap), Bindungen mit Glättung (Winkel über den
  kürzesten Weg), Keyframes mit Easing und Scrubbing; Qualitätsmarkierungen
  ungültig > ungeprüft > pausiert, `onInvalid: hide` (D71).
- **Szene:** alle Elementtypen, Transformationsreihenfolge, Markierungen in
  fester Bildschirmgröße, normalisierte Assets mit ID-Präfix `ovl-<elementId>-`.
- **LiDAR-Widget** (`runtime/widgets/lidar/`): Sektoren 4/6/8/12/16/24, fünf
  beschriftete Ringe, Farbskala, Pulsieren 0,5–2 Hz, 0,5 s Nachleuchten,
  Teilscan-Warnung, Sweep.
- **Einbettung:** `OverlayController` und `<OverlayRenderer>` mit Bedarf über
  AP05, Pause bei verborgenem Tab/Element, Neustart ohne Nachholen;
  DOM-Patch ohne React-Render pro Bild.
- **Tests:** alle Laufzeit-Fixtures, Qualitätsfälle, alle LiDAR-Aufteilungen,
  Asset-Parser und -Scoping, Referenzdokumente R1/R2/Varianten, grobe
  Kostenprüfung. Die React-Verdrahtung (Observer) ist nicht automatisiert
  geprüft (kein jsdom); Browsermessungen in AP14, Videoeinbau in AP13.

**Ziel:** Effektive Konfiguration mit gemeinsamen Laufzeitregeln rendern,
unabhängig von Videoeinbettung, Editorpersistenz und Fahrzeugsteuerung.

**Lieferumfang:**

- SVG-Elemente, Gruppen und normalisierte importierte Assets.
- Genau ein steuernder Modus je Eigenschaft; Kombination über Gruppen.
- Direkte Bindungen, optionale Glättung inklusive Winkel-Wrap und integrierte
  positive/negative Raten pro Sekunde.
- Unabhängige Keyframe-Clips mit Auslösern, Wiederholung, Easing und Scrubbing.
- Datenqualitätsanzeige: fehlende Werte, erkennbare ungültige Grafikzustände,
  gelbes Warndreieck mit Ausrufezeichen bei ungeprüfter Quelle und angehaltene
  abhängige Bewegung; konfigurierbares Ausblenden betroffener Elemente.
- Pause unsichtbarer Laufzeit und Neustart ohne Nachholen.
- LiDAR-Widget aus feinem Quellraster: einstellbare Sektorenanzahl, vorn
  zentriert, fünf gleich breite beschriftete Ringe.
- Entfernung des nächsten Gruppenpunkts je Feld; durchgehende Gelb–Orange–Rot-
  Skala, rote Nahzone standardmäßig 0,5 m, entfernungsabhängige 0,5–2 Hz,
  Pulsieren ohne vollständiges Verschwinden und 0,5 s Nachleuchten.
- Widgetoptionen für vereinbarte Darstellungsparameter; Qualitätswarnung bei
  Teilscans. Nachleuchten heilt keine veraltete Quelle. Optionaler dekorativer Sweep.

**Schnittstellen:** Konfiguration, Telemetrieanbieter, Assets, Uhr und Betriebsmodus
hinein; SVG/Diagnosen heraus. Keine eigenen HTTP-, SignalR- oder Steuerungsaufrufe.

**Abnahme:** Deterministische Zeit-/Renderingtests, Qualitätsfälle und alle
LiDAR-Aufteilungen; Fehler bleiben eingegrenzt. Gestalten, Scrubbing, Vorschau
und Fahreransicht verwenden dieselbe vereinbarte Semantik.

## AP09 – Editor-Grundlage, Zustand und Speicherung ✅

**Status (2026-11-02):** umgesetzt in `Client/src/components/overlay/editor/`
(`core/`, `persistence/`, `canvas/`, `testing/`, `overlay-editor.tsx`, README).
- **Kern:** `EditorStore`, Befehle als einziger Änderungsweg, auch für
  Varianten. Undo/Redo mit 200 Schritten, Transaktionen (ein Drag ist ein
  Schritt), Subscription-API. Befehle mit neuen Strukturfehlern werden
  abgelehnt.
- **Gestaltungsfläche** (`OverlayEditor`) über AP08 im Gestaltungsmodus:
  Auswahl/Mehrfach-/Rahmenauswahl, Griffe und numerische Felder, Gruppen,
  Ebenen, Sperren, Ausblenden, Duplizieren, Ausrichten/Verteilen, Zoom/Pan,
  Raster mit Einrasten.
- **Varianten:** Vererbungsindikatoren, Rücksetzen, Anlegen/Deaktivieren/
  Löschen, Zuordnen verwaister Varianten; Löschfolgen über AP01 bestätigt.
- **Speichern:** Autosave per PATCH (PUT als Rückfall, gzip), sechs
  Statuszustände, Sicherungen in IndexedDB (D72), Konflikt mit Download und
  Serverstand, Kontrollverlust ohne Serverzugriffe.
- **Tests:** Vitest gegen Testdoubles und live gegen lokalen Server mit
  Test-DB (zwei Tabs, Reconnect, Kontrollwechsel, Neustart). Die
  Zeigerbedienung im Browser prüft AP14.
- **Für AP13 Teil 2:** Route, Steuerungspause, Assets, Kontrollstatus und
  Texte einbinden.

**Ziel:** Ein gemeinsamer, klar kontrollierter Dokumentzustand mit vollständigen
Gestaltungswerkzeugen und sicherer Speicherung.

**Lieferumfang:**

- Zentraler Editorzustand und Befehlsschnittstelle für alle weiteren Editorpakete.
- Gestaltungsfläche mit angehaltener Animation, Auswahl, numerischer/Griff-
  Transformation, Mehrfachauswahl, Gruppen, Ebenen, Sperren, Ausblenden,
  Duplizieren, Ausrichten/Verteilen, Zoom/Pan und optionalem Raster/Snapping.
- Variantenbearbeitung, Vererbungsindikatoren, Rücksetzen und bestätigte
  Löschfolgen; Nutzung des Resolvers aus AP01.
- Undo/Redo sämtlicher Entwurfsänderungen; sinnvoll zusammengefasste Interaktionen.
- Autosave mit Statusanzeige über AP02-Port und browserlokale Wiederherstellung.
- Kontrollverlust: lokale Bearbeitung weiter möglich, Serverzugriffe blockiert.
- Konflikt: Autosave pausiert, Server gewinnt, lokaler Sicherungsdownload;
  Wiederherstellung nur bei unveränderter Ausgangsrevision.

**Schnittstellen:** Zustandslesen und definierte Editor-Befehle. AP10 bis AP12
dürfen keinen konkurrierenden Dokumentzustand oder eigene Autosave-Logik führen.

**Abnahme:** Gestaltungs- und Speicherfälle funktionieren gegen Testdoubles;
Undo/Redo, zwei Tabs, Reconnect, Kontrollwechsel und Neustart/Wiederherstellung
sind getestet. Produktive Integration nutzt AP02 und AP08.

## AP10 – Eigenschaften, Bindungen und Keyframe-Zeitachse ✅

**Status (2026-11-02):** umgesetzt in `Client/src/components/overlay/editor/`
(`inspector/`, `timeline/`), eingebunden in `OverlayEditor`.
- **Inspektor:** jede Katalogeigenschaft mit Herkunft (Standard/geerbt/
  überschrieben), Zurücksetzen und Grundwert; genau ein Steuerungsmodus je
  Eigenschaft, Wechsel entfernt fremde Treiber im selben Undo-Schritt (D12).
- **Bindungen:** einfache Kanalbindung ohne Formel mit Einheit/Dezimalstellen,
  optionales Formelfeld mit Live-Analyse über AP06 und Live-Wert, Glättung,
  Rate mit Umbruch. LiDAR-Widgetparameter getrennt von Quellparametern.
- **Zeitachse:** unabhängige Clips (Dauer, Wiederholung, Endzustand,
  Deaktivierung), Auslöser `auto`/`whileTrue`/`pulse` mit geprüfter
  Bedingung, Spuren und Keyframes mit Easing; Varianten überschreiben und
  setzen zurück. Scrubbing über AP08 `baseFrame(scrub)`, kein Dokumentinhalt.
- **Tests:** Befehle, Undo-Gruppierung, Varianten, Formeln, Keyframe- und
  Scrubbing-Logik, UI-Smoke. Ziehen und Scrubben im Browser prüft AP14.
- **Für AP13 Teil 2:** Texte und Verdrahtung mit dem echten Provider.

**Ziel:** Dynamik vollständig editierbar machen, ohne den Editor-Kern zu duplizieren.

**Lieferumfang:**

- Eigenschaftsinspektor entsprechend Property-Katalog, einschließlich geerbt,
  überschrieben und zurücksetzbar.
- Kanalauswahl mit Einheit/Dezimalstellen und optionalem Formelfeld.
- Live-Formelprüfung und Diagnose über AP06, auch im Gestaltungsmodus.
- Auswahl genau eines Steuerungsmodus je Eigenschaft und Glättungsoptionen.
- Unabhängige Clips/Spuren, Keyframes, Dauer, Easing, Wiederholung,
  Aktivitätsbedingungen, Impulsauslöser und Deaktivierungsverhalten.
- Gezieltes Scrubbing im Gestaltungsmodus über AP08-/AP09-Schnittstellen.
- LiDAR-Widgetparameter einschließlich Sektorenanzahl, Farbe, Nahzone,
  Blinkfrequenzen und Nachleuchtdauer; quellseitige Parameter bleiben getrennt.

**Abnahme:** Sämtliche Änderungen laufen über Editor-Befehle und sind undo-fähig.
Keine verdeckten Animationskonflikte, keine zweite Formelengine und keine eigene
Speicherung. Einfache Bindungen benötigen keine selbst geschriebene Formel.

## AP11 – Lokale Simulation und Vorschau ✅

**Status (2026-11-02):** umgesetzt in `Client/src/components/overlay/preview/`.
- **Vorschau-Modus:** `PreviewSession` schaltet zwischen Gestaltung und
  laufender Vorschau um; jeder Eintritt beginnt bei t = 0, Drag-and-drop ist
  in der Vorschau gesperrt. Gleiche AP08-Laufzeit im Modus `preview`.
- **Vorschau-Anbieter:** `PreviewSourceProvider` legt Overrides je Wert
  (`tel`/`out`/`sig`, `driverActive()`) über die Live-Quelle; Testmodus
  „Alle Werte simulieren“.
- **Generatoren:** fester Wert, Regler, Rampe, Sinus, synthetisches
  LiDAR-Raster im Drahtformat; Fehler fehlend/ungeprüft/ungültig/veraltet,
  bewertet über dieselbe Funktion wie echte Werte.
- **Zeit:** `PreviewClock` mit Pause, Schritt, 0,1×–4× und Neustart.
- **Trennung:** Simulierte Werte erzeugen keinen Bedarf, keine Schreibaufrufe,
  keine Präferenzänderung und keine Fahrzeugbefehle; Einstellungen sind kein
  Dokumentinhalt. Nachgewiesen gegen den echten AP05-Anbieter mit
  protokollierendem Hub und einer statischen Prüfung der Importe.
- **Für AP13 Teil 2:** Seite mit `OverlayEditorWithPreview`, Video im
  `videoLayer`, Texte. Browser- und Leistungstest in AP14.

**Ziel:** Alle dynamischen Funktionen ohne bewegtes Fahrzeug oder wechselnde
Sensorwerte prüfen können.

**Lieferumfang:**

- Umschalten zwischen Gestaltungs- und laufendem Vorschau-Modus.
- Lokaler Vorschau-Telemetrieanbieter mit kanalweisen Overrides und kompletter
  Testversorgung; übrige Werte bleiben live.
- Feste Testwerte, Regler, Rampe/Sinus, Qualitäts-/Altersfehler und synthetische
  LiDAR-Daten nach dem vereinbarten Vertrag.
- Kontrollierbare Zeit für reproduzierbare Vorschau-/Testverläufe.
- Vorschau mit echtem Stream, wenn verfügbar; kein Drag-and-drop-Gestalten
  während der laufenden Vorschau.

**Abnahme:** Tests weisen nach, dass Simulation keine echten Telemetrie-
Schreibaufrufe, Änderungen persönlicher Kanalpräferenzen oder Fahrzeugbefehle
auslöst. Keine simulierten Werte gelangen in den gemeinsamen Livebestand.

## AP12 – Vorlagen und vollständiger Paketaustausch ✅

**Status (2026-11-02):** umgesetzt.
- **Vorlagen** (`Client/src/components/overlay/templates/`): Kompass,
  Pitch/Roll, Kettenlauf, Abstandswarnung und LiDAR-Raster mit optionalem
  Sweep. Einfügen als ein Undo-Schritt; jeder Eingang braucht einen
  vorhandenen Kanal passenden Typs und eine ausdrückliche Umrechnung, keine
  erfundenen Werte.
- **Export** (`Client/src/components/overlay/exchange/`): Standard,
  Varianten, Bindungen, Raten, Clips und alle referenzierten Assets; keine
  Revision, Livewerte, Benutzer- oder Berechtigungsdaten.
- **Import nur als Entwurf:** Paketprüfung, Strukturprüfung (AP01), erneute
  Serverbereinigung jedes Assets über den bestehenden Upload, Zuordnung von
  Kanälen/Ausgängen/Streams (Formeln über den AST), `replaceDocument`
  (undo-fähig). Ungelöste aktive Referenzen blockieren die Veröffentlichung
  in Client und Server.
- **Konfliktsicherung:** nutzt den AP09-Download; Sicherungen lassen sich als
  Entwurf importieren.
- **Tests:** Rundlauf Export → Import mit Assets (Fixture
  `fixtures/exchange/roundtrip.json`, Vitest und xUnit), Zuordnung,
  Sperre, Grenzen, `__proto__`; Vorlagen gültig und ohne Diagnosen;
  Asset-Rundlauf mit echter Bereinigung gegen SQLite und PostgreSQL.
- **Für AP13 Teil 2:** `PackageExchange` und `TemplateInserter` in den Editor
  einhängen, Texte übernehmen. Browserprüfung der Dialoge in AP14.

**Ziel:** Fertige Startpunkte und übertragbare, vollständige HUD-Designs anbieten.

**Lieferumfang:**

- Editierbare Vorlagen für Kompass, Pitch/Roll, Kettenlauf, Abstandswarnung und
  LiDAR-Raster mit optionalem Sweep.
- Einfügen über Editor-Befehle mit Kanal-/Umrechnungszuordnung; keine erfundenen
  Sensorwerte und keine neue Hardwareansteuerung.
- Export von Standard, Varianten, Bindungen, Animationen und benötigten Assets.
- Keine Livewerte, persönlichen Sichtbarkeitspräferenzen, Berechtigungen oder
  Zugangsdaten im Paket.
- Sicherer Import ausschließlich als Entwurf; Kanal-/Stream-Zuordnung beim
  Fahrzeugwechsel und verständliche ungelöste Referenzen.
- Einbindung der normalen SVG-/Dokumentprüfung und sinnvoller lokaler
  Sicherungsexport bei Speicherkonflikten.

**Abnahme:** Rundlauf Export → Import erhält das Design einschließlich Assets.
Fremde Fahrzeugreferenzen lassen sich zuordnen; ungelöste aktive Referenzen
blockieren Veröffentlichung. Es wird kein bestimmtes Archivformat vorausgesetzt.

## AP13 – Video-, Steuerungs- und Anwendungsintegration ✅

**Status (2026-11-02):** umgesetzt (Teil 1 Anzeigeseite, Teil 2 Editorseite).

Teil 1 – Anzeigeseite:
- **HUD im Video** (`Client/src/components/overlay/integration/`): Die Ebene
  liegt exakt auf dem dargestellten `object-contain`-Frame (Resize,
  Vollbild), die Letterbox bleibt frei. Effektive Variante je `StreamId`;
  persönliches Ein-/Ausblenden browserlokal je Fahrzeug; Container-Vollbild.
- **Veröffentlichung:** `GET published` inklusive Asset-Metadaten,
  `OverlayPublished` mit Abgleich nach Reconnect; Assets vor dem Umschalten
  laden, Fehler lassen den bisherigen Stand weiterlaufen. Video unberührt.
- **Steuerungsanzeige:** `ControlDisplayPublisher` an der Fahrerverbindung,
  gespeist aus dem Flow-Store; neuer Flow-Knoten „HUD-Signal“; Pausenhinweis
  für alle Betrachter. Nach einem Hub-Reconnect bindet `ResumeCarControl` die
  neue Verbindung per Session-Hash neu (Steuerbefehle unverändert).
- **Kanalverwaltung:** `LidarSourceSetup`, Datentyp LidarGrid, Löschwarnungen
  über `GET dependencies`; Testseite ohne Telemetrie-Altpfad.
- **Übersetzungen:** Overlay-Texte zentral unter `messages.overlay`.
- **Nebenbei behoben:** `ServerId` beim Steuerkanal-Push.
- **Grenzen:** Trennt sich das Onboard, kann die Steuerungsanzeige erst nach
  erneutem Erwerben weiterlaufen. Browser-/Layoutprüfung (u. a. iOS-Vollbild)
  in AP14.

Teil 2 – Editorseite:
- **Route** `/car/[carId]/overlay` (`integration/editor-page.tsx`), erreichbar
  über „HUD“ in der Fahrzeugsteuerung und die Flow-Seite.
  `OverlayEditorWithPreview` mit echter Persistenz, Ereignissen, Streams,
  Kanalkatalog, AP06-Analyse und Live-Quelle; die Vorschau liegt exakt auf dem
  Videoframe (eigene Janus-Verbindung der Editorseite).
- **Berechtigung:** Verwaltung nur bei regulärem Login und als aktiver Fahrer;
  `403 OVL_API_NOT_DRIVER` schaltet auf „nur lokal“, die lokale Arbeit geht
  weiter.
- **Werkzeuge:** Vorlagen, Paketaustausch und SVG-Import-Dialog (Upload →
  bereinigte Vorschau → Bestätigung → ein Undo-Schritt).
- **Veröffentlichen/Verlauf:** mit Notiz und Serverhinweisen; vorher wird
  gespeichert und genau die bestätigte Revision veröffentlicht. Restore als
  Entwurf erst nach Bestätigung.
- **Steuerungspause:** Öffnen des Editors pausiert Senden und Wiederholungen
  (`editorPaused`); nur ein ausdrückliches Einschalten (Live-Test) gibt frei,
  ein Banner zeigt den Zustand. Tastenereignisse erreichen bei offenem Editor
  keine fensterweiten Fahrzeug-/PTT-Handler.
- **Übersetzungen:** alle Modultexte unter `messages.overlay`.
- **Integrationsnachweis M2:** Live-Test gegen lokalen Server mit Test-DB:
  Zahlenwert und Drehung bearbeitet, gespeichert, veröffentlicht; zweiter
  Client übernimmt ohne Reconnect; nach Kontrollverlust verweigert der Server
  das Speichern (403), der Editor behält die Änderung lokal.
- **Offen für AP14:** Browserprüfung von Seite, Video-Vorschau, Dialogen und
  Tastatur.

**Ziel:** Die unabhängig entwickelten Module früh und schrittweise in die
bestehende Anwendung einbinden; kein einmaliger Integrationsversuch erst am Ende.

**Lieferumfang:**

- HUD-Ebene passend zum tatsächlich dargestellten Videoframe, Resize und
  proportionalem vollständigem Einpassen; keine Letterbox-Überdeckung.
- Auswahl effektiver Stream-Variante, lokale Sichtbarkeit je Fahrzeug und
  unabhängige bisherige Stream-Statusanzeige.
- Container-Vollbild, ohne Zusage für natives Nur-Video-Vollbild/PiP.
- Aktuelle Veröffentlichung laden, Ereignisse und Reconnect abgleichen,
  konsistent übernehmen, Video-/Audioverbindung dabei unangetastet lassen.
- Editorroute/-navigation, berechtigtes Laden und lokale Weiterarbeit nach
  Kontrollverlust; Aktivierungs-/Veröffentlichungs-/Verlaufsoberfläche.
- Steuerwert-Senden/Wiederholungen beim Öffnen pausieren, bewusste Testfreigabe,
  keine automatische Reaktivierung; Editor-Tastatur von Fahrbefehlen trennen.
- Kanalverwaltungswarnungen aus AP02 und neue Quellkonfigurationshilfe einbinden.
- Zentrale Anwendungsverdrahtung, Registrierungen und gemeinsame Übersetzungen;
  Modulregistrierungen/-texte kommen von den zuständigen Paketen.
- Berechnete Fahrzeugausgänge und ausdrücklich benannte Eingabe-/Flow-Signale
  lesend anbinden, persönliche Signalzuordnung in die Flow-Oberfläche integrieren
  und den Pausenstatus auch Zuschauern eindeutig anzeigen. Keine automatische
  Reaktivierung oder Neuberechnung durch HUD-Lesen.

**Frühester Integrationsnachweis:** Ein Zahlenwert plus Drehung wird bearbeitet,
gespeichert und veröffentlicht. Ein zweiter offener Client übernimmt den Stand
ohne Video-Neuverbindung. Nach Kontrollverlust wird Speichern serverseitig
verweigert. Danach folgen weitere Funktionen inkrementell.

**Abnahme:** Alle integrierten Module verwenden reale Implementierungen,
Fehlzustände bleiben kontrolliert und Video/Steuerung funktionieren unverändert.

## AP14 – Übergreifende Abnahme ◐

**Status (2026-11-02):** umgesetzt ohne Browser-Automatisierung (Entscheidung
des Auftraggebers); Bericht in [Overlay-Abnahme.md](Overlay-Abnahme.md).
- **Übergreifende Tests** (`Client/src/components/overlay/acceptance/`,
  `Tests/SignalRC.Overlay.Tests/Acceptance/`): zwei Tabs, Kontrollwechsel,
  Konflikt, Wiederherstellung, Veröffentlichen/Restore, historische Assets,
  Reconnect mit verpasster Veröffentlichung, fehlerhafte Konfiguration,
  unbekannte Schemaversion, Quellqualität bis in die Laufzeit (D71),
  Simulation ohne Befehle.
- **Sicherheit:** 74 Missbrauchsformeln (Client und Server gleich), 23
  feindliche SVGs über den echten Upload, feindliche Pakete,
  Berechtigungsmatrix, D56/D57/D69/D70 an echten Hub-Methoden.
- **Leistung/Bandbreite (S09):** R2 Fahrt 4,2 kB/s plus LiDAR 1,7 kB/s,
  Stillstand 0,44 kB/s, ohne Bedarf 0; Frame-p95 in Node R1 0,08 ms, R2
  ≤ 0,6 ms, R3 ≤ 5,4 ms; kein Heap-Wachstum über 10 min, 0 Frames in Pause.
- **CI:** `scripts/overlay-check.sh` (Live-Tests nur mit Env,
  `--start-server`, `--perf`); GitHub-Workflow ohne Live-Tests (nicht
  gepusht).
- **Behoben:** unlesbare Asset-Metadaten blockierten Speichern und
  Veröffentlichen.
- **Offen:** Live-Lauf `acceptance/live-acceptance.test.ts`, manuelle
  Browser-Checkliste (Abnahme §6), Hardware (D58, Sensorpfade), Update der
  MessagePack-/SignalR-Pakete (NuGet-Warnungen).

**Ziel:** Die Produktregeln über Modulgrenzen hinweg absichern und Regressionen
in Video/Steuerung verhindern.

**Lieferumfang:**

- Tests für zwei Clients/Tabs, Kontrollwechsel, Autosave-Konflikte, lokale
  Wiederherstellung, Veröffentlichungen, Restore und unveränderliche Assets.
- SignalR-Reconnect, verpasste Veröffentlichung, fehlerhafte Konfiguration und
  unbekannte Schema-/Quellunterstützung.
- Browser-/Layouttests für tatsächliche Videofläche, mobile Anzeige,
  unterschiedliche Arbeitsflächen und Container-Vollbild.
- Sicherheitsfälle für Formeln, SVGs und Paketimport einschließlich Limits.
- Automatisierte Vorschau-/Simulationsprüfung ohne echte Fahrzeugbefehle.
- Referenz-HUDs und Leistungs-/Bandbreitentests nach AP00, einschließlich
  LiDAR-Aufbereitung, unsichtbarer Animation und Auswirkungen auf Video/Steuerung.
- Test-/CI-Anbindung; dokumentierte Ergebnisse und verbleibende Einschränkungen.

**Abnahme:** Alle Pakettests und übergreifenden Kriterien aus dem Gesamtplan
bestehen. Hardware-/Vor-Ort-Tests erfolgen nur nach gesonderter Vereinbarung;
ein Rollout ist nicht Bestandteil dieser automatischen Abnahme.

## Gemeinsame Schnittstellen vor Parallelstart

Die folgenden Rollen sind in AP00 konkret zu typisieren. Dies sind noch keine
festgelegten Programmier-Symbolnamen oder HTTP-Pfade.

| Schnittstelle | Liefert | Nutzer |
| --- | --- | --- |
| Dokumentauflösung/-prüfung | Effektive Konfiguration, aktive Teile, strukturierte Diagnosen | Server, Editor, Laufzeit, Paketaustausch |
| Ausdruckssystem | Analyse, Kanalreferenzen, Typen, Auswertung und Fehler | Serverprüfung, Laufzeit, Bindungseditor |
| Telemetrieanbieter | Typisierte Werte, Metadaten, Qualität/Alter und Verbraucherlebenszyklus | Laufzeit, Editor, lokale Vorschau |
| Uhr/Zeitsteuerung | Kontrollierbare Zeit und definierte Unterbrechungsregeln | Animationen, Simulation, Tests |
| Renderer | SVG und Laufzeitdiagnosen aus Konfiguration/Daten/Assets/Modus | Fahransicht, Gestaltungsfläche, Vorschau |
| Editor-Befehle | Einziger Änderungsweg zum Entwurf mit Undo/Redo | Gestaltungswerkzeuge, Inspektor, Zeitachse, Import, Vorlagen |
| Persistenz/Veröffentlichung | Revisionen, Berechtigung, Konflikte, Verlauf und aktuelle Veröffentlichung | Editor, Integrationsschicht, Austausch |
| Asset-Verarbeitung | Bereinigte normalisierte Geometrie, IDs und Importbericht | Server-Assetablage, Importdialog, Renderer, Austausch |
| LiDAR-Quelle | Kompaktes Grundraster, Geometrie-/Qualitätsmetadaten | Telemetrie, Widget, Simulation und Tests |

Der Vertrag definiert auch, wie Fehler/Diagnosen adressiert werden, damit
Element, Eigenschaft, Variante oder Quelle gezielt im Editor auffindbar sind.

## Dateiverantwortung und Integrationsregeln

AP00 bestätigt die konkreten Pfade vor Implementierungsbeginn. Neue Module
sollen in eigenen Unterverzeichnissen liegen, passend zur vorhandenen Struktur,
etwa unter `Client/src/components/overlay/`, `Server/Overlay/`,
`Shared/Overlay/` sowie bestehenden Onboard-Telemetrieverzeichnissen.

| Bereich / bestehende Datei | Schreibverantwortung |
| --- | --- |
| Gemeinsame Modelle, Schemas und Verträge | AP00; spätere Änderungen nur koordiniert. |
| Resolver-/Prüfmodule | AP01, getrennt von UI und Datenbank. |
| Overlay-Entitäten, Datenbankkontext und zugehörige Migrationen | AP02; keine parallelen konkurrierenden Migrationen. |
| Reader-Basis, Telemetrie-Service und Qualitätsweiterleitung | AP03. |
| Neue LiDAR-Aufbereitung und isolierte Quellkonfigurationshilfe | AP04. |
| `Client/src/components/telemetry-store.ts` und manuelle Telemetrieanzeige | AP05. |
| Ausdrucks-, Asset-, Laufzeit- und Editor-Unterverzeichnisse | Jeweils AP06 bis AP12, mit getrennten Zustands-/UI-Modulen. |
| `video-stream.tsx`, `car-video-panel.tsx`, neue Editorroute und zentrale UI-Einbindung | AP13. |
| Zentrale Hub-/Programmverdrahtung, Steuerungsintegration und gemeinsame Übersetzungen | AP13; AP00 darf notwendige Gerüständerungen vorher koordiniert setzen. |
| Kanalverwaltung | Backendwarnungen AP02; neue Quellhilfen AP04; gemeinsame Seiten-/UI-Verdrahtung AP13. |
| Übergreifende Tests und CI-Einbindung | AP14; Modultests bleiben beim jeweiligen Paket. |

Für Hub-/Programmverdrahtung liefern Module eigene Implementierungen und
Registrierungsbausteine, statt gleichzeitig dieselben großen zentralen Dateien
umzuschreiben. Übersetzungstexte werden ebenfalls gesammelt eingebunden.

Vertragsänderungen dürfen nicht nur in einem Verbraucher angepasst werden.
Änderungsvorschlag, betroffene Pakete, aktualisierte Referenzfälle und eine
gemeinsame Freigabe gehören zusammen. Fremde/unabhängige Änderungen im
Arbeitsverzeichnis werden nicht überschrieben oder zurückgesetzt.

## Integrationsreihenfolge und Meilensteine

1. **M0 – Vertragsfreigabe ✅:** AP00 abgeschlossen, Testdoubles und Beispiele
   nutzbar, Eigentümer zentraler Dateien benannt.
2. **M1 – Parallele Module:** AP01 bis AP12 gegen feste Ports; AP13/AP14 begleiten
   die ersten nutzbaren Pfade. Keine feste Anzahl paralleler Bearbeiter.
3. **M2 – Kleiner durchgängiger Pfad ✅:** Entwurf, ein Wert, eine Drehung,
   Veröffentlichung, zweiter Client, Kontrollverlustprüfung.
4. **M3 – Erweiterte Integration:** Varianten/Deaktivierung, sichere SVGs,
   Bindungen/Clips, vollständige Bearbeitung und lokale Simulation.
5. **M4 – Zielumfang vollständig:** LiDAR-Gruppen/Raster einschließlich
   konfigurierbarer Aufteilung, Vorlagen, Pakettransfer, Verlauf/Restore und
   Ausfall-/Kompatibilitätsverhalten integriert.
6. **M5 – Abnahme (◐, Browser/Hardware manuell offen):** Modultests, Browser-/Sicherheits-/Leistungsnachweise,
   dokumentierte Grenzen, keine offenen produktiven Platzhalter.

Die Meilensteine priorisieren Integrationsnachweise. Sie verschieben nicht
stillschweigend vereinbarte Funktionen in einen späteren Produktumfang.

## Definition of Done pro Paket

- Vereinbarter Lieferumfang und Schnittstellen eingehalten, Abnahmekriterien
  getestet und Ergebnisse dokumentiert.
- Eigene Modultests einschließlich relevanter Fehler-/Grenzfälle vorhanden.
- Keine neue unkoordinierte Semantik, keine konkurrierende Speicherung oder
  Telemetrieverbindung und keine neuen unvereinbarten Laufzeitabhängigkeiten.
- Keine aktivierten Testdoubles oder Simulation im produktiven Livepfad.
- Nur zuständige Dateien geändert; notwendige Integrationsänderungen über den
  benannten Besitzer abgestimmt.
- Bei Codeänderungen betroffene Projekte bauen; vor späterem Rollout gelten
  zusätzlich alle Vorprüfungen aus `AGENTS.md`.
- Änderungen lokal gemäß Repository-Regeln committed; kein automatisches
  Deployment auf `lte-rc-server` oder `lte-truck`.
- Destruktive Aktionen und Hardware-/Vor-Ort-Eingriffe nicht ohne ausdrückliche
  Zustimmung durchführen.

## Bewusst noch offene technische Entscheidungen

Erledigt mit AP00 (S01–S09); Änderungen seither stehen im Änderungsprotokoll von
[Overlay-AP00-Vertraege.md](Overlay-AP00-Vertraege.md). Ursprünglicher Auftrag:
AP00 musste insbesondere konkrete Formelsyntax, Clip-Zustandsübergänge,
Schema-/API-Feldnamen, Zeitbasis und exakte Fristen, SVG-Teilmenge/Limits,
LiDAR-Drahtformat/-Rate/-Filteranbindung, Quellkanal-Provisionierung,
Austauschformat und Referenz-Leistungsbudget festschreiben.

Das sind keine Freigaben für beliebige Paketentscheidungen. Die abgestimmten
Produktregeln, Standardwerte und verworfenen Alternativen aus
[Overlay-Feature.md](Overlay-Feature.md) bleiben dabei verbindlich.
