# Dynamisches Fahrzeug-Overlay im Web Client

## Ziel

Der Web Client soll ein individuell gestaltbares HUD über dem Videostream eines
Fahrzeugs anzeigen. Das HUD bezieht Live-Telemetrie ein und unterstützt sowohl
direkte Datenbindungen als auch zeitbasierte Animationen. Beispiele sind ein
fahrendes Kettenlaufwerk, ein Kompass, Lage-Linien, Abstandsanzeigen und ein
animierter LiDAR-Sweep.

Das Dokument beschreibt das abgestimmte Zielbild und den Umsetzungsvorschlag;
es ist noch keine Implementierungsspezifikation einzelner Endpunkte oder
Datenbanktabellen.

## Abgestimmte Produktentscheidungen

- Ein veröffentlichtes Overlay wird standardmäßig über dem Video angezeigt.
  Fahrer können es lokal ein- und ausblenden, ohne die gemeinsame Konfiguration
  zu ändern.
- Pro Fahrzeug gibt es ein gemeinsames Standard-Overlay. Optional gibt es
  darauf aufbauende Varianten pro Videostream, um unterschiedliche
  Kameraperspektiven zu berücksichtigen.
- Positionen und Größen beziehen sich auf den tatsächlichen Videoframe. Das
  Overlay bewahrt dessen Seitenverhältnis und wird proportional skaliert; es
  wird nicht über einen möglichen Letterbox-Bereich des Players gestreckt.
- Die Konfiguration wird serverseitig gespeichert und ist für alle berechtigten
  Nutzer eines Fahrzeugs gemeinsam.
- Nur Nutzer mit Fahrzeug-Verwaltungsberechtigung dürfen Entwürfe bearbeiten
  und veröffentlichen. Andere berechtigte Nutzer können das veröffentlichte HUD
  sehen und lokal ausblenden.
- Änderungen werden zunächst als Entwurf bearbeitet und getestet. Erst eine
  explizite Veröffentlichung aktualisiert das gemeinsame HUD. Bereits offene
  Clients erhalten die neue Version sofort, ohne die Videoverbindung neu zu
  starten.
- Veröffentlichte Versionen bleiben im Versionsverlauf erhalten und können
  wiederhergestellt werden. Der Editor benötigt außerdem Undo/Redo im Entwurf.
- Ein Overlay verwendet seine Telemetriekanäle automatisch. Diese Abhängigkeiten
  bleiben unabhängig von den manuellen Telemetrie-Schaltern des Nutzers.
- Einzelne Abstands-/LiDAR-Werte und ein animierter Sweep gehören zum Umfang.
  Eine echte LiDAR-Punktwolke ist ausdrücklich später vorgesehen.

## Technischer Ausgangspunkt im Repository

- `Client/src/components/video-stream.tsx` rendert das Videoelement und den
  bestehenden Stream-Status.
- `Client/src/components/car-video-panel.tsx` verwaltet das ausgewählte
  Fahrzeug und den ausgewählten Videostream.
- `Client/src/components/telemetry-store.ts` enthält den
  SignalR-Telemetrie-Store. Eingehende Livewerte sind Textwerte; der Client
  berücksichtigt derzeit nur manuell abonnierte Kanäle.
- Telemetrie-Kanaldefinitionen enthalten bereits Datentyp, optionale Einheit
  und Dezimalstellen. Diese Metadaten sollen Formeleingabe und Anzeige
  unterstützen.

Für das Overlay sollte der Telemetrie-Store Overlay-Abhängigkeiten getrennt
von den persönlichen Telemetrie-Schaltern führen. Ein Kanal, den ein
veröffentlichtes Overlay benötigt, wird somit für die Anzeige berücksichtigt,
ohne die manuelle Auswahl oder deren gespeicherte Einstellung zu verändern.

## Vorgeschlagene Architektur

### Deklarative Konfiguration und SVG-Renderer

Die serverseitige Overlay-Beschreibung ist eine versionierte, deklarative
Konfiguration: Sie enthält Elemente, Gestaltung, Bindungen, Formeln und
Animationen. Der Client rendert diese Konfiguration als SVG. Das SVG ist damit
Vektor-Renderer und Asset-Format, aber kein Ort für beliebig ausführbaren Code.

Importierte SVG-Dateien liefern statische Geometrie. Ihre auswählbaren Elemente
werden im Editor mit Formeln und Animationen verbunden. Skripte, Event-Handler
und externe Ressourcen werden nicht ausgeführt bzw. eingebettet; importierte
SMIL- oder CSS-Animationen werden nicht übernommen.

Die genaue Speicherung (z. B. Konfigurationsdaten und separate Asset-Dateien)
sowie Schema- und API-Details werden im Implementierungsdesign festgelegt.

### Fahrzeug- und Stream-Konfiguration

- Jede Fahrzeugkonfiguration enthält ein Standard-Overlay.
- Eine optionale Stream-Variante übernimmt das Standard-Overlay und speichert
  nur die nötigen stream-spezifischen Abweichungen.
- Der Client wählt anhand des aktiven Streams die passende effektive
  Konfiguration aus.
- Entwürfe, Veröffentlichungen und veröffentlichte Versionen werden getrennt
  behandelt.

### Editor

Der Editor ist eine eigene Verwaltungsansicht im Web Client mit einer
Arbeitsfläche im Seitenverhältnis des jeweiligen Streams. Vorgesehene
Werkzeuge und Elemente:

