# Dynamisches Fahrzeug-Overlay im Web Client

Stand: 2026-11-01, nach gemeinsamer Entscheidungsabfrage.

## Status und Dokumentstruktur

Dieses Dokument enthält das abgestimmte Produktziel, die verbindlichen
Verhaltensregeln und den gesamten Umsetzungsvorschlag. Es ersetzt den früheren,
weniger konkreten Entwurf. Noch offene technische Festlegungen sind ausdrücklich
unter **AP00** aufgeführt; konkrete Endpunkte, Tabellen und Drahtformate sind
damit noch nicht implementierungsfertig spezifiziert.

Die zugehörigen Arbeitspakete mit Zuständigkeiten, Schnittstellen, Abhängigkeiten
und Abnahmekriterien stehen in
[Overlay-Arbeitspakete.md](Overlay-Arbeitspakete.md). Dieses Dokument ist für
Produktregeln maßgeblich; die Paketübersicht beschreibt deren Umsetzung.

## Ziel und Umfang

Der Web Client soll ein individuell gestaltbares HUD über dem Videostream eines
Fahrzeugs anzeigen. Das HUD bezieht Live-Telemetrie ein und unterstützt direkte
Datenbindungen, integrierte Bewegungen und zeitbasierte Animationen. Beispiele
sind Kettenlauf, Kompass, Pitch/Roll-Lageanzeige, Abstandswarnungen und eine
LiDAR-Draufsicht mit optionalem Sweep-Effekt.

Zum ersten Umfang gehören ein vollständiger Desktop-Editor, mobile HUD-Anzeige,
Stream-Varianten, Entwurf/Veröffentlichung, Versionsverlauf, sichere SVG-Assets,
Live-/Simulationsvorschau, Startvorlagen und vollständiger Paket-Import/-Export.
Die reduzierte LiDAR-Rasterdarstellung ist ausdrücklich Teil dieses Umfangs;
eine echte Punktwolke ist es nicht.

Das HUD dient der Fahrerinformation. Es ersetzt keine fahrzeugseitige
Sicherheits-, Kollisionsschutz- oder Not-Aus-Funktion. Blasse oder nicht belegte
LiDAR-Felder sind insbesondere keine Garantie für freien Raum.

## Abgestimmte Produktentscheidungen im Überblick

- Pro Fahrzeug gibt es ein gemeinsames Standard-Overlay und optionale,
  darauf aufbauende Stream-Varianten.
- Ein veröffentlichter Stand wird standardmäßig angezeigt. Persönliches
  Ausblenden wird browserlokal je Fahrzeug gespeichert.
- HUD-Geometrie wird proportional vollständig in den tatsächlichen Videoframe
  eingepasst, nicht in Letterbox-Bereiche des Players gestreckt.
- Es gibt genau einen gemeinsamen serverseitigen Entwurf je Fahrzeug.
  Änderungen werden automatisch als Entwurf gespeichert; Veröffentlichung ist
  immer eine separate, ausdrückliche Aktion.
- Verwaltungszugriff hat genau der Sitzungsbenutzer, der die Steuerung des
  verbundenen Fahrzeugs aktuell hält (D73). Ein Login gibt es auf der Webseite
  nicht; den Fahrzeugzugang weist die SSH-Key-Challenge beim Steuerungserwerb
  nach. Eine zusätzliche Fahrzeug-Verwalterrolle wird nicht eingeführt.
- Nach Kontrollverlust darf am geladenen Stand lokal weitergearbeitet werden,
  aber nicht auf dem Server gespeichert oder veröffentlicht werden.
- Bei konkurrierenden Änderungen hat der Serverstand Vorrang. Es gibt weder
  stilles Überschreiben noch automatische Zusammenführung.
- Standard, Varianten und zugehörige Assets werden gemeinsam versioniert und
  veröffentlicht. Wiederherstellen lädt eine alte Veröffentlichung als Entwurf.
- Bereits offene Clients übernehmen neue Veröffentlichungen ohne Neustart der
  Videoverbindung; Wiederverbindungen gleichen die aktuelle Version erneut ab.
- Telemetrieabhängigkeiten des HUDs bleiben unabhängig von persönlichen
  Telemetrie-Schaltern. Quellzustand und Messalter werden automatisch geliefert.
- Möglichst keine neuen Laufzeitbibliotheken; zusätzliche Entwicklungs- und
  Testwerkzeuge sind erlaubt. Keine externen Dienste für Verarbeitung oder Assets.
- Die Umsetzung wird nach Modulgrenzen und Abhängigkeiten parallelisiert, nicht
  für eine feste Zahl gleichzeitiger Bearbeiter zugeschnitten.

## Technischer Ausgangspunkt im Repository

- `Client/src/components/video-stream.tsx` rendert Video und Stream-Status.
  Das Video verwendet derzeit `object-contain`.
- `Client/src/components/car-video-panel.tsx` verwaltet Fahrzeug und Stream.
  Bei inaktivem Tab wird die Video-Komponente derzeit ausgehängt.
- `Client/src/components/telemetry-store.ts` empfängt Textwerte über SignalR
  und übernimmt derzeit nur manuell ausgewählte Kanäle. `updatedAt` ist der
  Empfangszeitpunkt, nicht der Messzeitpunkt des Sensors.
- `/api/car/{id}/telemetry` liefert bereits Datentyp, Einheit und Dezimalstellen
  (`Server/Controllers/CarController.cs`). Im TypeScript-Kanalinterface des
  Telemetrie-Stores fehlen diese Metadaten bislang.
- `Onboard/Telemetry/TelemetryService.cs` sendet konfigurierte Kanäle bereits
  unabhängig von Nutzer-Abonnements. Die Onboard-Abonnementmethoden sind derzeit
  No-ops; serverseitiges `SubscribeToChannel` speichert persönliche Präferenzen.
  HUD-Abhängigkeiten dürfen diese Methoden nicht als automatische Nutzerauswahl
  verwenden.
- `Server/Hubs/CarConnectionHub.cs` verteilt Telemetrie an Fahrzeuggruppen.
  Neue Telemetrie-/Overlay-Schnittstellen müssen ihre Berechtigungen und die
  Herkunft von Onboard-Daten ausdrücklich prüfen; bestehende Zugriffe sind
  keine pauschal ausreichende Berechtigungsgrundlage.
- Eine einheitliche Fahrzeug-Verwalterrolle ist im geprüften Code nicht
  vorhanden. Für Stream-Verwaltung existierte die Prüfung auf regulären
  Login, Fahrzeugzugang und aktive Fahrzeugkontrolle; seit D73 gilt dort wie
  für das HUD: Verwalter ist, wer die Steuerung hält.
