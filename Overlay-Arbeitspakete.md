# Fahrzeug-Overlay: Arbeitspakete und Parallelisierung

Stand: 2026-11-01. Status: Planung; kein Arbeitspaket ist damit implementiert
oder abgenommen. AP00 ist am 2026-11-01 freigegeben (S01–S09, D01–D58);
M0 folgt mit T0 (Testgerüste).

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

| ID | Ergebnis / Zuständigkeit | Reale Zulieferer zur Integration |
| --- | --- | --- |
| AP00 | Vertragsfundament, Referenzfälle, Modulgerüste und Schreibzuständigkeiten | Keine; setzt den abgestimmten Gesamtplan um. |
| AP01 | Variantenauflösung und strukturelle Dokumentprüfung | AP00-Verträge. |
| AP02 | Serverpersistenz, Revisionen, Berechtigungen und Veröffentlichung | AP01, AP06, AP07. |
| AP03 | Telemetriequalität, Reader-Anbindung und Servertransport | AP00-Verträge; Anwendungsverdrahtung über AP13. |
| AP04 | LiDAR-Gruppen und kompaktes Winkel-/Distanzraster | AP03 für Qualität und Transport. |
| AP05 | Client-Telemetrie, Metadaten, Alterung und Verbraucher | AP03; LiDAR-Daten aus AP04. |
| AP06 | Sicheres Ausdruckssystem in Client und Server | AP00-Verträge. |
| AP07 | SVG-Bereinigung, normalisierte Assets und Importvorschau | AP00-Verträge; Speicherung/HTTP-Anbindung über AP02/AP13. |
| AP08 | SVG-/Animationslaufzeit und LiDAR-Widget | AP01, AP05, AP06, AP07. |
| AP09 | Editorzustand, Gestaltungsfläche, Undo/Redo und Autosave | AP01, AP02, AP08. |
| AP10 | Eigenschaften, Bindungen und Keyframe-Zeitachse | AP06, AP08, AP09. |
| AP11 | Lokale Simulation und dynamische Vorschau | AP05, AP08, AP09. |
| AP12 | Startvorlagen, Paket-Import/-Export und Zuordnung | AP01, AP02, AP07, AP09. |
| AP13 | Video-, UI-, Steuerungs- und Anwendungsintegration | Verbindet AP01 bis AP12 schrittweise. |
| AP14 | Browser-, Sicherheits-, Reconnect- und Leistungsabnahme | Gemeinsame Referenzfälle und integrierbare Funktionspfade. |

## AP00 – Vertragsfundament und Freigabe-Gate

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

## AP01 – Variantenauflösung und Dokumentprüfung

**Status (2026-11-02):** umgesetzt in TS (`Client/src/components/overlay/document/`)
und C# (`Server/Overlay/Documents/`), beide gegen dieselben Fixtures getestet
(Vitest, xUnit). Formelprüfung bis AP06 nur über ein Testdouble; die Einbindung
in Speichern und Veröffentlichen erfolgt mit AP02.

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

## AP02 – Serverpersistenz, Berechtigungen und Veröffentlichung

**Status (2026-11-02):** umgesetzt in `Server/Overlay/` mit Migration
`AddOverlay`. Getestet gegen SQLite (xUnit), noch nicht gegen PostgreSQL. Offen:
- Abhängigkeitsauskunft für die Kanalverwaltung (braucht AP06).
- Formelprüfung beim Veröffentlichen (AP06; bis dahin D66).
- SVG-Upload (AP07; bis dahin D67).

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

## AP03 – Quellqualität und rückwärtsverträgliche Telemetrie

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

## AP04 – LiDAR-Gruppen und kompaktes Grundraster

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

## AP05 – Client-Telemetrie und Verbrauchertrennung

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

## AP06 – Sicheres Ausdruckssystem

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

## AP07 – SVG-Assets und Importvorschau

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

## AP08 – SVG-/Animationslaufzeit und LiDAR-Widget

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

## AP09 – Editor-Grundlage, Zustand und Speicherung

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

## AP10 – Eigenschaften, Bindungen und Keyframe-Zeitachse

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

## AP11 – Lokale Simulation und Vorschau

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

## AP12 – Vorlagen und vollständiger Paketaustausch

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

## AP13 – Video-, Steuerungs- und Anwendungsintegration

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

## AP14 – Übergreifende Abnahme

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

1. **M0 – Vertragsfreigabe:** AP00 abgeschlossen, Testdoubles und Beispiele
   nutzbar, Eigentümer zentraler Dateien benannt.
2. **M1 – Parallele Module:** AP01 bis AP12 gegen feste Ports; AP13/AP14 begleiten
   die ersten nutzbaren Pfade. Keine feste Anzahl paralleler Bearbeiter.
3. **M2 – Kleiner durchgängiger Pfad:** Entwurf, ein Wert, eine Drehung,
   Veröffentlichung, zweiter Client, Kontrollverlustprüfung.
4. **M3 – Erweiterte Integration:** Varianten/Deaktivierung, sichere SVGs,
   Bindungen/Clips, vollständige Bearbeitung und lokale Simulation.
5. **M4 – Zielumfang vollständig:** LiDAR-Gruppen/Raster einschließlich
   konfigurierbarer Aufteilung, Vorlagen, Pakettransfer, Verlauf/Restore und
   Ausfall-/Kompatibilitätsverhalten integriert.
6. **M5 – Abnahme:** Modultests, Browser-/Sicherheits-/Leistungsnachweise,
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

AP00 muss insbesondere konkrete Formelsyntax, Clip-Zustandsübergänge,
Schema-/API-Feldnamen, Zeitbasis und exakte Fristen, SVG-Teilmenge/Limits,
LiDAR-Drahtformat/-Rate/-Filteranbindung, Quellkanal-Provisionierung,
Austauschformat und Referenz-Leistungsbudget festschreiben.

Das sind keine Freigaben für beliebige Paketentscheidungen. Die abgestimmten
Produktregeln, Standardwerte und verworfenen Alternativen aus
[Overlay-Feature.md](Overlay-Feature.md) bleiben dabei verbindlich.
