# Fahrzeug-Key als Master: Berechtigungsplan

Stand: 2026-11-06. Status: Plan zur Durchsicht, nichts umgesetzt.
Branch: `feature/vehicle-key-auth` (abgezweigt von `experimental`).

Dieses Dokument legt fest, wer an einem Fahrzeug etwas ändern darf und wie der
Server das durchsetzt. Keine Implementierung wird durch dieses Dokument
automatisch gestartet.

## Ziel

- Der SSH-Key des Fahrzeugs ist der Master. Ändern darf nur, wer eine Challenge
  mit diesem Key signiert hat. Eine zusätzliche Benutzer-Anmeldung gibt es nicht.
- Der Server setzt das für **jeden** schreibenden Zugriff durch, nicht nur die
  Oberfläche.
- Fahrzeuge lassen sich auch konfigurieren, wenn sie offline sind.
- Ein Fahrzeug weist sich beim Server mit seinem Key aus; ein anderer Client
  kann sich nicht mehr als Fahrzeug ausgeben.
- Flows bleiben pro Benutzer, lassen sich aber von anderen ansehen und kopieren.

## Ist-Zustand

So funktioniert es heute:

1. Jeder Browser bekommt beim ersten `GET /api/user/me` einen anonymen Benutzer
   mit einem Cookie, das 10 Jahre gilt.
2. Den privaten Fahrzeug-Key holt sich der Browser vom Fahrzeug im lokalen Netz
   und speichert ihn im localStorage.
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

## Entscheidungen

| Thema | Entscheidung |
|---|---|
| Master | Der SSH-Key des Fahrzeugs. Keine zusätzliche Benutzer-Anmeldung. |
| Prüfung, Fahrzeug online | Das Fahrzeug gibt die Challenge aus und prüft, wie heute. Neu: Die Challenge ist eine Nonce, nur einmal und kurz gültig. |
| Prüfung, Fahrzeug offline | **Vorschlag:** Der Server gibt eine Nonce aus und prüft gegen den Public Key in der DB. Das ergibt eine Konfig-Sitzung, siehe unten. (Abgeleitet aus „Offline-Konfiguration nötig“.) |
| Gültigkeit | Pro Sitzung. Die Berechtigung endet mit der Sitzung; der Browser signiert danach neu, solange er den Key gespeichert hat. |
| Public Key in der DB | TOFU: Bei der ersten Verbindung meldet das Fahrzeug seinen Public Key, danach weist es sich per Signatur aus. Ein anderer Key für dieselbe Identität wird abgelehnt. |
| Key-Abruf | Bleibt so: Der private Key wird im lokalen Netz des Fahrzeugs angeboten. |
| Flow | Bleibt pro Benutzer. Andere Flows desselben Fahrzeugs sind lesbar und lassen sich in den eigenen kopieren. |
| `UserSetups` | Ist nur noch Speicherort für den Flow eines Benutzers, **keine** Berechtigung mehr. |

## Modell

### Sitzungen

Es gibt zwei Sitzungsarten. Beide entstehen nur durch eine Signatur mit dem
Fahrzeug-Key und sind an die Verbindung bzw. das Cookie dieses Browsers
gebunden, nicht an den Benutzer-Datensatz.

| Sitzung | Entsteht | Prüft | Erlaubt | Endet |
|---|---|---|---|---|
| Steuersitzung (gibt es schon) | `AquireCarControl`, Fahrzeug online | Onboard | Fahren, Live-Funktionen (Audio-Sprechen, Dateien, Videostreams schalten) **und** Konfiguration | Freigabe, Abbruch der Verbindung, Timeout am Onboard |
| Konfig-Sitzung (neu) | `POST /api/cars/{id}/config-session` mit Server-Nonce, online wie offline | Server gegen DB-Key | nur Konfiguration, kein Fahren | Abmelden, Schließen des Browsers (Session-Cookie), Leerlauf-Timeout (Vorschlag: 2 h) |

Die Konfig-Sitzung trägt ein zufälliges Token in einem HttpOnly-Cookie pro
Fahrzeug. Der Server speichert nur den Hash, die Fahrzeug-ID und den Ablauf.
Ändert sich der Public Key des Fahrzeugs, verfallen alle Konfig-Sitzungen.

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
| HUD | Overlay `draft`, `publications`, `restore`, `assets` | heute `CanDrive`; **offen:** auf `CanConfigure` lockern, damit HUD offline bearbeitbar ist |
| Fahren und Live | `UpdateChannel`, `StartAudioTalk`/`SendAudioChunk`, `SetVideoStreamEnabled`, Datei-Upload/-Liste/-Löschen, Aufnahme-Schalter, `SetSpeakerVolume` | `CanDrive` |
| Flow (eigener) | `FlowController` schreibend | eigener Benutzer (wie heute), kein Fahrzeug-Recht |
| Flow (fremde) | neu: lesen und kopieren | Lesen: jeder; Kopieren in den eigenen Flow: jeder |
| Nur Onboard | `OpenCarConnection` → neu mit Signatur, `UpdateChannelMap`, `SyncChannelMap`, `RegisterAvailableChannelTypes`, `UpdateTelemetry`, `ReportChannelHealth`, `SendOnboardLogs`, `ReportOnboardVersion`, `ReportFileTransferStatus`, `ReportAudioStatus`, `SendBashOutput` | `IsVehicle` |
| Bash | `CarBashHub` | `CanDrive` (nach Prüfung von L7) |
| Lesen | alle GET-Endpunkte | unverändert offen (siehe offene Fragen) |

