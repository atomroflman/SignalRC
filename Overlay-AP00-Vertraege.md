# Fahrzeug-Overlay: AP00-Verträge

Status: in Klärung. AP00 ist noch nicht freigegeben; dieses Dokument enthält
nur bereits bestätigte Entscheidungen und den verbleibenden Klärungsbedarf.

Produktregeln: [Overlay-Feature.md](Overlay-Feature.md).
Arbeitspakete: [Overlay-Arbeitspakete.md](Overlay-Arbeitspakete.md).

## Bestätigte Entscheidungen

### D01 – Logische Pixel als Koordinatensystem

- Positionen und Größen werden in logischen Pixeln einer einstellbaren
  Referenz-Arbeitsfläche gespeichert und bearbeitet.
- Die logischen Einheiten sind unabhängig von Bildschirm-Pixeln und tatsächlicher
  Videoauflösung. Beispielsweise liegt `x = 960` auf einer 1920 Einheiten breiten
  Arbeitsfläche horizontal in der Mitte.
- Die gesamte Arbeitsfläche wird gemäß Produktplan proportional und vollständig
  im tatsächlichen Videoframe zentriert eingepasst.
- Es gibt keine frei mischbaren Pixel-/Prozentmodi je Eigenschaft.
- 1920 × 1080 ist hier ein Beispiel, noch kein festgelegter Standardwert.

### D02 – Proportionale Skalierung mit entsperrbarem Seitenverhältnis

- Gruppen und importierte SVG-Grafiken werden standardmäßig proportional skaliert.
- Das Seitenverhältnis kann ausdrücklich entsperrt werden; dann sind horizontale
  und vertikale Skalierung unabhängig möglich.
- Geometrie, Texte und Strichstärken innerhalb der Gruppe/SVG-Grafik werden
  gemeinsam skaliert. Die Gruppen-Größenänderung ist kein automatisches
  Neuanordnen ihrer Unterelemente.

### D03 – Frei versetzbarer Transformationspunkt

- Der gemeinsame Dreh- und Skalierungspunkt liegt standardmäßig in der Mitte
  des Elements und kann per Griff und Zahlenfeldern frei versetzt werden.
- Das gilt auch für Gruppen und auswählbare, animierbare SVG-Unterelemente.
- Lokale Koordinaten und die genaue Transformationsreihenfolge werden im
  konkreten Schema einheitlich definiert; D03 erlaubt keine beliebigen
  widersprüchlichen Transformationsfolgen je Element.

### D04 – Explizite Inhaltsbehandlung beim Arbeitsflächenwechsel

- Bei nachträglicher Änderung der Referenz-Arbeitsfläche gibt es zwei getrennte
  Aktionen: nur die Fläche ändern oder zusätzlich den bisherigen Inhalt
  proportional und zentriert in die neue Fläche einpassen.
- Bei ausschließlicher Flächenänderung bleiben Elementpositionen und -größen
  unverändert. Beim Einpassen gibt es keine nichtproportionale Verzerrung.
- Die genaue Abbildung dynamischer Transformationen und geerbter Varianten
  beim Einpassen ist noch technisch festzulegen. Eine bloße Änderung statischer
  Koordinaten genügt nicht, wenn Formeln/Animationen dadurch anders wirken würden.

### D05 – Strukturüberschreibungen in Stream-Varianten

- Stream-Varianten dürfen sowohl die Gruppenzugehörigkeit als auch die
  Ebenenreihenfolge geerbter Elemente ändern.
- Solche Änderungen werden als ausdrückliche, sichtbare und zurücksetzbare
  Strukturüberschreibungen gespeichert, nicht als unabhängige Elementkopien.
- Nicht überschriebene Strukturen folgen weiterhin dem Standard. Stabile
  Elementidentitäten bleiben beim Umgruppieren erhalten.
- Konfliktfälle mit späteren Standard-Umstrukturierungen und die genaue
  Auflösungsreihenfolge müssen im konkreten Variantenvertrag definiert werden;
  die bereits beschlossenen Löschwarnungen gelten weiterhin.

