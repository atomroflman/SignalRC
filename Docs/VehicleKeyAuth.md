# Halter-Key als Master: Berechtigungsplan

Stand: 2026-11-06. Status: Plan abgestimmt, nichts umgesetzt.
Branch: `feature/vehicle-key-auth` (abgezweigt von `experimental`).

Dieses Dokument legt fest, wer an einem Fahrzeug etwas ändern darf und wie der
Server das durchsetzt. Keine Implementierung wird durch dieses Dokument
automatisch gestartet.

## Ziel

- Der Halter-Key des Fahrzeugs (`ssh_key`) ist der Master. Ändern und
  Konfiguration lesen darf nur, wer eine Challenge mit diesem Key signiert hat.
  Eine zusätzliche Benutzer-Anmeldung gibt es nicht.
- Der Server setzt das für **jeden** Zugriff auf die Konfiguration durch, nicht
  nur die Oberfläche.
- Fahrzeuge lassen sich auch konfigurieren, wenn sie offline sind.
- Ein Fahrzeug weist sich beim Server mit einem eigenen Geräte-Key aus; ein
  anderer Client kann sich nicht mehr als Fahrzeug ausgeben.
- Flows bleiben pro Benutzer, lassen sich aber von anderen ansehen und kopieren.

## Ist-Zustand

So funktioniert es heute:

1. Jeder Browser bekommt beim ersten `GET /api/user/me` einen anonymen Benutzer
   mit einem Cookie, das 10 Jahre gilt.
2. Das Onboard erzeugt beim ersten Start `ssh_key` (privat) und `ssh_key.pub`.
   Den privaten Key holt sich der Browser **einmal** im lokalen Netz
   (Port 8080/8443, nur mit dem Identitäts-Hash vom Server) und speichert ihn im
   localStorage. Danach löscht das Onboard `ssh_key`, außer `KeepPrivateKey`
   ist gesetzt. Im Normalbetrieb hat das Fahrzeug also nur den Public Key: Es
   kann Signaturen prüfen, aber selbst nichts signieren.
3. `AquireCarControl`: Das Fahrzeug gibt eine Challenge aus, der Browser
   signiert, das Onboard prüft gegen seinen Public Key und vergibt eine
   Steuersitzung.
4. Danach legt der Server dauerhaft einen `UserSetups(UserId, CarId)`-Eintrag an.
   `has-config-access` und der `ConfigGuard` behandeln diesen Eintrag als
   Konfigurationsrecht.

Lücken:

| # | Lücke | Schwere |
|---|---|---|
| L1 | `ChannelsController` (11 schreibende Endpunkte: Pin-Manager, Steuer-, Telemetrie- und Videokanäle, Audio) prüft weder Benutzer noch Berechtigung. Es gibt kein `[Authorize]` und keine globale Policy. Dasselbe gilt für `SoundsController`, `TemplatesController` (Template anwenden) und `LidarGridSourceController`. | kritisch |
| L2 | `POST /api/setuptemplate/import/{carId}` legt den `UserSetups`-Eintrag für jedes Fahrzeug ohne Key-Nachweis an. Damit stellt man sich das Konfigurationsrecht selbst aus. | hoch |
| L3 | Hub-Methoden, die nur das Onboard aufrufen soll (`OpenCarConnection`, `UpdateChannelMap`, `SyncChannelMap`, `UpdateTelemetry`, `ReportChannelHealth`, `SendOnboardLogs`, `ReportOnboardVersion`, `ReportAudioStatus` …), kann jeder Client aufrufen. Ein Fahrzeug meldet sich nur mit dem `CarIdentityKey`-String an. | hoch |
| L4 | Das Onboard merkt sich die ausgegebene Challenge nicht. Ein mitgeschnittenes Paar aus Challenge und Signatur lässt sich wiederverwenden. | mittel |
| L5 | Der `UserSetups`-Eintrag verfällt nie, auch nicht nach einem Schlüsseltausch. | mittel |
| L6 | Der `ConfigGuard` prüft nur im Client; der localStorage-Merker `car_auth_{id}` lässt sich von Hand setzen. | mittel (nur UI) |
| L7 | `CarBashHub` leitet Befehle ohne Prüfung weiter. Ob und wie das Onboard sie ausführt (`BashToolService`), ist noch zu prüfen. | zu prüfen |