- Der Steuerungs-Store unterstützt Konfigurationsmodus und pausierte Updates.
  Dessen bisherige automatische Reaktivierung beim Verlassen darf nicht
  ungeprüft für den Overlay-Editor übernommen werden.
- LiDAR und CAN-Antrieb besitzen bereits Quellalter-/Health-Informationen;
  der Batterie-Reader hat einen Cache-Erfassungszeitpunkt. Diese Informationen
  sind Ausgangspunkt der erweiterten Telemetriequalität.
- Der bisherige LiDAR-Reader liefert unter anderem Sektorminima als Text.
  Daraus lassen sich zusammenhängende Rohmesspunktgruppen nicht rekonstruieren.
  Die neue Rasteraufbereitung muss deshalb Onboard vor dieser Reduktion ansetzen.

## Architektur und technische Leitplanken

### Deklarative Konfiguration und SVG-Laufzeit

Die Overlay-Beschreibung ist versioniert und deklarativ: Elemente, Gestaltung,
Bindungen, Formeln und Animationen sind Daten, kein beliebig ausführbarer Code.
SVG dient als Vektor-Renderer und Asset-Format. Importierte SVGs liefern
statische Geometrie; auswählbare Unterelemente erhalten Bindungen im Editor.

Dokumentauflösung, Ausdrucksauswertung, Zeitmodell, Telemetrieanbieter, Renderer
und Editorzustand werden getrennt. Der Renderer muss mit Testdaten und
kontrollierter Uhr ohne Video, SignalR oder Fahrzeug testbar sein. Editor und
Vorschau verwenden dieselbe Laufzeitsemantik wie die Fahreransicht.

Fehler im HUD dürfen Video und Fahrzeugsteuerung nicht beeinträchtigen.
Einzelne Laufzeitfehler bleiben möglichst auf betroffene Bindungen/Elemente
begrenzt. Eine insgesamt nicht verwendbare Konfiguration wird nicht aktiviert;
ein bereits funktionierender Stand kann mit Fehlermeldung weiterlaufen. Ohne
verwendbaren Stand bleibt das HUD aus. Unbekannte Schemaversionen dürfen nicht
unkontrolliert interpretiert werden.

### Bibliotheken

Neue Laufzeitabhängigkeiten sollen möglichst vermieden werden. Editorinteraktion,
Parser und Validierung werden soweit sinnvoll auf dem vorhandenen Stack
aufgebaut. Das ist kein Freibrief für unzureichende Sicherheitsprüfungen:
Ausdruckssystem und SVG-Import benötigen eng begrenzte Funktionalität und
umfangreiche Negativtests. Notwendige Ausnahmen vom Bibliotheksansatz werden
begründet abgestimmt. Entwicklungs- und Testabhängigkeiten dürfen ergänzt werden.

## Fahrzeug, Varianten und Darstellung

### Standard und Vererbung

- Der Standard bildet die gemeinsame Gestaltung; Varianten speichern nur
  stream-spezifische Abweichungen.
- Varianten dürfen Position, Größe, Gestaltung, Bindungen und Animationen
  überschreiben, geerbte Elemente ausblenden und eigene Elemente ergänzen.
- Nicht überschriebene Eigenschaften übernehmen Standardänderungen. Der Editor
  kennzeichnet geerbte/überschriebene Werte und ermöglicht das Zurücksetzen.
- Elemente besitzen stabile Identitäten, damit Bindungen, Varianten und Clips
  nicht von ihrer aktuellen Position in einer Liste abhängen.
- Beim Löschen eines Standard-Elements zeigt der Editor betroffene Varianten
  und entfallende Anpassungen an. Bei Gruppen sind auch betroffene
  stream-spezifische Unterelemente zu berücksichtigen. Erst nach Bestätigung
  werden Element und abhängige Anpassungen entfernt; Undo stellt die Aktion
  im Entwurf wieder her.
- Der aktive Stream bestimmt die effektive Konfiguration. Ohne Variante gilt
  der Standard. Eine ausdrücklich deaktivierte Variante bedeutet dagegen
  **kein HUD**, nicht Rückfall auf den Standard.
- Fahrzeugweites Deaktivieren und Deaktivieren einzelner Varianten erhält die
  Gestaltung. Die Änderung wirkt erst nach Veröffentlichung für alle.

### Arbeitsfläche und Video-Geometrie

Ein Overlay besitzt eine Referenz-Arbeitsfläche. Eine Variante kann eine eigene,
zur Kamera passende Arbeitsfläche erhalten. Bei abweichendem tatsächlichem
Video-Seitenverhältnis wird das HUD zentriert und proportional vollständig
eingepasst. Es wird weder verzerrt noch beschnitten. Eventuelle freie Randflächen
innerhalb des Videoframes bleiben transparent; Player-Letterbox-Bereiche bleiben
außerhalb des HUDs.

Die Laufzeit verwendet die tatsächlich empfangenen Videoabmessungen, nicht nur
die konfigurierte Kameraauflösung. Größenänderungen, Seitenverhältniswechsel
und Vollbild müssen dieselbe Ausrichtung bewahren. Das HUD darf normale
Maus-/Touch-Eingaben zur Fahransicht nicht unbeabsichtigt abfangen.

### Persönliche Sichtbarkeit und unterstützte Geräte

- Persönliches Ausblenden wird browserlokal **pro Fahrzeug** gespeichert und
  gilt für alle seine Streams. Neuladen und neue Veröffentlichungen setzen die
  Auswahl nicht zurück. Ohne gespeicherte Auswahl ist ein veröffentlichtes HUD an.
- Die bisherige Stream-Statusanzeige bleibt unabhängig davon ein-/ausblendbar.
- HUD-Anzeige: aktuelle Desktop- und Mobilbrowser. Vollständiger Editor:
  Desktop/Laptop mit Maus und Tastatur; komfortable Touch-Bearbeitung ist nicht
  Teil der ersten Abnahme.
- Normale Webansicht und Vollbild des gesamten Player-Containers werden
  unterstützt, soweit der Browser Container-Vollbild ermöglicht.
- Natives Nur-Video-Vollbild und gewöhnliches Picture-in-Picture enthalten ein
  darüberliegendes SVG nicht automatisch und sind nicht zugesichert.

## Berechtigungen und Bearbeitungsablauf

### Zugriff

Das veröffentlichte HUD darf jeder sehen, der den jeweiligen Fahrzeugstream
sehen darf. Entwurf und Versionsverlauf vom Server laden, serverseitig speichern,
veröffentlichen und wiederherstellen darf nur der Sitzungsbenutzer, der die
Steuerung des verbundenen Fahrzeugs gerade hält (D73) – kein Login, keine
Fahrzeugzuordnung. Fahrzeug offline oder Steuerung freigegeben/übernommen
bedeutet: kein Verwalter. Maßgeblich ist die serverseitig geprüfte aktuelle
Berechtigung, nicht ein alter Clientzustand. Eine aktive Fahrsitzung bleibt auch bei pausierter
Steuerwertübertragung die Berechtigungsgrundlage.