### D06 – Formeleingaben einschließlich Steuerungsdaten

- Formeln sollen neben Telemetrie und Konstanten auch Eingabedaten einschließlich
  berechneter Flow-Ausgänge verwenden können, etwa für eine Lenkwinkelanzeige.
- Ein berechneter Steuerungsausgang ist ein Soll-/Befehlswert und darf ohne
  entsprechende Sensormessung nicht als gemessener Ist-Lenkwinkel gelten.
- Welche Eingabe-/Flow-Werte konkret angeboten werden, wie sie fahrerübergreifend
  adressiert werden und was Zuschauer beziehungsweise pausierte Steuerung sehen,
  ist noch zu klären.
- Verweise auf andere HUD-Eigenschaften oder gemeinsame HUD-Formelvariablen
  wurden durch diese Antwort nicht zusätzlich freigegeben.

### D07 – Steuerungsdaten des aktiven Fahrers für alle HUD-Clients

- Das gemeinsame HUD verwendet die Eingabe-/Flow-Werte des aktiven Fahrers,
  nicht die unbenutzten lokalen Eingaben eines Zuschauers.
- Diese Werte werden für Zuschauer und weitere geöffnete Clients als reine
  Anzeigedaten bereitgestellt; der Anzeigeweg erteilt keine Steuerberechtigung
  und darf keine Fahrzeugbefehle auslösen.
- Der Vertrag muss die zulässige sendende Fahrersitzung prüfen und veraltete
  Daten nach Kontrollwechsel oder Verbindungsverlust zuverlässig entwerten.
- Der genaue Umfang der angebotenen Signale sowie Adressierung, Zeitbasis und
  Pausenverhalten bleiben noch festzulegen.

### D08 – Fahrzeugausgänge und ausdrücklich benannte Flow-Signale

- Fertig berechnete Ausgänge der Fahrzeug-Steuerkanäle sind direkt als
  HUD-Quellen auswählbar.
- Rohe Eingaben und Flow-Zwischenwerte können zusätzlich unter ausdrücklich
  benannten gemeinsamen Signalen bereitgestellt werden.
- Die Zuordnung dieser benannten Signale zum persönlichen Flow erfolgt je
  Fahrer; HUD-Bindungen verweisen nicht auf dessen interne Knoten-IDs.
- Fehlt die Zuordnung bei einem Fahrer, bleibt das betreffende Signal
  nicht verfügbar. Es gibt keine stille Zuordnung zu einem anderen Knoten.
- Signaldefinitionen, Typen, Einheiten, Zuordnungsverwaltung und Umgang mit
  mehreren Ausgangsports sind im konkreten Vertrag noch festzulegen.

### D09 – Berechnete Steuerungswerte bei pausiertem Senden

- Bei pausierter Steuerungsübertragung dürfen aktuelle berechnete Eingabe-/Flow-
  Werte weiterhin angezeigt und für HUD-Animationen verwendet werden.
- Betroffene Anzeigen erhalten einen eindeutigen Pausen-/Nicht-gesendet-Status;
  das gilt auch bei Zuschauern und weiteren Clients.
- Die berechneten Werte belegen weder eine Weiterleitung noch eine Ausführung
  am Fahrzeug. Eine zusätzliche separate Quelle für zuletzt weitergeleitete
  Befehle ist durch diese Entscheidung nicht Teil des Umfangs geworden.
- Der lokale Simulationsmodus bleibt vom echten Flow und Fahrzeugbefehlen
  getrennt. HUD-Lesen darf keine Neuberechnung mit Steuerungsnebenwirkungen
  oder eine Wiederaufnahme des Sendens auslösen.

### D10 – Impuls-Clips nur bei beobachtetem Bedingungswechsel

- Eine bereits beim Aktivieren wahre Bedingung startet keinen Impuls-Clip.
- Erst ein während aktiver Anzeige beobachteter Wechsel von gültig falsch
  zu gültig wahr löst einen Impuls aus.