Bereits richtig: Overlay/HUD (`OverlayAccess.CheckAdmin`) und die
Aufnahme-Schalter der Telemetrie-Historie prüfen serverseitig, ob der Aufrufer
gerade Fahrer ist.

Verbindungsaufbau des Onboards heute (`ServerConnectionService`):

1. `GET /api/version` per HTTP, nur Vergleich und Log-Warnung.
2. `OpenCarConnection(carIdentityKey, hash)`. Der `CarIdentityKey` ist die
   CPU-Seriennummer oder eine Override-Datei.
3. Wendet die gelieferte Kanalzuordnung an (nur wenn `ChannelMap != null`).
4. `ReportOnboardVersion`, `RegisterAvailableChannelTypes`.
5. `OnboardUpdateService.OnHandshakeAsync()`: bestätigt ein neues Release und
   startet bei Abweichung das Auto-Update.

Schritt 5 läuft nur, wenn 2 bis 4 ohne Ausnahme durchlaufen. Ein abgelehnter
Handshake verhindert also sowohl das Auto-Update als auch die
Release-Bestätigung (nach 3 Fehlstarts folgt ein Rollback).

## Entscheidungen

| Thema | Entscheidung |
|---|---|
| Zwei Schlüssel | **Halter-Key** (`ssh_key`, wie heute): Der private Teil liegt beim Halter im Browser, das Fahrzeug hat den Public Key. Er ist der Master für alle Änderungen. **Geräte-Key** (neu, `device_key`): wird auf dem Onboard erzeugt, verlässt es nie und dient nur dazu, dass sich das Fahrzeug beim Server ausweist. |
| Master | Der Halter-Key. Keine zusätzliche Benutzer-Anmeldung. |
| Prüfung, Fahrzeug online | Das Fahrzeug gibt die Challenge aus und prüft, wie heute. Neu: Die Challenge ist eine Nonce, nur einmal und kurz gültig. |
| Prüfung, Fahrzeug offline | Der Server gibt eine Nonce aus und prüft gegen den Halter-Public-Key in der DB. Das ergibt eine Konfig-Sitzung, siehe unten. |
| Gültigkeit | Pro Sitzung. Die Berechtigung endet mit der Sitzung; der Browser signiert danach neu, solange er den Key gespeichert hat. |
| Fahrzeug-Anmeldung | Geräte-Key per TOFU: Bei der ersten Anmeldung übernimmt der Server dessen Public Key, danach signiert das Fahrzeug bei jeder Verbindung eine Server-Nonce. Ein anderer Geräte-Key für dieselbe Identität wird abgelehnt. |
| Halter-Public-Key in der DB | Meldet das Onboard nach erfolgreicher Geräte-Anmeldung. Nur von einem angemeldeten Fahrzeug übernommen. |
| Alte Onboards | Update-Modus: Ein Handshake ohne Geräte-Anmeldung gibt keine Rechte, reicht aber für Versionsmeldung, Auto-Update und Release-Bestätigung (siehe unten). |
| Key-Abruf | Bleibt so: Der private Halter-Key wird einmal im lokalen Netz des Fahrzeugs angeboten. |
| Key-Reset | Nur direkt in der DB (Spalten leeren, siehe unten). Kein eigenes Werkzeug. |
| HUD | Speichern und Veröffentlichen auch mit Konfig-Sitzung, also auch offline und ohne Fahrer zu sein. |
| Lesen | Auch das Lesen der Konfiguration braucht eine Steuer- oder Konfig-Sitzung. Die Fahransicht (Video, Live-Telemetrie) bleibt davon unberührt. |
| Flow | Bleibt pro Benutzer. Andere Flows desselben Fahrzeugs sind lesbar und lassen sich in den eigenen kopieren. |
| `UserSetups` | Ist nur noch Speicherort für den Flow eines Benutzers, **keine** Berechtigung mehr. |

## Modell

### Sitzungen