Nach Verlust/Abgabe der Kontrolle darf der bereits geöffnete lokale Entwurf
weiterbearbeitet werden. Neue Verwaltungsdaten werden nicht nachgeladen und
keine Änderungen auf dem Server geschrieben. Nach erneuter Kontrollübernahme
wird vor Fortsetzung des Speicherns die Serverrevision geprüft.

### Entwurf, Autosave und lokale Wiederherstellung

- Genau ein gemeinsamer serverseitiger Entwurf je Fahrzeug; ein späterer Fahrer
  kann den gespeicherten Stand fortsetzen.
- Nach kurzer Bearbeitungspause wird automatisch gespeichert. Der Editor zeigt
  ungespeichert, speichert, gespeichert sowie Fehler-/Konfliktzustände an.
- Entwurfsspeicherung und Veröffentlichung sind verschiedene Vorgänge.
  Unvollständige Formeln und noch nicht aufgelöste Referenzen dürfen im Entwurf
  bestehen bleiben, soweit Struktur und Sicherheit gewährleistet sind.
- Bei Kontrollverlust oder Verbindungsproblemen bleiben Änderungen lokal.
  Browserlokale Sicherungen lassen eine Wiederherstellung nach Neuladen oder
  Browser-Neustart zu.
- Eine Wiederherstellung zur Weiterbearbeitung wird nur angeboten, wenn die
  zugrunde liegende Serverrevision unverändert ist. Erneute Schreibzugriffe
  erfordern weiterhin aktive Fahrzeugkontrolle.
- Ist der Serverstand neuer, pausiert Autosave und der **Serverstand hat Vorrang**.
  Der lokale Stand kann zur Sicherung heruntergeladen werden, darf den neueren
  Entwurf aber nicht ersetzen. Keine automatische Zusammenführung.
- Diese Regel gilt auch für zwei Tabs desselben Fahrers. Lokale Sicherungen
  werden nicht stillschweigend verworfen.
- Undo/Redo gehört zum lokalen Entwurf und umfasst alle Entwurfsänderungen.
  Autosave ist kein Ersatz für Undo/Redo oder den Veröffentlichungsverlauf.

### Veröffentlichung und Versionsverlauf

Eine Veröffentlichung ist ein unveränderlicher Gesamtstand aus Standard,
sämtlichen Varianten und den dazugehörigen Asset-Versionen. Schema-Version,
Entwurfsrevision und Veröffentlichungsidentität sind getrennte Begriffe.

Veröffentlichen ist eine ausdrückliche Aktion. Offene Clients übernehmen den
neuen Stand ohne Video-Neuverbindung. Nach SignalR-Reconnect wird die aktuelle
Veröffentlichung erneut abgeglichen, damit verpasste Ereignisse nicht zu einem
dauerhaft alten HUD führen. Übernahme einer neuen Konfiguration erfolgt als
konsistenter Gesamtstand, nicht als Mischung verschiedener Veröffentlichungen.

Frühere Veröffentlichungen und ihre Assets bleiben erhalten. Wiederherstellen
ersetzt nach Bestätigung den gemeinsamen Entwurf durch die gewählte Version;
das aktuell angezeigte HUD bleibt zunächst unverändert. Erst eine neue
Veröffentlichung aktiviert diesen Stand. Historische Versionen werden dabei
nicht nachträglich verändert.

### Veröffentlichungsprüfung und Kanaländerungen

- Aktive Standard-/Stream-Ansichten und grundsätzlich aktive Elemente müssen
  auflösbare Kanalreferenzen, gültige Formeln und Eigenschaftstypen sowie
  verwendbare Varianten und Assets besitzen.
- Ein korrekt definierter, aber momentan ausgeschalteter/offline befindlicher
  Sensor blockiert nicht. Sein Zustand wird zur Laufzeit dargestellt.
- Ausdrücklich deaktivierte Teile dürfen fehlende Kanalreferenzen oder
  fehlerhafte Formeln mit Warnung behalten. Vor späterem Aktivieren müssen sie
  repariert werden. Eine nur momentan falsche Live-Sichtbarkeitsbedingung ist
  **keine** solche Deaktivierung.
- Struktur-, Sicherheits- und Größenprüfungen gelten auch für deaktivierte Teile.
- Die Kanalverwaltung warnt vor Löschen/Umbenennen bei Abhängigkeiten im
  aktuellen veröffentlichten Stand und gemeinsamen Entwurf. Nach Bestätigung
  bleibt die Kanaländerung erlaubt.
- Dadurch beschädigte Bindungen gehen in ihren Fehlerzustand. Der Entwurf muss
  vor einer erneuten aktiven Veröffentlichung repariert werden; historische
  Veröffentlichungen werden nicht automatisch umgeschrieben.

## Editor, Vorlagen und Vorschau

### Elemente und Werkzeuge

- Text, Beschriftungen und formatierte Telemetriewerte.
- Lineare/radiale Anzeigen, einfache Formen, Gruppen und LiDAR-Widget.
- Importierte statische SVGs mit auswählbaren Unterelementen.
- Verschieben, Skalieren und Drehen mit Griffen und exakten Zahlenfeldern.
- Mehrfachauswahl, Gruppieren/Auflösen, Duplizieren und Ebenenreihenfolge.
- Elemente sperren/ausblenden, Ausrichten und gleichmäßig Verteilen.
- Zoom/Pan sowie optionales Raster mit Einrasten.
- Ebenen-/Objektübersicht, Eigenschaften-/Bindungseditor und Keyframe-Zeitachse.
- Sichtbare Vererbung und Rücksetzen von Varianten-Überschreibungen.
- Undo/Redo für sämtliche Entwurfsänderungen.

Freies Zeichnen und Bearbeiten eigener SVG-Pfade gehört nicht zum ersten Umfang.

### Gestaltungsmodus und Vorschau-Modus

Im Gestaltungsmodus sind Animationen angehalten, damit Elemente zuverlässig
ausgewählt und transformiert werden können. Die Keyframe-Zeitachse kann gezielt
auf eine Position gesetzt werden. Formelwerte lassen sich im Eigenschaftseditor
trotzdem live prüfen.

Ein eigener Vorschau-Modus zeigt das gesamte HUD mit laufender Telemetrie und
Animationen. Dort wird nicht per Drag-and-drop gestaltet. Eine zweite, dauerhaft
parallel sichtbare Live-Arbeitsfläche ist nicht erforderlich.