- Öffnen, Wiedereinblenden und Streamwechsel erzeugen keine künstliche Flanke;
  zwischenzeitliche Ereignisse werden nicht nachträglich abgespielt.
- Dauerhafte Warnungen können den Modus „solange Bedingung wahr“ verwenden.

### D11 – Wiederholte Auslösung laufender Impuls-Clips

- Je Impuls-Clip ist einstellbar, ob eine erneute Auslösung den laufenden Clip
  neu startet oder ignoriert wird. Standard ist Neustart.
- Es gibt weder eine Ereignis-Warteschlange noch überlagerte Instanzen desselben
  Clips. Ein Neustart beginnt am Clip-Anfang, nicht an der aktuellen Position.

### D12 – Eindeutige Clip-Zuständigkeit je Eigenschaft

- Eine Eigenschaft eines Elements darf höchstens einer Keyframe-Spur in genau
  einem Clip gehören. Dies gilt auch bei vermeintlich ausschließenden Bedingungen.
- Andere Eigenschaften desselben Elements dürfen anderen Clips gehören.
- Es gibt keine Prioritäts-/Überlagerungsregeln zwischen konkurrierenden Clips
  derselben Eigenschaft. Kombinationen erfolgen über unterschiedliche Eigenschaften
  oder verschachtelte Gruppen.

### D13 – Konfigurierbarer regulärer Clip-Endzustand

- Nach regulärem Ende eines nicht endlos wiederholten Clips wird entweder auf
  die statischen Grundwerte seiner Eigenschaften zurückgesetzt oder der letzte
  Keyframe-Wert gehalten. Die Wahl gilt je Clip; Standard ist Grundwert.
- Der Grundwert ist ein statischer Eigenschaftswert, keine zusätzliche gleichzeitig
  steuernde Formelbindung.
- Der Endzustand ersetzt nicht die bereits vereinbarten Regeln zu Ungültigkeit,
  ausgeblendetem HUD, Kontrollwechsel oder Neuinitialisierung.

### D14 – Neustart nach Rückkehr gültiger Quelldaten

- Bei ungültigen/veralteten Daten angehaltene datenabhängige Ratenbewegungen
  und bedingungsabhängige Clips starten nach Rückkehr gültiger Daten frisch.
- Die Ausfallzeit wird nicht nachgerechnet; es gibt keinen Phasenerhalt als
  zusätzliche Wahlmöglichkeit.
- Direkte Anzeigen übernehmen aktuelle Werte. Impuls-Clips benötigen weiterhin
  einen neu beobachteten gültigen Wechsel gemäß D10.

### D15 – LiDAR-Gruppen aus dem neuesten einzelnen Rohscan

- Die HUD-Gruppenerkennung verwendet den neuesten einzelnen Rundscan vor dem
  bestehenden Mehrscanfilter, nicht dessen zeitlich vermischtes Ergebnis.
- Die vereinbarte räumliche Gruppenprüfung erfolgt Onboard; in den Browser
  wird weiterhin nur das kompakte Raster übertragen.
- Vorhandene andere LiDAR-Verbraucher und deren Filterkonfiguration bleiben
  unverändert. Es wird kein zusätzlicher HUD-Mehrscanfilter eingeführt.

### D16 – LiDAR-Raster standardmäßig bis 5 Hz

- Neue reduzierte LiDAR-Snapshots werden standardmäßig mit höchstens 5 Hz
  übertragen, bei langsamerer Quelle entsprechend seltener.
- Identische erneut gelesene Scans gelten nicht als neue Messungen. Bei Überlast
  wird der neueste Stand bevorzugt; alte Scans werden nicht nachträglich abgearbeitet.
- Pulsieren und Sweep verwenden die Renderer-Uhr unabhängig von der Messrate.
- Die reale Bandbreite einschließlich Metadaten/Transport ist noch zu messen.

### D17 – Ausdrücklicher LiDAR-HUD-Einrichtungshelfer

- Bestehende Installationen erhalten eine bestätigungspflichtige Aktion
  „LiDAR-HUD-Quelle einrichten“ für den berechtigten Fahrer.