Es gibt zwei Sitzungsarten. Beide entstehen nur durch eine Signatur mit dem
Halter-Key und sind an die Verbindung bzw. das Cookie dieses Browsers
gebunden, nicht an den Benutzer-Datensatz.

| Sitzung | Entsteht | Prüft | Erlaubt | Endet |
|---|---|---|---|---|
| Steuersitzung (gibt es schon) | `AquireCarControl`, Fahrzeug online | Onboard | Fahren, Live-Funktionen (Audio-Sprechen, Dateien, Videostreams schalten) **und** Konfiguration | Freigabe, Abbruch der Verbindung, Timeout am Onboard |
| Konfig-Sitzung (neu) | `POST /api/cars/{id}/config-session` mit Server-Nonce, online wie offline | Server gegen Halter-Public-Key in der DB | Konfiguration lesen und ändern, HUD, kein Fahren | Abmelden, Schließen des Browsers (Session-Cookie), Leerlauf-Timeout 2 h |

Die Konfig-Sitzung trägt ein zufälliges Token in einem HttpOnly-Cookie pro
Fahrzeug. Der Server speichert nur den Hash, die Fahrzeug-ID und den Ablauf.
Ändert sich der Halter-Public-Key des Fahrzeugs, verfallen alle Konfig-Sitzungen.
Solange der Server noch keinen Halter-Public-Key kennt, gibt es keine
Konfig-Sitzung, nur die Steuersitzung.

### Server-Prüfung

Eine zentrale Stelle `VehicleAccess` (ersetzt `has-config-access` und erweitert
`OverlayAccess`):

- `CanConfigure(carId)`: Der Aufrufer hält eine Steuersitzung oder eine gültige
  Konfig-Sitzung für dieses Fahrzeug.
- `CanDrive(carId)`: Der Aufrufer hält die Steuersitzung (wie
  `OverlayAccess.CheckAdmin` heute).
- `IsVehicle(connection)`: Die Hub-Verbindung gehört zum per Key angemeldeten
  Fahrzeug.

Umsetzung als Endpoint-Filter bzw. Attribut (`[RequiresVehicleConfig]`,
`[RequiresVehicleDriver]`) und als Prüfung am Anfang der Hub-Methoden. Fehlt
die Berechtigung, antwortet der Server mit 403.

### Zuordnung der Zugriffe

| Bereich | Endpunkte / Hub-Methoden | Braucht |
|---|---|---|
| Fahrzeugkonfiguration | `ChannelsController` (PUT/DELETE, Audio-Scan/-Test/-Einstellungen), `SoundsController` (POST/DELETE), `TemplatesController` apply, `SetupTemplate` import (ohne Anlage eines Setup-Eintrags als Recht), `LidarGridSource`, `ChangeVideoStreamSettings`, `OnboardLogs` DELETE, Telemetrie-Historie `settings`/`dashboard`/Sitzung löschen | `CanConfigure` |
| HUD | Overlay `draft`, `publications`, `restore`, `assets` | `CanConfigure` (heute `CanDrive`; wird gelockert, damit HUD offline bearbeitbar ist) |
| Fahren und Live | `UpdateChannel`, `StartAudioTalk`/`SendAudioChunk`, `SetVideoStreamEnabled`, Datei-Upload/-Liste/-Löschen, Aufnahme-Schalter, `SetSpeakerVolume` | `CanDrive` |
| Flow (eigener) | `FlowController` schreibend | eigener Benutzer (wie heute), kein Fahrzeug-Recht |
| Flow (fremde) | neu: lesen und kopieren | Lesen: jeder; Kopieren in den eigenen Flow: jeder |
| Nur Onboard | `OpenCarConnection` → neu mit Geräte-Signatur, `UpdateChannelMap`, `SyncChannelMap`, `RegisterAvailableChannelTypes`, `UpdateTelemetry`, `ReportChannelHealth`, `SendOnboardLogs`, `ReportOnboardVersion`, `ReportFileTransferStatus`, `ReportAudioStatus`, `SendBashOutput` | `IsVehicle` |
| Bash | `CarBashHub` | `CanDrive` (nach Prüfung von L7) |
| Konfiguration lesen | GET auf Kanäle, Pin-Manager, Optionen, Sounds, Audio-Einstellungen, Overlay-Entwurf und -Historie, Onboard-Log, Telemetrie-Historie, Templates des Fahrzeugs | `CanConfigure` |
| Fahransicht | Fahrzeugliste, Live-Status, Videostreams, Live-Telemetrie, veröffentlichtes HUD, Version | offen wie heute |