Beim Öffnen des Editors werden Steuerwert-Senden und Wiederholungen dieser
Client-Sitzung pausiert. Bewusste Live-Tests können sie mit deutlich sichtbarem
Status freigeben. Beim Verlassen erfolgt keine automatische Reaktivierung einer
pausierten Steuerung. Formular-/Editor-Tastatureingaben dürfen nicht versehentlich
Fahrzeugbefehle auslösen; Simulationen sind grundsätzlich keine Steuerbefehle.

### Startvorlagen

Zusätzlich zu allgemeinen Bausteinen werden editierbare Vorlagen geliefert:

- Kompass/Heading-Anzeige.
- Pitch/Roll-Lageanzeige.
- Kettenlauf mit telemetrieabhängiger Bewegungsrate.
- Abstandsanzeige mit Warnung.
- LiDAR-Raster mit optionalem Sweep-Effekt.

Beim Einfügen werden benötigte Kanäle und explizite Umrechnungen zugeordnet.
Eine Vorlage erzeugt keine neue Sensorhardware und keine bisher fehlenden
Messwerte. Sie bleibt anschließend mit den regulären Editorwerkzeugen editierbar.

### Lokale Simulation

Die Vorschau kombiniert echten Stream und Live-Telemetrie mit lokalen Testwerten:

- Einzelne Kanäle mit festen Werten oder Reglern überschreiben.
- Einfache Verläufe wie Rampe und Sinus.
- Fehlende, ungültige, ungeprüfte und veraltete Werte simulieren.
- Synthetische LiDAR-Daten zur Raster-/Warnungsprüfung.
- Nicht überschriebene Kanäle bleiben live; ein Testmodus kann alle benötigten
  Kanäle simulieren.

Testwerte gelten ausschließlich in der lokalen Editor-Vorschau. Sie werden
nicht als echte Telemetrie gesendet, nicht in den gemeinsamen Live-Wertebestand
geschrieben und lösen keine Fahrzeugbefehle aus.

## Formeln und Datenbindungen

Einfache Bindungen entstehen per Kanalauswahl; Einheit und Dezimalstellen werden
vorbelegt und können für die Anzeige angepasst werden. Komplexere Umrechnungen
und Bedingungen verwenden ein Formelfeld mit Syntaxhilfe, Kanalauswahlhilfe und
Live-Validierung.

Das Ausdruckssystem ist begrenzt, typisiert und sicher. Es unterstützt
Telemetrie- und Steuerungssignalreferenzen, Grundrechenarten, Vergleiche,
Bedingungen und freigegebene
Funktionen wie `sin`, `cos`, `clamp` und `map`. Es gibt kein `eval`, keinen
dynamisch erzeugten JavaScript-Code, keine Skripte und keine beliebigen Zugriffe
auf Browser, Netzwerk oder Betriebssystem.

Kanalwerte bleiben in ihrer deklarierten Originaleinheit. Anzeigeformatierung
ändert nicht den Messwert. Nötige Umrechnungen einschließlich Grad/Radiant
werden explizit angegeben; Metadaten unterstützen die Eingabe. Boolesche,
textuelle und numerische Datentypen sind zu berücksichtigen.

Fehlende oder ungültige Werte werden nicht automatisch zu null. Division durch
null, nicht endliche Ergebnisse und Typfehler müssen kontrollierte Diagnosen
erzeugen, nicht den gesamten Renderer abbrechen. Kanalabhängigkeiten müssen
zuverlässig aus Bindungen/Formeln ermittelt werden können.

Grammatik, Funktionssignaturen, Typregeln, Fehlerfortpflanzung und Begrenzungen
werden in AP00 festgeschrieben. Client-Liveprüfung und serverseitige
Veröffentlichungsprüfung benötigen dieselbe Semantik und gemeinsame Testfälle.

## Animationsmodell

### Ein steuernder Modus je Eigenschaft

Eine Eigenschaft wird entweder statisch, durch eine direkte Formelbindung, eine
integrierte Animationsrate oder eine Keyframe-Spur gesteuert. Mehrere Modi
steuern nicht gleichzeitig dieselbe Eigenschaft. Kombinationen erfolgen
ausdrücklich über Gruppen, etwa äußere Kompassausrichtung plus innerer Effekt.

1. **Direkte Bindung:** Zustand unmittelbar aus Telemetrie berechnen, etwa
   Heading auf Drehung oder Pitch/Roll auf Lage-Linien.
2. **Integrierte Rate:** Eine Rate pro Sekunde erzeugt fortlaufende Bewegung,
   etwa Kettenlauf. Negative Raten kehren die Richtung um. Integration ist
   zeitbasiert, nicht an Video-, Render- oder Telemetrie-Bildraten gekoppelt.
3. **Keyframe-Clips:** Unabhängige Clips für Elemente/Gruppen; mehrere
   Eigenschaften können innerhalb eines Clips synchron laufen. Jeder Clip hat
   eigene Dauer, Wiederholung, Easing und Aktivierungsregeln. Keine einzige
   globale HUD-Zeitachse als Laufzeitvorgabe.

Clips unterstützen automatischen Dauerbetrieb, Lauf solange eine Bedingung wahr
ist und einmaligen Impuls beim Wechsel von falsch zu wahr. Verhalten beim
Deaktivieren ist je Clip einstellbar; genaue Zustandsübergänge, Wiederanlauf und
Konfliktprüfung werden in AP00 definiert.

### Glättung und Unterbrechungen

Direkte Bindungen folgen standardmäßig unmittelbar dem Messwert. Optional kann
je Bindung zeitbasierte Glättung aktiviert werden. Winkel verwenden den
kürzesten Übergang, beispielsweise 359° auf 0°. Ungültige/veraltete Daten werden
durch Glättung nicht weiterbewegt.

Bei ausgeblendetem HUD, inaktivem Tab oder Streamwechsel laufen keine unsichtbaren
Daueranimationen weiter. Beim erneuten Anzeigen starten Clips und integrierte
Bewegungsphasen neu, ohne ausgeblendete Zeit nachzurechnen. Direkte Anzeigen
verwenden dann aktuelle gültige Werte. Zwischenzeitliche Warnimpulse werden
nicht nachträglich abgespielt.

## Telemetrieabhängigkeiten und Datenqualität

### Verbraucher und persönliche Auswahl

Der gemeinsame Wertebestand berücksichtigt die Vereinigung der Anforderungen
von manueller Telemetrieanzeige, aktivem HUD und Editor-Vorschau. Die persönliche
Telemetrieleiste zeigt dennoch nur ihre manuell ausgewählten Kanäle.