- Der Helfer ergänzt die erforderliche Rasterkanal-Konfiguration gezielt.
- Bloßes Anzeigen oder Veröffentlichen eines HUDs verändert die
  Fahrzeug-/Quellkonfiguration nicht automatisch.

### D18 – Verbindliche statische SVG-Teilmenge

- Unterstützt werden statische Formen/Pfade, Gruppen, Text, statische Gestaltung,
  lineare/radiale Farbverläufe und geometrische Beschneidung.
- Masken, Filter und eingebettete Rasterbilder werden im ersten Umfang nicht
  unterstützt. Sie werden im Bereinigungsbericht gemeldet und aus der sicheren
  Vorschau entfernt; ein unbrauchbares Ergebnis kann abgelehnt werden.
- Die bereits beschlossenen Verbote für Skripte, Event-Handler, externe Ressourcen,
  `foreignObject` und importierte Animationen gelten unverändert.
- Genaue Tag-/Attribut-/CSS-Positivliste und Ressourcenlimits sind noch technisch
  auszuarbeiten; D18 erlaubt nicht beliebige Inhalte in den unterstützten Kategorien.

### D19 – Vollständiger Paketimport ersetzt den Gesamtentwurf

- Import eines vollständigen HUD-Pakets ersetzt nach Prüfung, Quellen-/Stream-
  Zuordnung, Vorschau und Bestätigung Standard und Varianten im lokalen Entwurf.
- Es gibt im ersten Umfang kein automatisches Zusammenführen und keine Auswahl
  einzelner importierter Elemente/Varianten.
- Die Übernahme ist eine Undo-Aktion; der vorherige Entwurf bleibt über Undo
  und Sicherung erreichbar. Danach gelten normale Autosave-/Konfliktregeln.
- Import veröffentlicht niemals unmittelbar einen Stand.

### D20 – Funktionsschreibweise für Formelbedingungen

- Bedingungen verwenden `if(Bedingung, WertWennWahr, WertWennFalsch)` statt
  des ternären `?:`-Operators.
- Nur der ausgewählte Zweig wird ausgewertet.
- Übliche Rechen-/Vergleichsoperatoren und ausdrücklich freigegebene Funktionen
  bilden weiterhin eine begrenzte Ausdruckssprache, kein ausführbares JavaScript.
- `value("lenkung")` ist bislang ein erläuterndes Beispiel. Der vollständige
  Funktionskatalog und die Quellreferenzsyntax werden technisch noch konkretisiert.

### D21 – Mobile Mittelklasse als Leistungsziel

- Referenzniveau der Fahreransicht sind normale Mittelklasse-Smartphones mit
  ungefähr 4–6 GB RAM und aktuellem Browser, nicht ausschließlich Highendgeräte.
- Für animierte HUDs bei laufendem Video werden mindestens flüssige 30 Bilder/s
  angestrebt; höhere Bildraten bei ausreichenden Reserven.
- Konkrete Referenzgeräte, Messverfahren und zulässige Dokumentkomplexität
  sind noch festzulegen und zu prüfen. Diese Entscheidung ist kein bereits
  erbrachter Leistungsnachweis.
- Der vollständige Editor bleibt auf Desktop/Laptop ausgerichtet.

### D22 – Standard-Arbeitsfläche aus der Stream-Auflösung

- Ein neues Standard-Overlay übernimmt Breite/Höhe des ersten konfigurierten
  Streams des Fahrzeugs; eine neue Stream-Variante die ihres Streams.
- Ist keine Auflösung bekannt, gilt 1920 × 1080 als Rückfallwert.
- Die Vorbelegung erfolgt nur beim Anlegen. Spätere Änderungen der
  Stream-Auflösung ändern die Arbeitsfläche nicht automatisch; dafür gilt D04.

### D23 – Clip-Verhalten beim Deaktivieren

- Je Clip wählbar: **sofort stoppen** oder **aktuellen Durchlauf zu Ende
  spielen**. Standard ist sofort stoppen.