Welche GET-Endpunkte die Fahransicht braucht, wird in S5 einzeln festgelegt
(Liste im Code am Filter, Test pro Endpunkt).

### Anmeldung des Fahrzeugs (Geräte-Key)

1. Das Onboard erzeugt beim Start `device_key`/`device_key.pub`, falls nicht
   vorhanden. Der Geräte-Key wird **nie** ausgeliefert: kein LAN-Listener,
   kein Hub, kein REST.
2. `Car` bekommt `DevicePublicKey` und `OwnerPublicKey` (SPKI, Base64) sowie
   deren Fingerprints.
3. Handshake neu:
   - `GetVehicleNonce()` liefert eine Server-Nonce (einmal gültig, 60 s).
   - `OpenCarConnection(identity, hash, devicePublicKey, signature)` mit der
     Signatur des Geräte-Keys über die Nonce.
4. Kennt der Server noch keinen Geräte-Key für diese Identität, übernimmt er ihn
   (TOFU) und protokolliert den Fingerprint.
5. Kennt er einen, muss die Signatur dazu passen. Ein anderer Geräte-Key wird
   abgelehnt: Log-Warnung, Status „Key-Konflikt“ in der UI, die Verbindung
   bleibt im Update-Modus.
6. Nach erfolgreicher Anmeldung wird die Verbindung als Fahrzeug markiert. Erst
   dann gelten die Nur-Onboard-Methoden, und erst dann wird sie im
   Connection-Store als Verbindung des Fahrzeugs eingetragen.
7. Das angemeldete Fahrzeug meldet `ReportOwnerPublicKey(ssh_key.pub)`. Ein
   neuer Halter-Key (Fahrzeug hat `ssh_key` neu erzeugt) wird übernommen und
   beendet alle Konfig-Sitzungen.

### Update-Modus

Gilt für jede Verbindung ohne erfolgreiche Geräte-Anmeldung: alte Onboards,
Key-Konflikte, Fälscher.

- `OpenCarConnection` gelingt, liefert aber **keine** Kanalzuordnung
  (`ChannelMap = null`). Das Onboard behält seine lokale Zuordnung.
- `ReportOnboardVersion`, Update-Statusmeldungen und
  `ReportFileTransferStatus` sind erlaubt, damit Auto-Update und
  Release-Bestätigung laufen. Die Paket-Downloads sind ohnehin anonym.
- Alle anderen Nur-Onboard-Methoden (`RegisterAvailableChannelTypes`,
  `UpdateTelemetry`, `ReportChannelHealth`, `SendOnboardLogs`,
  `UpdateChannelMap` …) werden **stillschweigend ignoriert**, nicht mit
  Ausnahme abgelehnt. Grund: Das alte Onboard ruft sie im Handshake vor
  `OnHandshakeAsync()` auf; eine Ausnahme würde den Handshake abbrechen und das
  Update verhindern.
- Die Verbindung wird nicht als Fahrzeugverbindung eingetragen. Sie bekommt
  keine Steuerbefehle, und `AquireCarControl` wird nicht an sie weitergeleitet.
  Eine echte, angemeldete Verbindung wird nie verdrängt.
- In der UI erscheint das Fahrzeug als „Update ausstehend“ bzw. „Key-Konflikt“.
- Onboards mit abgeschaltetem Auto-Update bleiben im Update-Modus, bis sie
  einmal vor Ort per `update.sh` aktualisiert werden.

### Key-Reset

Nur direkt in der DB, kein eigenes Werkzeug:

- Geräte neu aufgesetzt (neuer Geräte-Key, Verbindung hängt im
  Update-Modus mit „Key-Konflikt“): `DevicePublicKey` und Fingerprint des
  Fahrzeugs leeren. Die nächste Anmeldung übernimmt den neuen Key per TOFU.