HUD-Abhängigkeiten verändern weder persönliche Schalter noch deren gespeicherte
Einstellungen. Manuelles Abwählen darf einen vom HUD benötigten Wert nicht
entfernen. Ebenso darf das Beenden eines Verbrauchers andere Verbraucher nicht
abschalten. Verbindung und Wertebestand dürfen nicht ausschließlich am
Lebenszyklus der bisherigen Telemetrieleisten-Komponente hängen.

### Empfangs- und Sensoraktualität

Transportverbindung, Nachrichtenalter und Quellgültigkeit/Messalter werden
getrennt betrachtet. Wiederholtes Senden einer alten Sensormessung macht sie
nicht frisch. Onboard liefert diese Informationen automatisch über einen
rückwärtsverträglich erweiterten Telemetrievertrag. HUD-Autoren müssen nicht
für jede Anzeige passende Health-Kanäle verdrahten.

Standardfristen richten sich nach erwarteter Aktualisierungsrate. Im HUD sind
sie je verwendetem Kanal überschreibbar; die wirksame Frist wird angezeigt.
Ein ausdrücklicher Sensorfehler oder bereits als zu alt gemeldeter Messwert
kann durch eine längere HUD-Frist nicht wieder gültig werden.

Das HUD verwendet neueste verfügbare Telemetrie unabhängig von Videolatenz.
Es gibt im ersten Umfang weder festen Telemetrieversatz noch messzeitgenaue
Zuordnung zu einzelnen Videoframes.

### Anzeigezustände

| Zustand | Standardverhalten |
| --- | --- |
| Aktuell und gültig | Reguläre Anzeige und erlaubte telemetriegetriebene Bewegung. |
| Quellzustand ungeprüft, etwa Alt-Onboard | Zahlen/Werte und direkte Bindungen (auch Drehung/Länge) folgen dem Wert mit gelbem Warndreieck mit Ausrufezeichen; integrierende Raten und Clips bleiben gestoppt (D71). |
| Fehlend, ungültig oder veraltet | Zahlen zeigen „—“; grafische Anzeigen halten die letzte gültige Position und werden sichtbar als ungültig markiert; abhängige Bewegungen stoppen. |
| Aktueller, unvollständiger LiDAR-Scan | Erkannte gültige Gruppen werden dargestellt; gelbes Warndreieck am gesamten Raster kennzeichnet eingeschränkte Datenqualität. |

Für ungültige Elemente kann im Editor statt des Standardverhaltens etwa
Ausblenden gewählt werden. Ohne jemals gültige Messung darf kein erfundener
Nullwert als letzte gültige Position erscheinen. Unabhängige Zeiteffekte dürfen
bei fehlender Telemetrie weiterlaufen; sie dürfen aber keinen funktionierenden
Sensor vortäuschen.

Die bisherige manuelle Telemetrieanzeige bleibt zu älteren Onboard-Versionen
kompatibel. Fehlende Qualitätsunterstützung ist im Editor diagnostizierbar.

### Eingabe- und Flow-Werte als zusätzliche HUD-Quellen

Neben Telemetrie und Konstanten dürfen Bindungen/Formeln Eingabedaten und
berechnete Flow-Werte verwenden. Fertig berechnete Fahrzeug-Steuerkanalausgänge
sind direkt auswählbar. Rohe Eingaben und Zwischenwerte werden zusätzlich über
ausdrücklich benannte gemeinsame Signale angeboten, deren Zuordnung zum
persönlichen Flow je Fahrer erfolgt. HUD-Bindungen hängen nicht an internen
Knoten-IDs eines bestimmten Fahrers; fehlende Zuordnungen bleiben nicht verfügbar.

Alle HUD-Clients verwenden dabei die Daten des aktiven Fahrers, nicht die eigenen
unbenutzten Zuschauereingaben. Der reine Anzeigeweg prüft die sendende Fahrsitzung,
entwertet alte Daten bei Kontrollwechsel und darf keine Fahrzeugbefehle auslösen.
Ein berechneter Lenkbefehl ist ein Sollwert, kein gemessener Ist-Lenkwinkel.

Bei pausierter Steuerungsübertragung dürfen aktuelle berechnete Werte weiterhin
angezeigt und animiert werden. Betroffene Anzeigen müssen den Pausen-/Nicht-
gesendet-Status eindeutig zeigen, auch bei Zuschauern. Das Lesen der Werte darf
weder Steuerungsnebenwirkungen noch eine Wiederaufnahme des Sendens auslösen.
Lokale Vorschau-Simulationen bleiben weiterhin vom echten Flow getrennt.

Signaldefinitionen, Einheiten/Typen, persönliche Zuordnung, Transport und
Aktualitätsregeln werden im AP00-Vertrag konkretisiert. Referenzen auf andere
HUD-Eigenschaften oder gemeinsam definierte HUD-Formelvariablen sind damit
nicht zusätzlich beschlossen.

## LiDAR-Raster und Abstandsanzeige

### Gültiger Entscheidungsstand

Die zwischenzeitlich diskutierte Prozent-/Belegungsgradlogik ist **verworfen**.
Es gibt keinen 10-%-Schwellwert und keine Rotfärbung anhand des Trefferanteils.
Die aktuelle Logik erkennt zusammenhängende Punktgruppen und färbt nach Abstand.

Einzelne Abstandswerte bleiben Teil des Features. Der Sweep ist nur ein
Visualisierungseffekt, nicht mit der echten Scannerposition synchronisiert und
keine Quelle erfundener Hindernispunkte.

### Konfiguration der Quelle und des Widgets

| Parameter | Festlegung |
| --- | --- |
| Winkelsektoren | Je Widget auswählbar: 4, 6, 8, 12, 16 oder 24; Standard 8. |
| Distanzzonen | Fünf, mit Grenzen je LiDAR-Quelle; nicht frei je HUD. |
| Standardgrenzen | 0,5 / 1 / 2 / 3 / 5 m. |
| Rasterdarstellung | Gleich breite schematische Ringe, mit tatsächlichen Entfernungsbeschriftungen; nicht maßstabsgetreu. |
| Ausrichtung | Eine Sektormitte liegt vorne, vorne zeigt im Widget standardmäßig nach oben. Bei acht Sektoren umfasst vorne −22,5° bis +22,5°. |
| Montageversatz | In der LiDAR-Quellkonfiguration korrigierbar. |
| Mindestgruppe | Drei direkt aufeinanderfolgende Winkelmessungen mit brauchbaren Abstandswerten. |
| Punktabstand | Räumlicher Abstand benachbarter Gruppenpunkte höchstens 5 cm, je Quelle einstellbar. |
| Farbe | Durchgehende Entfernungsskala über das gesamte Raster, nicht je Ring neu beginnend. |
| Rote Nahzone | Standard bis einschließlich 0,5 m ab LiDAR-Sensor, im Editor konfigurierbar. |
| Ferne Farbe | Standard gelb bei 5 m; zwischen Nah-/Ferngrenze gleichmäßiger Übergang über Orange zu Rot. |
| Blinkfrequenz | Standard 0,5 Hz bei 5 m und 2 Hz bei 0,5 m und näher; dazwischen linear interpoliert. Im Editor einstellbar. |
| Pulsieren | Belegte Felder wechseln zwischen voller und reduzierter Deckkraft, verschwinden nie vollständig. |
| Nachleuchten | Standard 0,5 Sekunden nach Wegfall der Belegung, im Editor einstellbar, auch auf null. |