- Nach dem Stoppen beziehungsweise dem Ende des Durchlaufs gilt der
  Endzustand gemäß D13. Einfrieren an der aktuellen Position gibt es nicht.
- Die Regeln zu ungültigen Daten (D14), ausgeblendetem HUD und Kontrollwechsel
  haben Vorrang vor „zu Ende spielen“.
- Wird die Bedingung während des Auslaufens wieder wahr, läuft der Clip
  nahtlos im regulären Betrieb weiter: kein Neustart, kein Sprung.

### D24 – Standardfrist dreifaches Leseintervall, mindestens 1 s

- Ohne HUD-Überschreibung gilt ein Wert als veraltet, wenn sein Messalter das
  Dreifache des erwarteten Leseintervalls übersteigt, mindestens jedoch 1 s.
- Das erwartete Intervall ergibt sich Onboard aus Basistakt (derzeit 100 ms)
  × `ReadIntervalTicks` des Readers bzw. aus einer quellspezifischen Angabe.
- Beispiele: 100-ms-Reader → 1 s; 2-Hz-LiDAR → 1,5 s; 1-s-Reader → 3 s.
- Ohne bekannte erwartete Rate ist die Frist explizit festzulegen; es wird kein
  stiller Modulwert übernommen.

### D25 – Autosave- und Sicherungsparameter

- Serverseitiges Autosave nach 2 s ohne weitere Änderung, bei andauernder
  Bearbeitung spätestens alle 30 s.
- Browserlokale Sicherung bei jeder Änderung; je Fahrzeug bleiben die letzten
  fünf Sicherungen erhalten.
- Konflikt-, Berechtigungs- und Wiederherstellungsregeln des Produktplans
  bleiben unverändert.

### D26 – Einheitenumrechnung über explizite Funktionen

- Umrechnungen erfolgen über feste Funktionen wie `rad(x)`/`deg(x)` und
  ausdrückliche Zahlenfaktoren.
- Das Typsystem kennt keine Einheiten-/Dimensionsprüfung. Kanaleinheiten sind
  Metadaten für Anzeige, Vorbelegung und Eingabehilfe.

### D27 – Ungültigkeit pflanzt sich fort, mit expliziter Abfrage

- Ist eine tatsächlich ausgewertete Eingabe fehlend, ungültig oder veraltet,
  ist das Formelergebnis ungültig.
- Eingaben im nicht gewählten `if()`-Zweig beeinflussen das Ergebnis nicht (D20).
- `valid(x)` prüft Gültigkeit ausdrücklich; `fallback(x, y)` liefert `y`, wenn
  `x` ungültig ist. Es gibt keinen impliziten Ersatz durch null.
- Ein gültiges Ergebnis mit mindestens einer ausgewerteten ungeprüften Eingabe
  ist selbst ungeprüft: Wert sichtbar mit gelbem Warndreieck, abhängige Bewegung
  gestoppt. `valid(x)` ist für ungeprüfte Werte wahr.

### D28 – Glättung über Zeitkonstante

- Optionale Glättung direkter Bindungen ist exponentiell mit einer Zeitkonstante
  in Sekunden, unabhängig von Render- und Telemetrierate.
- Winkel verwenden den kürzesten Übergang. Ungültige Daten bewegen die
  geglättete Anzeige nicht weiter.

### D29 – Ergebnistypen Zahl, Bool und Text

- Formeln liefern Zahl, Bool oder Text.
- Text wird nur über `format(x, Dezimalstellen)`, `concat(...)` und Gleichheits-
  vergleiche verarbeitet; keine regulären Ausdrücke oder Teilstring-Funktionen.
- Farben sind kein Formeltyp; dynamische Farben entstehen über `if()`-Auswahl
  statischer Werte oder Keyframes.

### D30 – Angebotene Steuerungs-/Flow-Quellen

- Angeboten werden: fertig berechnete Fahrzeug-Kanalausgänge, benannte
  Flow-Signale (gemäß D08) und das Bool-Signal „aktiver Fahrer vorhanden“.