- Halter-Key verloren: Auf dem Fahrzeug `ssh_key.pub` löschen, das Onboard
  erzeugt beim Neustart ein neues Paar und meldet den neuen Halter-Public-Key
  selbst. Ein DB-Eingriff ist dafür nicht nötig.

### Onboard-Nonce

`SshKeyService.GenerateChallenge()` merkt sich die Challenge mit Ablauf
(Vorschlag: 60 s). `AquireCarControl` nimmt nur eine gemerkte, unverbrauchte
Challenge an und streicht sie danach. Dasselbe gilt für die Server-Nonce der
Konfig-Sitzung und der Fahrzeug-Anmeldung.

### Client

- Der Konfigurationsknopf und der `ConfigGuard` fragen
  `GET /api/cars/{id}/access` → `{ drive, configure, expiresAt }`.
- Hat der Browser den Halter-Key gespeichert, aber keine Sitzung, startet ein
  Klick auf „Konfigurieren“ automatisch eine Konfig-Sitzung (signiert im
  Hintergrund).
- Ohne gespeicherten Key und ohne Sitzung erscheint der Knopf nicht.
- Der localStorage-Merker `car_auth_{id}` entfällt.
- Flow-Seite: neues Panel „Flows anderer Fahrer“ mit Liste, Vorschau
  (nur lesen) und „In meinen Flow kopieren“. Beim Kopieren wird der eigene Flow
  ersetzt, wie beim Template-Import, mit Rückfrage.

## Umsetzungsschritte

| Schritt | Inhalt | Tests |
|---|---|---|
| S1 | Onboard-Nonce für die Halter-Challenge (L4) | Unit: Challenge nur einmal, Ablauf, fremde Challenge abgelehnt |
| S2 | Geräte-Key auf dem Onboard, `Car.DevicePublicKey`/`OwnerPublicKey` + Migration, neuer Handshake mit Server-Nonce, TOFU, `ReportOwnerPublicKey`, Fahrzeug-Markierung der Verbindung (L3) | Integration: erster Connect speichert Key, anderer Geräte-Key → Konflikt, Browser-Verbindung darf `UpdateTelemetry` nicht |
| S3 | Update-Modus: Handshake ohne Kanalzuordnung, stilles Ignorieren, kein Eintrag im Connection-Store, UI-Status | Integration mit einem Handshake im **alten** Ablauf (ohne Signatur): `OnHandshakeAsync` wird erreicht, keine Ausnahme; echte Verbindung wird nicht verdrängt |
| S4 | `VehicleAccess` mit `CanDrive`/`CanConfigure`/`IsVehicle`, Attribute/Filter | Unit pro Fall |
| S5 | Konfig-Sitzung: Nonce-Endpunkt, Signaturprüfung gegen Halter-Public-Key, Cookie, 2 h Leerlauf, Abmelden | Integration inkl. Fahrzeug offline, neuer Halter-Key beendet Sitzungen |
| S6 | Alle Endpunkte und Hub-Methoden nach der Tabelle absichern, schreibend und lesend (L1); Selbstausstellung im Template-Import entfernen (L2) | Integration: jeder Endpunkt ohne Sitzung → 403, mit Sitzung → OK; Fahransicht ohne Sitzung weiter OK |
| S7 | Client: `access`-Endpunkt, Knopf, `ConfigGuard`, automatische Konfig-Sitzung, Merker entfernen (L6), Status „Update ausstehend“/„Key-Konflikt“ | UI-Tests |
| S8 | Flow fremder Benutzer: Liste, Lesen, Kopieren (Server + Client) | Integration + UI |
| S9 | `CarBashHub` prüfen und absichern (L7) | je nach Befund |

Reihenfolge beim Ausrollen: Server und Onboard kommen aus demselben Commit. Der
neue Server nimmt alte Onboards im Update-Modus an; sie aktualisieren sich
selbst und melden sich danach mit Geräte-Key an. Zwischen Server-Update und
Onboard-Update ist das Fahrzeug nicht steuerbar.

## Offene Fragen

1. **Bestehende `UserSetups`-Einträge:** Vorschlag: bleiben unverändert als
   Flow-Speicher, kein Aufräumen.