Die ersten Standardzonen sind: über 0 bis einschließlich 0,5 m, über 0,5 bis
1 m, über 1 bis 2 m, über 2 bis 3 m und über 3 bis 5 m. Ein brauchbarer
Abstandswert gehört zu genau einer Zone; Werte oberhalb der letzten Grenze
zu keiner angezeigten Zone. Fehlende Rückläufe werden nicht als Abstand null
interpretiert.

### Gruppenerkennung und Rasterzuordnung

1. Grundlage ist ein geordneter Rundscan mit bekannten Messwinkeln und
   brauchbaren Abständen. Fehlende Winkelmessungen unterbrechen eine Gruppe;
   Lücken werden nicht überbrückt.
2. Direkte Winkelnachbarn gehören nur zusammen, wenn ihr tatsächlicher
   räumlicher Abstand in der Draufsicht höchstens der Quellschwelle entspricht.
   Die bloße Differenz zweier radialer Entfernungen reicht als Prüfung nicht.
3. Mindestens drei so verbundene Punkte bilden eine gültige Gruppe; ein oder
   zwei isolierte Punkte reichen nicht.
4. Gruppen werden auf dem gesamten Rundscan erkannt, auch über 0°/360°,
   Winkelsektor- und Distanzzonengrenzen hinweg.
5. Erst danach werden Gruppenpunkte auf Anzeigefelder verteilt. Ein Feld wird
   belegt, wenn es Punkte einer gültigen Gruppe enthält. Deshalb können auch
   zwei Punkte auf einer Seite und ein Punkt auf der anderen Seite einer
   Feldgrenze beide Felder markieren.
6. Bei mehreren Punkten/Gruppen in einem Feld bestimmt der nächste gültige
   Gruppenpunkt dessen Entfernung und damit Farbe/Blinkfrequenz.
7. Unbelegte Felder sind blass. Neue Belegung erscheint sofort; entfällt sie,
   bleibt die letzte Anzeige für die eingestellte Nachleuchtdauer erhalten.

Ein näherer Punkt darf durch die durchgehende Farbskala nicht weniger rot als
ein weiter entfernter sein. Die Entfernungsskala beginnt nicht an jeder
Zonengrenze erneut. Näherkommen erhöht zusätzlich die Blinkfrequenz.

### Qualität und Übertragung

Ein aktueller unvollständiger Scan darf gültige Gruppen zeigen. Ein gelbes
Warndreieck kennzeichnet die Qualität des gesamten Rasters. Nicht markierte
Felder gelten nicht als sicher frei. Ein vollständig ausgefallener/veralteter
Sensor geht dagegen in den allgemeinen Ungültig-Zustand. Nachleuchten und
Blinken verlängern keine Daten- oder Quellgültigkeit.

Onboard erkennt Gruppen vor der Reduktion und überträgt kompakte Abstandsdaten
für ein gemeinsames feineres Winkelraster mit fünf Distanzzonen. Mehrere Widgets
können daraus gleichzeitig verschiedene der erlaubten Sektorenanzahlen bilden.
Es werden keine Rohpunktwolken an den Web Client übertragen.

**Technischer Vorschlag für AP00:** 96 Winkelabschnitte mit fünf Distanzzonen.
Die vorn zentrierten Feldgrenzen aller erlaubten Sektorenanzahlen lassen sich
daraus exakt bilden. Pro Grundrasterfeld genügt der nächste gültige
Gruppenabstand beziehungsweise eine eindeutige Nichtbelegungsinformation,
ergänzt um Quellqualität, Messalter und Snapshot-Identität. Konkretes Drahtformat,
Bandbreite und Messrate sind vor Umsetzung zu validieren und festzuschreiben.

Die Einbindung in den vorhandenen LiDAR-Mehrscanfilter ist in AP00 ausdrücklich
zu klären, damit keine unbemerkte zusätzliche Latenz oder Vermischung alter
Messpunkte entsteht. Bestehende andere LiDAR-Verbraucher werden nicht
stillschweigend auf eine neue Filter-/Sicherheitslogik umgestellt.

## SVG-Sicherheit und Asset-Lebenszyklus

Importierte SVGs werden anhand einer Positivliste bereinigt und serverseitig
geprüft. Skripte, Event-Handler, `foreignObject`, externe Ressourcen sowie
importierte SMIL-/CSS-Animationen werden nicht übernommen. Nicht unterstützte
Inhalte wie aufwendige Filter dürfen nicht ungeprüft eingebettet werden.

Entfernte/nicht unterstützte Inhalte werden aufgelistet. Die bereinigte Grafik
muss in einer Vorschau bestätigt werden. Ist das Ergebnis unbrauchbar oder
überschreitet es Ressourcenlimits, wird der Import abgelehnt. Es wird zu keinem
Zeitpunkt zur Vorschau unsicherer Originalcode ausgeführt.

Es braucht Grenzen für Dateigröße, Knoten-/Referenzkomplexität und aufwendige
Geometrie sowie sichere Behandlung von XML, internen Referenzen und SVG-IDs.
Konkrete erlaubte Tags/Attribute, CSS-Teilmenge und Limits werden in AP00
festgelegt. Clientprüfung ersetzt keine serverseitige Prüfung.

Veröffentlichte Konfigurationen referenzieren unveränderliche Asset-Versionen.
Spätere Importe oder Entwurfsänderungen dürfen historische Veröffentlichungen
nicht verändern oder ihre Assets entfernen.

## Vollständiger HUD-Import/-Export

Ein exportiertes Paket umfasst Standard, Varianten und benötigte SVG-Assets
einschließlich Bindungen und Animationen. Nicht enthalten sind Livewerte,
persönliche Sichtbarkeitseinstellungen, Fahrzeugberechtigungen oder sonstige
Zugangsdaten.

Import erfolgt ausschließlich in einen Entwurf, nie unmittelbar in den
veröffentlichten Stand. Bei Übernahme auf ein anderes Fahrzeug hilft eine
Zuordnungsliste für Kanäle und Streams. Ungelöste aktive Referenzen blockieren
die Veröffentlichung. Auch importierte Pakete und enthaltene Assets unterliegen
den normalen Sicherheits- und Ressourcenprüfungen.