- Senden/Pause ist **keine** eigene Formelquelle. Der Pausenstatus wird als
  Status der betroffenen Signale geführt und gemäß D09 angezeigt.

### D31 – Verteilrate der Steuerungs-/Flow-Anzeigewerte

- Werte des aktiven Fahrers werden höchstens mit 10 Hz und nur bei Änderung
  verteilt; zusätzlich gibt es alle 1 s ein Keepalive.
- Die Veraltungsfrist beträgt nach D24 1 s.

### D32 – Strenge SVG-Grenzen je Asset

- Höchstens 256 kB Rohdatei und 2000 Elemente nach Bereinigung je Asset.
- Weitere Teilgrenzen (Verschachtelungstiefe, Pfadkoordinaten, Verlaufs-/
  Beschneidungsdefinitionen) werden technisch passend zu diesem strengen
  Rahmen und zum Leistungsziel D21 festgelegt.
- Größere Grafiken müssen vor dem Import vereinfacht werden; sie werden
  abgelehnt, nicht gekürzt.

### D33 – Moderate Dokumentgrenzen

- Je effektiver Ansicht höchstens 500 Elemente.
- Im Gesamtdokument höchstens 200 Clips und 300 Formeln; eine Formel hat
  höchstens 1000 Zeichen und eine Ausdruckstiefe von 32.
- Gesamtdokument höchstens 2 MB JSON, alle referenzierten Assets zusammen
  höchstens 10 MB.
- Die Grenzen gelten nach D18/Produktplan auch für deaktivierte Teile.

### D34 – Austauschpaket als einzelne JSON-Datei

- Export und Import verwenden eine einzelne JSON-Datei mit Dokument und
  eingebetteten bereinigten SVG-Assets als Text. Es gibt kein Archivformat und
  keine zusätzliche Laufzeitbibliothek.
- Dasselbe Format dient als lokaler Sicherungsdownload bei Konflikten.
- Beim Import werden eingebettete Assets erneut vollständig serverseitig
  bereinigt und geprüft (D19, D32).

### D35 – Aufbewahrung von Veröffentlichungen und Revisionen

- Veröffentlichungen und ihre Assets bleiben unbegrenzt erhalten.
- Vom gemeinsamen Entwurf bleiben die letzten 50 Revisionen erhalten.
- Nur vom Entwurf und keiner Veröffentlichung referenzierte, nicht mehr
  benötigte Assets dürfen aufgeräumt werden.

### D36 – Benannte Flow-Signale im HUD-Dokument, Typ Zahl

- Benannte Signale werden fahrzeugweit im HUD-Dokument definiert: stabiler
  Name, Anzeigename, Einheit und Dezimalstellen.
- Der Typ ist immer Zahl, passend zu den heute numerischen Flow-Werten.
  Bool-Bedingungen entstehen per Vergleich in der Formel.
- Signaldefinitionen werden mit dem Dokument versioniert, veröffentlicht und
  exportiert (D34).

### D37 – Zuordnung über Signal-Ausgabeknoten im Flow

- Der Flow-Editor erhält einen neuen Knotentyp „HUD-Signal“ mit einem Eingang.
  Er wird über normale Kanten mit einem beliebigen Knoten/Ausgangsport verbunden
  und einem definierten Signal zugeordnet.
- Mehrere Ausgangsports werden damit über die vorhandene Kantenlogik abgebildet;
  HUD-Bindungen kennen keine Knoten-IDs oder Portnummern.
- Der Knoten erzeugt keine Fahrzeugbefehle. Ein Signal ohne Knoten im Flow des
  aktiven Fahrers ist nicht verfügbar (D08). Mehrere Knoten für dasselbe Signal
  sind ein Diagnosefehler im Flow-Editor.

### D38 – Variante gewinnt bei Strukturkonflikten

- Ausdrückliche Struktur-Überschreibungen einer Variante (D05) bleiben bei
  späteren Standard-Umstrukturierungen bestehen.