### TOFU-Anmeldung des Fahrzeugs

1. `Car` bekommt `PublicKey` (SPKI, Base64) und `PublicKeyFingerprint`.
2. `OpenCarConnection(carIdentityKey, channelMapHash)` wird zweistufig:
   - Der Server gibt per `GetVehicleNonce()` eine Nonce aus.
   - Das Onboard antwortet mit `OpenCarConnection(identity, hash, publicKey, signature)`.
3. Ohne gespeicherten Key: Der Server übernimmt den Key (TOFU) und protokolliert
   den Fingerprint.
4. Mit gespeichertem Key: Die Signatur muss passen, ein anderer Key wird
   abgelehnt (Log-Warnung, Status „Key-Konflikt“ in der UI).
5. Danach wird die Verbindung als Fahrzeug markiert. Erst ab hier sind die
   Nur-Onboard-Methoden für sie erlaubt.
6. Schlüsseltausch: Das Fahrzeug signiert den neuen Key mit dem alten. Fehlt der
   alte Key, setzt ein Admin den Key per CLI/DB zurück (siehe offene Fragen).

### Onboard-Nonce

`SshKeyService.GenerateChallenge()` merkt sich die Challenge mit Ablauf
(Vorschlag: 60 s). `AquireCarControl` nimmt nur eine gemerkte, unverbrauchte
Challenge an und streicht sie danach. Dasselbe gilt für die Server-Nonce der
Konfig-Sitzung und der Fahrzeug-Anmeldung.

### Client

- Der Konfigurationsknopf und der `ConfigGuard` fragen
  `GET /api/cars/{id}/access` → `{ drive, configure, expiresAt }`.
- Hat der Browser den Fahrzeug-Key gespeichert, aber keine Sitzung, startet ein
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
| S1 | Onboard-Nonce (L4) | Unit: Challenge nur einmal, Ablauf, fremde Challenge abgelehnt |
| S2 | `Car.PublicKey` + Migration, TOFU-Anmeldung, Fahrzeug-Markierung der Verbindung, Nur-Onboard-Methoden absichern (L3) | Integration: erster Connect speichert Key, zweiter mit anderem Key abgelehnt, Browser-Verbindung darf `UpdateTelemetry` nicht |
| S3 | `VehicleAccess` mit `CanDrive`/`CanConfigure`, Attribute/Filter | Unit pro Fall |
| S4 | Konfig-Sitzung: Nonce-Endpunkt, Signaturprüfung gegen DB-Key, Cookie, Ablauf, Abmelden | Integration inkl. Fahrzeug offline, Key-Wechsel beendet Sitzungen |
| S5 | Alle schreibenden Endpunkte und Hub-Methoden nach der Tabelle absichern (L1); Selbstausstellung im Template-Import entfernen (L2) | Integration: jeder Endpunkt ohne Sitzung → 403, mit Sitzung → OK |
| S6 | Client: `access`-Endpunkt, Knopf, `ConfigGuard`, automatische Konfig-Sitzung, Merker entfernen (L6) | UI-Tests |
| S7 | Flow fremder Benutzer: Liste, Lesen, Kopieren (Server + Client) | Integration + UI |
| S8 | `CarBashHub` prüfen und absichern (L7) | je nach Befund |

S1 und S2 brauchen ein neues Onboard. Wegen des Auto-Updates laufen Server und
Onboard auf demselben Stand; für den Übergang siehe offene Fragen.

## Offene Fragen

1. **Offline-Prüfung:** Ist die Konfig-Sitzung mit Server-Prüfung gegen den
   DB-Key so in Ordnung? (Sie ist nötig für Offline-Konfiguration.)
2. **Leerlauf-Timeout** der Konfig-Sitzung: 2 h passend?
3. **HUD offline:** Soll der HUD-Editor auch mit Konfig-Sitzung speichern und
   veröffentlichen dürfen, also ohne Fahrer zu sein?
4. **Lesen:** Bleibt das Lesen der Konfiguration für alle offen, oder nur mit
   Sitzung?
5. **Übergang:** Fahrzeuge mit altem Onboard melden noch keinen Key. Ein
   Schalter `Security:AllowUnauthenticatedVehicles` für eine Übergangszeit,
   oder gleich hart ablehnen?
6. **Key-Reset ohne alten Key** (Fahrzeug neu aufgesetzt): Admin-CLI, eigener
   Server-Endpunkt mit Admin-Passwort, oder nur direkt in der DB?
7. **Bestehende `UserSetups`-Einträge:** Bleiben als Flow-Speicher. Sollen
   leere Einträge (ohne Flow) aufgeräumt werden?