- Text, Telemetriewerte und Beschriftungen
- lineare und radiale Anzeigen
- einfache Formen und gruppierte Elemente
- importierte, statische SVG-Grafiken mit auswählbaren Elementen
- Positionierung, Größe und Gestaltung auf der Videoframe-Arbeitsfläche
- Formel- und Datenbindung pro animierbarer Eigenschaft
- Ebenen-/Objektübersicht sowie Keyframe-Zeitachse

Freies Zeichnen und Bearbeiten eigener SVG-Pfade ist eine spätere Erweiterung.

Die Vorschau kombiniert den echten Fahrzeugstream und Live-Telemetrie mit
simulierbaren Testwerten. Simulationen erlauben es, Formeln und Animationen
auch bei stehendem Fahrzeug oder unveränderlichen Sensorwerten zu prüfen.

### Formeln und Telemetrie

Formeln werden als Text eingegeben und vom Client mit Syntaxhilfe und
Live-Validierung unterstützt. Vorgesehen ist ein begrenztes, sicheres
Ausdruckssystem statt beliebigem JavaScript (`eval`). Es soll Kanäle als
Variablen sowie Grundrechenarten, Vergleiche, Bedingungen und Funktionen wie
`sin`, `cos`, `clamp` und `map` unterstützen.

Kanalwerte bleiben in ihrer deklarierten Originaleinheit. Die Einheit wird im
Editor angezeigt; nötige Umrechnungen einschließlich Grad/Radiant werden
explizit angegeben. Datentypen und fehlende/nicht numerische Werte werden bei
Formeln berücksichtigt.

### Animationsmodell

Der Laufzeitteil unterstützt drei komplementäre Modi:

1. **Direkte Formelbindung:** Eine Eigenschaft folgt unmittelbar einem
   berechneten Zustand, z. B. Heading → Kompassdrehung oder Pitch/Roll →
   Position/Drehung einer Lage-Linie.
2. **Telemetrieabhängige Animationsrate:** Der Wert steuert eine fortlaufende,
   über die Zeit integrierte Bewegung, z. B. den Kettenlauf. Negative Raten
   kehren die Bewegungsrichtung um.
3. **Keyframe-Zeitachse:** Eigenschaften wie Drehung, Position, Deckkraft und
   Farbe erhalten Keyframes, Wiederholung, Easing und Start-/Stoppbedingungen.
   Beispiele sind ein LiDAR-Sweep oder eine bedingte Abstandswarnung.

Wenn ein Telemetriekanal länger als eine konfigurierbare Frist keinen gültigen
Wert liefert, wird er als veraltet markiert. Anzeigen zeigen einen fehlenden
Wert, telemetriegetriebene Bewegungen halten an; unabhängige Zeitachsen-Effekte
können weiterlaufen.

## Umsetzung in Etappen

1. **Server-Grundlage:** versioniertes Konfigurationsmodell, serverseitige
   Berechtigungsprüfung, Entwurfs-/Veröffentlichungsablauf und
   Versionsverlauf/Zurücksetzen konzipieren und implementieren.
2. **Client-Laufzeit:** Overlay als SVG-Ebene über dem tatsächlichen Videoframe
   integrieren; Fahrzeug-Standard und Stream-Varianten auswählen; lokale
   Anzeigeoption sowie sofortige Aktualisierung nach Veröffentlichung ergänzen.
3. **Telemetrie:** Overlay-Kanalabhängigkeiten in den Telemetrie-Store
   integrieren, ohne manuelle Nutzereinstellungen zu überschreiben; typisierte
   Werte, Einheiten und veraltete Daten behandeln.
4. **Editor-Grundlage:** Arbeitsfläche, Standard-HUD-Elemente, Gruppen,
   SVG-Import, Entwurfsverwaltung und Veröffentlichung erstellen.
5. **Dynamik:** Formelparser und Validierung, direkte Bindungen,
   telemetrieabhängige Animationsraten sowie Keyframe-Zeitachse implementieren.
6. **Vorschau und Absicherung:** Live-/Simulationsvorschau, Rollback,
   Berechtigungen, Fehlersituationen und Browser-/Layoutverhalten testen.

## Testschwerpunkte

- Ausrichtung des Overlays zur tatsächlichen Videofläche bei verschiedenen
  Seitenverhältnissen und Auflösungen
- Auswahl von Standard- und Stream-Varianten
- Formelvalidierung, Datentypen, Einheiten und ungültige/fehlende Werte
- positive und negative Animationsrate sowie Keyframe-Wiederholung und Easing
- Erkennung veralteter Telemetrie und definiertes Ausfallverhalten
- automatische Berücksichtigung benötigter Kanäle ohne Änderung manueller
  Telemetrie-Einstellungen
- Berechtigungsprüfung für Bearbeiten, Veröffentlichen und Zurücksetzen
- sofortige Aktualisierung bereits verbundener Clients nach Veröffentlichung
- sichere Behandlung importierter SVG-Dateien

## Nicht im ersten Umfang

- freies Zeichnen/Bearbeiten eigener SVG-Pfade im Web-Editor
- echte LiDAR-Punktwolken oder andere umfangreiche strukturierte Sensordaten
- automatische Objekterkennung oder Verfolgung realer Fahrzeugteile im Bild