- Wird das Ziel einer Überschreibung (z. B. eine Gruppe) im Standard gelöscht,
  entfällt die Überschreibung im Rahmen der bestehenden Löschwarnung.
- Ergeben sich ungültige Strukturen wie Zyklen, entsteht eine ortsgenaue Diagnose;
  die Veröffentlichung ist bis zur Behebung blockiert.

### D39 – Einpassen über eine Wurzel-Transformation

- „Inhalt einpassen“ (D04) ändert keine Elementwerte, Formeln oder Keyframes.
  Stattdessen erhält der Inhalt der betroffenen Arbeitsfläche eine
  proportionale Skalierung mit Versatz auf oberster Ebene.
- Damit wirken Formeln und Animationen unverändert. Die Wurzel-Transformation
  ist sichtbar, bearbeitbar und zurücksetzbar; wiederholtes Einpassen verrechnet
  sie mit der bestehenden.
- Varianten mit eigener Arbeitsfläche haben eine eigene Wurzel-Transformation.

### D40 – LiDAR-Drahtformat: Base64-kodierte uint16-Millimeter

- Je Snapshot 96 Winkelabschnitte × 5 Distanzzonen als unsigned 16-Bit-Werte
  in Millimetern, Little Endian, Reihenfolge Winkelabschnitt-major (T01).
- `0xFFFF` bedeutet „keine Gruppenbelegung“. Die 960 Bytes werden als Base64
  (1280 Zeichen) in einem JSON-Feld übertragen.
- Begleitende JSON-Metadaten: Snapshot-Identität, Messalter, Vollständigkeit/
  Qualität, Zonengrenzen und Formatversion. Feldnamen folgen im Schema.

### D41 – Montageversatz als reiner Drehwinkel

- Die LiDAR-Quellkonfiguration erhält ausschließlich einen Winkelversatz in Grad.
- Abstände bleiben ab Sensor gemessen; es gibt keinen Positionsversatz und
  keine Spiegelung im ersten Umfang.

### D42 – Leistungsprüfung: Drosselung plus echtes Gerät

- Automatisiert per Playwright (zusätzliches Testwerkzeug) in Chromium mit
  4-facher CPU-Drosselung gegen Referenz-HUDs; Ziel Bildzeit p95 ≤ 33 ms.
- Vor der Abnahme zusätzlich ein manueller Check auf einem echten
  Mittelklasse-Android-Gerät gemäß D21.
- Referenz-HUDs und genaue Messszenarien werden mit den Referenzfällen festgelegt.

### D43 – Gemeinsame Verträge als JSON-Schema und Fixtures

- Vertragsquelle ist `Shared/Overlay/` mit JSON-Schema und JSON-Referenzfällen.
- C#- und TypeScript-Typen werden daraus abgeleitet oder dagegen getestet;
  Client- und Servertests laufen gegen dieselben Fixtures.

### D44 – Anzeigen als eigene Elementtypen

- `linearGauge` und `radialGauge` sind eigene Elementtypen mit Wert, Min/Max,
  Skala und Farben; ein gebundener Wert steuert die ganze Anzeige.

### D45 – Generische Schriftfamilien

- Verfügbar sind `sans-serif`, `serif`, `monospace` und `condensed`, jeweils als
  Systemschrift des Geräts. Es gibt keinen Font-Upload und keine gebündelten
  Webfonts; geringe Darstellungsunterschiede je Gerät sind akzeptiert.

### D46 – Quellreferenzen mit Namensräumen

- Formeln referenzieren Quellen über `tel("…")` (Telemetrie), `out("…")`
  (berechneter Steuerkanalausgang), `sig("…")` (benanntes Flow-Signal) und
  `driverActive()`. Damit kollidieren gleichnamige Quellen verschiedener Art nicht.
- `value("…")` aus D20 war nur ein Beispiel und entfällt.

### D47 – Editor-Sperren und -Ausblenden im Entwurf

- `locked` und `editorHidden` werden im gemeinsamen Entwurf gespeichert, sind
  undo-fähig und für den nächsten Fahrer sichtbar.