Paketformat und genaue Import-/Ersetzungsregeln werden in AP00 festgelegt.
Ein bestimmtes Archivformat oder zusätzliche Laufzeitbibliotheken sind damit
nicht vorgegeben. Die Sicherung lokaler Konfliktstände muss deren Gestaltung
und verfügbare benötigte Assets sinnvoll erhalten.

## Umsetzung und Parallelisierung

### Phase 1: AP00 als verbindliches Vertragsfundament

Die schrittweise bestätigten technischen Festlegungen werden in
[Overlay-AP00-Vertraege.md](Overlay-AP00-Vertraege.md) gesammelt. Der dortige
Zwischenstand ist noch keine vollständige AP00-Freigabe.

Vor unabhängiger Implementierung müssen folgende technischen Punkte anhand
gemeinsamer Beispiele festgeschrieben werden:

1. Konfigurationsschema, Identitäten, Schema-Versionen und Property-Katalog:
   Koordinaten, Pivot/Transformationen, Eigenschaftstypen, Einheiten und Grenzen.
2. Variantenauflösung, strukturelle Änderungen, Vererbungs-/Löschregeln und
   eindeutige Bedeutung ausdrücklich deaktivierter Teile.
3. Entwurfsrevisionen, Veröffentlichungseinheit, Asset-Referenzen, API-Operationen,
   Fehlerantworten, Berechtigungsprüfung und Änderungsbenachrichtigungen.
4. Sicheres Ausdruckssystem: Grammatik, Operatoren, Funktionen, Typen,
   Fehlerfortpflanzung, Abhängigkeitsermittlung und Komplexitätsgrenzen.
5. Zeit-/Animationsmodell: Clip-Auslöser, Wiederholung, Easing, Deaktivierung,
   Wiederauslösung, Endzustand, Scrubbing, Glättung und Ratenintegration.
6. Telemetrievertrag: Quellgültigkeit, Messalter/Zeitbasis, erwartete Rate,
   Reihenfolge/Wiederverbindung, sichere Herkunft und Altversionen. Exakte
   Standardfristen und lokale Sicherungs-/Autosave-Parameter festlegen.
7. LiDAR-Vertrag: Grundraster, Orientierung, Einbindung vorhandener Filter,
   Normalisierung, Grenzfälle, Mess-/Übertragungsrate und neue Quellkonfiguration.
   Auch das Bereitstellen des Rasterkanals für bestehende Installationen klären.
8. SVG-Positivliste, normalisierte Asset-Darstellung, stabile Unterelement-IDs,
   Ressourcenlimits und vollständiges Austauschformat.
9. Modul-Schnittstellen für Dokumentauflösung, Telemetrieanbieter, Ausdrucksengine,
   Renderer/Uhr, Editor-Befehle und Serverpersistenz.
10. Dateiverantwortung, gemeinsame Testdaten, Testwerkzeuge, Browser-/Geräteprofil
    und messbare Leistungs-/Sicherheitsgrenzen.

Diese Punkte sind technische Spezifikationsaufgaben, keine bereits bestätigten
konkreten Feldnamen, Endpunkte oder Zahlenlimits. Falls sie neue fachliche
Entscheidungen erfordern, werden diese abgestimmt statt stillschweigend ergänzt.

### Phase 2: Parallele Modulimplementierung

Nach Vertragsfreigabe können Module gegen vereinbarte Schnittstellen und
Testdoubles unabhängig starten. Der Renderer nutzt Testtelemetrie und kontrollierte
Uhr; der Editor einen simulierten Speicher; LiDAR-Aufbereitung synthetische
Scans; Server und Parser gemeinsame Validierungsfälle. Das heißt nicht, dass
alle Pakete ohne spätere Integration vollständig abnehmbar sind.

| Paket | Zuständigkeit |
| --- | --- |
| AP00 | Verträge, Modulgerüste und gemeinsame Referenzfälle. |
| AP01 | Variantenauflösung und Dokumentprüfung. |
| AP02 | Serverpersistenz, Revisionen, Berechtigungen und Veröffentlichung. |
| AP03 | Quellqualität und rückwärtsverträgliche Telemetrieübertragung. |
| AP04 | LiDAR-Gruppenerkennung und kompaktes Grundraster. |
| AP05 | Client-Telemetrie, Metadaten, Alterung und Verbrauchertrennung. |
| AP06 | Sicheres Ausdruckssystem in Client und Server. |
| AP07 | SVG-Bereinigung, Asset-Normalisierung und Importvorschau. |
| AP08 | SVG-/Animationslaufzeit einschließlich LiDAR-Widget. |
| AP09 | Editorzustand, Gestaltungsfläche, Undo/Redo und Autosave. |
| AP10 | Eigenschafts-/Bindungseditor und Keyframe-Zeitachse. |
| AP11 | Lokale Simulation und laufende Vorschau. |
| AP12 | Startvorlagen und vollständiger Paket-Import/-Export. |
| AP13 | Video-, UI-, Steuerungs- und Anwendungsintegration. |
| AP14 | Übergreifende Browser-, Sicherheits- und Leistungsabnahme. |

Details und Fertigstellungsabhängigkeiten stehen in der
[Arbeitspaketübersicht](Overlay-Arbeitspakete.md). Jedes Paket liefert eigene
Tests. Gemeinsame zentrale Dateien erhalten genau einen Schreibverantwortlichen;
Vertragsänderungen werden koordiniert, nicht parallel improvisiert.

### Phase 3: Früher durchgängiger Integrationsnachweis

Integration und End-to-End-Tests beginnen nicht erst nach Fertigstellung aller
Module. Der erste kleine durchgängige Nachweis umfasst:

> Ein Zahlenwert und eine Drehung werden bearbeitet, gespeichert und
> veröffentlicht. Ein zweiter offener Client übernimmt sie ohne neue
> Videoverbindung. Ein inzwischen nicht mehr berechtigter Fahrer kann nicht
> auf dem Server speichern.

Darauf folgen Varianten, SVG-Import, Clips, Simulation, LiDAR und Austausch.
Eine kleine Integrationsstrecke reduziert Risiken, ersetzt aber nicht den
vereinbarten vollständigen Zielumfang.

### Phase 4: Gesamtabsicherung und Freigabe

Alle Modul- und Integrationstests sowie die vereinbarten Browser-/Leistungstests
müssen bestehen. Ungestörte Video-/Steuerungsfunktionen sind Teil der Abnahme.
Es erfolgt keine automatische Einführung auf Server oder Fahrzeug.

## Testschwerpunkte und Abnahme

### Konfiguration und Berechtigung

- Standard/Varianten, nicht überschriebene Vererbung, Rücksetzen, stabile IDs,
  Löschwarnungen einschließlich lokaler Unterelemente und Deaktivierung.
- Sitzungsbenutzer mit Steuerung versus anderer Sitzungsbenutzer und Zuschauer,
  Kontrollübergabe und Fahrzeug offline bei offenem Editor, serverseitige
  Prüfung jedes Verwaltungszugriffs.
- Autosave, Verbindungsabbruch, lokale Wiederherstellung, zwei Tabs, Konflikt mit
  neuer Serverrevision; kein Überschreiben und kein Verlust lokaler Sicherungen.
- Undo/Redo trotz Autosave; unveränderliche Veröffentlichungen und Assets;
  Wiederherstellen erst als Entwurf; aktive versus deaktivierte Validierung.
- Warnungen bei Kanaländerungen und beschädigte historische Referenzen.

### Darstellung und Laufzeit

- Tatsächliche Videofläche, Letterboxing, verschiedene Auflösungen und
  Seitenverhältnisse, Resize, Mobilanzeige und Container-Vollbild.
- Persönliche Sichtbarkeit je Fahrzeug, unabhängiger Stream-Status und
  gemeinsame Deaktivierung je Stream.
- Veröffentlichung und Wiederverbindung ohne Video-Neuverbindung oder gemischte
  Konfigurationsstände; Fehler im HUD lassen Video/Steuerung nutzbar.
- Typen, Einheiten, Formelvalidierung und Fehlerfälle einschließlich nicht
  endlicher Ergebnisse; übereinstimmende Client-/Server-Semantik.
- Positive/negative Raten, Glättung, Winkelübergänge, Clip-Wiederholung, Easing,
  Bedingungen/Impulse, Scrubbing und Neustart ohne Nachholen.

### Telemetrie und Simulation

- Gemeinsamer Wertebestand ohne Änderung persönlicher Kanalwahl; mehrere
  Verbraucher und deren unabhängiger Verbindungs-/Abhängigkeitslebenszyklus.
- Regelmäßig weitergesendete alte Sensorwerte, Transportausfall und
  quellseitige Fehler; Fristüberschreibung heilt keine ungültige Quelle.
- Alt-Onboard/ungeprüfte Quelle: sichtbare Werte und direkte Bindungen mit
  gelbem Warndreieck, aber gestoppte Raten und Clips (D71); echte ungültige
  Werte nicht als null.
- Lokale Testwerte/Verläufe/Fehlerzustände beeinflussen weder echte Telemetrie
  noch Fahrzeugsteuerung oder persönliche Telemetriepräferenzen.
- Editor-Steuerungspause, bewusste Freigabe und keine automatische Reaktivierung.

### LiDAR

- Ein/zwei Punkte werden verworfen; drei gültige Nachbarn werden erkannt.
- Räumliche 5-cm-Grenze statt nur radialer Differenz; Lücken unterbrechen Gruppen.
- Gruppen über 0°/360°, Sektor- und Zonengrenzen; kein Verschwinden eines
  gültigen Hindernisses durch Aufteilen auf mehrere Felder.
- Richtige Zuordnung zu genau einer Distanzzone, Randwerte und Werte außerhalb
  des Darstellungsbereichs; nächster gültiger Gruppenpunkt pro Feld.
- Alle Sektorenanzahlen 4/6/8/12/16/24 aus derselben Quelle, vorn zentrierte
  Ausrichtung und Montagekorrektur.
- Durchgehende Farbskala, konfigurierbare rote Nahzone, entfernungsabhängige
  Blinkfrequenz und Nachleuchten ohne Verlängerung der Datenaktualität.
- Unvollständige Scans mit gültigen Gruppen und Warndreieck; vollständig
  ausgefallene/veraltete Quelle; kein vermeintlich sicher freies Raster.

### Sicherheit und Portabilität

- SVG-Skripte, Event-Handler, externe Verweise, `foreignObject`, Animationen,
  aufwendige Ressourcen und problematische interne Referenzen.
- Sichere Bereinigungsvorschau ohne Ausführung des Originals; Limits auch bei
  deaktivierten Elementen; sichere Handhabung vollständiger Importpakete.
- Export/Import erhält Gestaltung und benötigte Assets, enthält aber keine
  Livewerte, persönlichen Anzeigepräferenzen oder Zugangsdaten.
- Kanal-/Stream-Zuordnung beim Fahrzeugwechsel und Veröffentlichungssperre für
  ungelöste aktive Referenzen.
- Browser-/Lasttests für Referenz-HUDs; keine unnötige unsichtbare Daueranimation
  und keine unkontrollierte Ressourcenbelastung durch Assets oder Formeln.

## Nicht im ersten Umfang

- Zusätzliche Fahrzeug-Verwalterrollen oder Echtzeit-Zusammenarbeit im Editor.
- Persönliche/mehrere benannte serverseitige Entwürfe oder automatische
  Zusammenführung konkurrierender Entwürfe.
- Unabhängige Veröffentlichungen/Versionsverläufe je Stream.
- Freies Zeichnen/Bearbeiten eigener SVG-Pfade.
- Echte LiDAR-Punktwolken oder Übertragung beliebiger umfangreicher
  strukturierter Sensordaten; das definierte kompakte LiDAR-Raster ist ausgenommen.
- Prozentbasierte LiDAR-Belegungslogik oder beliebige Sektorenanzahlen außerhalb
  der vereinbarten Auswahl.
- Exakte Synchronisierung von Telemetrie/Sweep und Videoframes.
- Automatische Objekterkennung, Verfolgung realer Fahrzeugteile oder
  automatische Korrektur von Abständen anhand einer Fahrzeugkontur.
- Vollständig touchoptimierter Editor, zugesichertes HUD in nativem
  Nur-Video-Vollbild oder Picture-in-Picture.
- Beliebig ausführbarer Code, externe Asset-/Verarbeitungsdienste oder neue
  fahrzeugseitige Sicherheitsfunktionen.

## Umsetzung und Deployment

Dieser Plan ist keine Implementierung oder Rollout-Freigabe. Implementierung
erfolgt anhand der freigegebenen Verträge und Pakete. Codeänderungen werden
gemäß `AGENTS.md` lokal committed, aber nicht automatisch ausgerollt.

Ein späterer Rollout auf `lte-rc-server` oder `lte-truck` erfordert eine
ausdrückliche Anweisung und die dort vorgeschriebenen Build-Vorprüfungen.
Hardware-/Vor-Ort-Tests werden gesondert vereinbart. Destruktive Aktionen
erfordern weiterhin vorherige Zustimmung.