- Sie haben keine Wirkung auf das veröffentlichte HUD und sind von
  `disabled` (D-Regeln zur Deaktivierung) und `visible` getrennt.

## Spezifikationsstand

### S01 – Dokumentmodell und Property-Katalog v1 (Entwurf)

Liegt unter [Shared/Overlay/](Shared/Overlay/README.md):
Schema, Katalog, Transformationsreihenfolge, Eigenschafts-/Modusmodell,
Variantenauflösung, Diagnoseformat sowie 2 gültige, 7 schema-ungültige und
16 semantisch ungültige Referenzdokumente mit erwarteten Diagnosen.
Das Schema und die Schema-Erwartungen aller Fixtures sind maschinell geprüft;
die Resolver-Erwartungen werden erst mit AP01 ausführbar.

Darin technisch festgelegt, ohne neue Produktentscheidung: ID-Format, Winkel
0° = oben im Uhrzeigersinn, lokale Ursprünge je Elementtyp, statischer Pivot,
`lockAspect` ohne `scaleY`, Diagnosekategorien `structure`/`publish`/`warning`
und die Reihenfolgeregel bei Varianten-Umgruppierung.

## Technisch geprüfte Grundlagen

### T01 – LiDAR-Geometrie und Größenrechnung

- `LidarProtocol`/`LidarScan` stellen 1440 feste Winkelplätze mit 0,25° Abstand
  und ausdrücklicher Fehlwertmarkierung bereit. `ILidarSource.LatestRawScan`
  ist bereits unabhängig von `LatestScan` verfügbar.
- Ein Grundraster von 96 Winkelabschnitten mit 3,75° Breite kann alle
  vorn zentrierten Feldgrenzen für 4/6/8/12/16/24 Sektoren exakt abbilden,
  wenn seine **Feldgrenzen** bei 0° + k × 3,75° liegen. Die Grundfelder selbst
  sind damit nicht vorn zentriert; die zusammengefassten Widget-Sektoren schon.
- Ohne Montageversatz liegen 15 native Winkelplätze in jedem Grundfeld.
  Montageversatz wird vor der Grundrasterzuordnung angewendet.
- 96 × 5 unsigned 16-Bit-Abstände benötigen 960 Binärbytes. Als Base64-Feld
  sind dies 1280 Zeichen je Snapshot beziehungsweise 6400 Bytes/s bei 5 Hz,
  jeweils ohne JSON-Metadaten und Transport-Overhead.
- Zum Vergleich braucht ein kompaktes JSON-Array mit 480 Werten von je
  `5000` insgesamt 2401 Bytes pro Snapshot.
- Dies ist ein rechnerischer Geometrie-/Größennachweis, keine gemessene
  Bandbreiten-/Leistungsabnahme und noch keine vollständige Drahtformatfreigabe.

## Noch zu konkretisieren

Die vollständige Liste und Abnahme stehen unter AP00 in der Paketübersicht.
Insbesondere fehlen noch:

- Element-/Property-Katalog und konkrete Transformationsreihenfolge (D03).
- Konkretes Dokumentschema mit Feldnamen, Identitäten und Variantenstruktur.
- Persistenz-/API-Vertrag: Endpunkte, Fehlerantworten, Ereignisse.
- Grammatik und vollständiger Funktionskatalog (Basis D20, D26–D29).
- Clip-Zustandsmaschine als Spezifikation (Basis D10–D14, D23).
- Telemetrie-Drahtformat, Zeitbasis und Altversionsverhalten (Basis D24).
- Transport-/Herkunftsprüfung der Flow-Signale (Basis D30, D31, D36, D37).
- LiDAR-Metadatenfelder und gemessene Bandbreite (Basis D40, D41).
- SVG-Tag-/Attribut-/CSS-Positivliste und Teilgrenzen (Basis D18, D32).
- Modulports, Dateipfade, Referenzfälle und Referenz-HUDs (Basis D42, D43).

Eine einzelne bestätigte Entscheidung gibt weder AP00 insgesamt noch eine
nachgelagerte Featureimplementierung frei.
