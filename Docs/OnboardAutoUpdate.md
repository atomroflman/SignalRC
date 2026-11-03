# Onboard-Auto-Update: Implementierungsplan

Stand: 2026-11-03. Status: Plan abgestimmt, noch nicht umgesetzt.
Branch: `feature/onboard-auto-update` (abgezweigt von `feature/overlay-ap01`).

Dieses Dokument legt fest, wie die Onboard Units ihre Software künftig vom
Server beziehen, statt sie per `git pull` selbst zu bauen. Keine Implementierung,
Installation oder Bereitstellung wird durch dieses Dokument automatisch gestartet.

## Ziel

- Der Server baut beim eigenen Docker-Build die Onboard-Pakete für `linux-arm64`
  und `linux-x64` und bietet sie als ZIP zum Download an.
- Eine Onboard Unit erkennt beim Verbinden, dass ihr Commit vom Server abweicht,
  lädt das passende Paket, installiert es neben die laufende Version und startet
  neu.
- Das automatische Update ist pro Onboard Unit über `appSettings.json` ein- und
  ausschaltbar. Zusätzlich kann ein Fahrer mit SSH-authentifizierter
  Steuersitzung das Update manuell aus der GUI auslösen.
- Startet eine neue Version nicht sauber, schaltet die Onboard Unit selbst auf
  die vorherige Version zurück.

## Entscheidungen

| Thema | Entscheidung |
|---|---|
| Architekturen | `linux-arm64` und `linux-x64`, je ein ZIP, framework-dependent (ohne eigene Runtime). Kein armv7/armv6. |
| Download | Anonym, wie `/api/version` und das Install-Skript. Integrität über SHA256 aus dem Manifest und HTTPS. |
| Auslöser | Jede Abweichung von Commit **oder** Branch zum Server. Die Onboard Unit übernimmt immer den Serverstand, auch Feature-Branches und Rücksprünge. |
| Automatisches Update | Nur bei `AutoUpdate.Enabled = true` und nur ohne aktive Steuersitzung. Ist ein Fahrer verbunden, wartet das Update, bis die Sitzung endet. |
| Manuelles Update | Nur wer eine per SSH-Schlüssel authentifizierte Steuersitzung hält. Funktioniert auch bei `AutoUpdate.Enabled = false`. Ignoriert die Sperrliste des Rollbacks. |
| Während des Updates | Controls auf neutral (`Control.ReleaseControl`), weitere Steuerbefehle werden ignoriert, die GUI sperrt die Bedienelemente und zeigt den Fortschritt. Nach dem Neustart ist die Sitzung weg. |
| Rollback | Nach 3 Starts ohne erfolgreichen Server-Handshake zurück auf das vorherige Release. Der fehlerhafte Commit wird gesperrt, bis der Server einen anderen Commit meldet. |
| Aufbewahrung | Aktuelles Release + 3 vorherige. |
| Fehlende .NET-Runtime | Update auslassen und den Grund melden. Keine automatische Runtime-Installation. |
| Ablageort | `Onboard/releases/<commit>/` im Repo (gitignored), Symlink `Onboard/current`. Arbeitsverzeichnis bleibt `Onboard/`. |
| `update.sh` | Baut weiter lokal aus Git, publiziert aber ebenfalls nach `Onboard/releases/<commit>/` und setzt `current`. Migriert bestehende Units einmalig. |
| Build-Fehler | Schlägt das Onboard-Paket fehl, schlägt der ganze Server-Build fehl. Server und Pakete sind so immer auf demselben Commit. |

## Warum das Sperren der Dateien kein Problem ist

Unter Linux sperrt ein laufender Prozess seine DLLs nicht. Gefährlich ist nur,
geladene Dateien **an Ort und Stelle** zu überschreiben (z. B. ein ZIP über den
laufenden Ordner entpacken). Deshalb wird nie in den laufenden Ordner
geschrieben:

1. Paket in einen neuen Ordner `releases/<commit>/` entpacken.
2. Symlink `current` atomar per `rename(2)` auf den neuen Ordner umsetzen.
3. Prozess sauber beenden. systemd (`Restart=always`) startet ihn neu, jetzt aus
   dem neuen Ordner.

Der alte Ordner bleibt unberührt und dient als Rollback-Ziel. Weder sudo noch
ein separater Updater-Prozess sind nötig.

## Ist-Zustand (relevant für den Plan)

- `signalrc-onboard.service` startet
  `$DOTNET_ROOT/dotnet $REPO/Onboard/bin/Release/net10.0/publish/SignalRC.Onboard.dll`
  mit `WorkingDirectory=$REPO/Onboard` (`install.sh`, Phase 5).
- Konfiguration und Zustand liegen relativ zum Arbeitsverzeichnis, nicht neben
  der DLL: `appSettings.json`, `channelMap.json`, `channels.sqlite`, `ssh_key*`
  (`ConfigLoader`, `Program.cs`). `mediamtx` wird über `./Extern/mediamtx`
  gefunden (`MediaMtxConfigurator`). Das bleibt alles unverändert.
- `Tools/video_stack_check.py` wird neben der Assembly gesucht und ist damit Teil
  jedes Release-Ordners.
- `ServerConnectionService.CheckServerVersionAsync` vergleicht beim Verbinden
  Branch und Commit mit `/api/version` und loggt bisher nur eine Warnung.
- `VersionController` liefert `/api/version` und `/api/cars/{id}/version-sync`;
  `version-banner.tsx` zeigt die Abweichung in der GUI.
- Steuersitzungen: `ControlService.AquireCarControl` prüft die SSH-Signatur und
  vergibt eine `sessionId`. Sitzungsgebundene Befehle (`UpdateChannel`,
  `ExecuteBashCommand`, Dateitransfer) prüfen diese `sessionId` auf der
  Onboard Unit. Eine Sitzung gilt als aktiv, solange `_sessionId` gesetzt ist und
  der letzte Steuerbefehl weniger als 30 s zurückliegt.
- Es gibt keine `.dockerignore`. Ein `COPY Onboard/` würde lokale `bin/`- und
  `obj/`-Ordner (inkl. `project.assets.json` des Hosts) in den Build kopieren.

## Zielbild auf der Onboard Unit

```
$REPO/Onboard/
├── appSettings.json            # unverändert, Ort der Konfiguration
├── channelMap.json, channels.sqlite, ssh_key*
├── Extern/mediamtx             # unverändert
├── current -> releases/3f2a9c1e7b04
└── releases/
    ├── 3f2a9c1e7b04/           # aktuelles Release (Inhalt eines ZIPs bzw. dotnet publish)
    ├── 91c0d4e2aa17/           # bis zu 3 vorherige
    ├── .download/              # temporär: ZIP während des Downloads
    └── .state/
        ├── pending             # nur während ein neues Release unbestätigt ist
        ├── blocked             # gesperrte Commits, einer pro Zeile
        └── last-rollback       # Commit des letzten Rollbacks, zum Melden an den Server
```

- Release-Ordner heißen nach den ersten 12 Zeichen des Commits.
- `pending` ist ein einfaches `key=value`-Format, damit das Shell-Skript es ohne
  `jq` lesen kann:
  ```
  commit=3f2a9c1e7b04
  previous=91c0d4e2aa17
  attempts=0
  ```
- systemd-Unit:
  ```
  ExecStartPre=$REPO/scripts/onboard-prestart.sh
  ExecStart=$DOTNET_ROOT/dotnet $REPO/Onboard/current/SignalRC.Onboard.dll
  WorkingDirectory=$REPO/Onboard
  Restart=always
  ```
- `.gitignore`: `Onboard/releases/` und `Onboard/current`.

## Abläufe

### Automatisches Update

1. Onboard verbindet sich, `OpenCarConnection`-Handshake ist erfolgreich.
2. `CheckServerVersionAsync` stellt eine Abweichung fest und übergibt an den
   `OnboardUpdateService`.
3. Der Dienst prüft der Reihe nach:
   `AutoUpdate.Enabled` → Server-Commit nicht in `blocked` → Paket für die eigene
   Architektur im Manifest → benötigte .NET-Runtime installiert.
   Scheitert eine Prüfung, meldet er den Status und hört auf.
4. Läuft gerade eine Steuersitzung, meldet er `WaitingForDriver` und wartet auf
   `ControlService.SessionChanged` (Sitzung beendet oder abgelaufen).
5. Download nach `.download/`, SHA256 prüfen, entpacken nach
   `releases/<commit>.tmp/`, umbenennen in `releases/<commit>/`.
6. `pending` schreiben (`attempts=0`), `current` atomar umsetzen.
7. Status `Restarting` melden, Controls freigeben, Host sauber herunterfahren,
   Prozess beenden. systemd startet neu.

### Manuelles Update

1. Die GUI zeigt den Button „Jetzt aktualisieren“ nur, wenn die Versionen
   abweichen, ein Paket verfügbar ist und **dieser Browser die Steuersitzung
   hält**.
2. Klick → `RequestOnboardUpdate(carId, sessionId)` an den Server → Server leitet
   an die Onboard Unit weiter: `StartOnboardUpdate(sessionId)`.
3. Die Onboard Unit prüft `sessionId == _sessionId`, sonst Ablehnung.
4. Sofort: `Control.ReleaseControl()`, ab jetzt werden `UpdateChannel`-Befehle
   ignoriert. Status `Downloading` geht an die GUI, die die Bedienelemente sperrt.
5. Weiter wie automatisches Update ab Schritt 5. `AutoUpdate.Enabled` und die
   Sperrliste werden ignoriert, die Runtime-Prüfung nicht.
6. Schlägt das Update vor dem Umschalten fehl, bleibt die alte Version laufen.
   Die Sitzung wird beendet; der Fahrer muss die Steuerung neu übernehmen.

### Bestätigung und Rollback

- `scripts/onboard-prestart.sh` (läuft vor jedem Start als Service-User):
  - Kein `pending` → nichts tun.
  - Sonst `attempts` um 1 erhöhen. Ist `attempts > 3`: `current` auf `previous`
    zurücksetzen, `commit` an `blocked` anhängen, `last-rollback` schreiben,
    `pending` löschen.
  - Beendet sich **immer mit 0**. Ein Fehler in `ExecStartPre` würde sonst den
    Start verhindern.
- Die Anwendung bestätigt ein Release nach dem ersten erfolgreichen
  `OpenCarConnection`-Handshake: Steht in `pending` der eigene Commit, wird
  `pending` gelöscht.
- Läuft die Anwendung, verbindet sich aber nicht (z. B. Absturz in einem Dienst
  ohne Prozessende), beendet sie sich nach `AutoUpdate.ConfirmTimeoutMinutes`
  (Standard 10) selbst, sofern `pending` ihren Commit nennt. Das zählt als
  Fehlstart.
- Bekannte Grenze: Fällt LTE direkt nach einem Update für länger als
  3 × Timeout aus, wird ein eigentlich funktionierendes Release zurückgerollt
  und gesperrt. Das ist hinnehmbar: Die vorherige Version läuft, die Sperre fällt
  beim nächsten Server-Commit, und das manuelle Update ignoriert sie.
- Nach einem Rollback meldet die Anwendung `RolledBack` mit dem gesperrten
  Commit (aus `last-rollback`) an den Server.
- `blocked` wird geleert, sobald der Server einen Commit meldet, der nicht
  darin steht.

### Aufräumen

Nach jeder erfolgreichen Bestätigung werden Release-Ordner gelöscht, bis nur das
aktuelle und die 3 zuletzt installierten übrig sind. Nie gelöscht werden das
Ziel von `current` und das in `pending` als `previous` eingetragene Release.
`.download/` und `*.tmp/` werden beim Start immer geleert.

## Schnittstellen

### HTTP (Server)

- `GET /api/onboard/packages` → Manifest, anonym:
  ```json
  {
    "branch": "feature/onboard-auto-update",
    "commit": "3f2a9c1e7b04…",
    "packages": {
      "linux-arm64": { "url": "/api/onboard/packages/linux-arm64", "sha256": "…", "size": 18234567, "framework": "10.0" },
      "linux-x64":   { "url": "/api/onboard/packages/linux-x64",   "sha256": "…", "size": 18011234, "framework": "10.0" }
    }
  }
  ```
  Ohne Pakete (z. B. `dotnet run` ohne Docker) ist `packages` leer.
- `GET /api/onboard/packages/{rid}` → ZIP, anonym, mit Range-Support
  (`enableRangeProcessing`).
- `/api/cars/{id}/version-sync` liefert zusätzlich den letzten Update-Status der
  Onboard Unit.

### SignalR (Shared-Verträge)

- Browser → Server (`IConnectionHubServer`):
  `Task<OnboardUpdateRequestResult> RequestOnboardUpdate(int carId, string sessionId)`
- Server → Onboard (`IControlClient`):
  `Task<OnboardUpdateRequestResult> StartOnboardUpdate(string sessionId)`
- Onboard → Server (`IConnectionHubServer`):
  `Task ReportOnboardUpdateStatus(OnboardUpdateStatus status)`
- Server → Browser-Gruppe `Car-{carId}`: Statusänderung pushen, analog
  `UpdateCarUiDriverStateAsync`.

`OnboardUpdateStatus` (MessagePack, in `Shared/Update/`):

| Feld | Bedeutung |
|---|---|
| `State` | `Disabled`, `UpToDate`, `Checking`, `WaitingForDriver`, `Downloading`, `Installing`, `Restarting`, `Failed`, `RolledBack`, `Blocked`, `NoPackage`, `RuntimeMissing` |
| `AutoUpdateEnabled` | Stand von `AutoUpdate.Enabled` |
| `TargetCommit` | Commit, auf den aktualisiert wird bzw. wurde |
| `ProgressPercent` | nur bei `Downloading` |
| `Message` | Fehlergrund, gesperrter Commit oder benötigte Runtime |

Der Server vergisst den Status mit der Verbindung. Die Onboard Unit meldet ihn
nach jedem Handshake neu, wie den Channel-Health-Report.

### Konfiguration (`Onboard/appSettings.json`)

```json
"AutoUpdate": {
  "Enabled": false,
  "ConfirmTimeoutMinutes": 10
}
```

Fehlt der Abschnitt, gilt `Enabled = false`. Eine Änderung wirkt nach einem
Neustart des Service. `install.sh` fragt bei der Installation, ob das
automatische Update aktiviert werden soll.

## Arbeitspakete

Die Pakete sind nach Modulgrenzen geschnitten. U1 und U2 legen die Verträge
fest; danach können U3, U4 und U6 parallel laufen.

### U1: Verträge und Layout

- `Shared/Update/`: `OnboardUpdateStatus`, `OnboardUpdateState`,
  `OnboardUpdateRequestResult`, Manifest-DTOs.
- Hub-Methoden in `IConnectionHubServer` und `IControlClient` ergänzen
  (zunächst mit leeren Implementierungen, damit alles baut).
- `.gitignore` um `Onboard/releases/` und `Onboard/current` ergänzen.
- `.dockerignore` anlegen: `**/bin/`, `**/obj/`, `Client/node_modules/`,
  `Onboard/releases/`, `Onboard/current`.

Fertig, wenn: alle drei Projekte und der Client bauen.

### U2: Server-Build der Pakete (`Server/Dockerfile`)

- Restore-Layer: zusätzlich `Onboard/SignalRC.Onboard.csproj` kopieren und mit
  `-p:RuntimeIdentifiers="linux-arm64;linux-x64"` wiederherstellen.
- `zip` in die bestehende `apt-get`-Zeile des Build-Stages aufnehmen.
- Nach `COPY Onboard/` je RID:
  `dotnet publish Onboard/SignalRC.Onboard.csproj -c Release -r <rid> --self-contained false -p:UseAppHost=false -p:BuildInfoBranch=… -p:BuildInfoCommit=…`
  und anschließend `zip -r … -x appSettings.json channelMap.json`. Die
  Konfiguration gehört nicht ins Paket.
- Runtime-Stage: ZIPs nach `/app/onboard-packages/<rid>.zip` kopieren.
- Ein Fehler in diesen Schritten bricht den gesamten Build ab (Standardverhalten
  von `RUN`).

Fertig, wenn: `docker compose build server` beide ZIPs erzeugt, jedes ZIP eine
lauffähige `SignalRC.Onboard.dll` mit dem richtigen Commit enthält und die
Build-Zeit für reine Codeänderungen nur um die zwei Publishes wächst.

### U3: Server-Endpoints und Status-Weiterleitung

- `OnboardPackageService`: scannt beim Start `/app/onboard-packages/`,
  berechnet SHA256 und Größe und liest die Framework-Version aus
  `SignalRC.Onboard.runtimeconfig.json` im ZIP. Commit und Branch kommen aus
  `ServerBuildInfoService`.
- `OnboardPackagesController` mit den beiden `GET`-Endpoints.
- `CarConnectionHub`: `RequestOnboardUpdate` weiterleiten,
  `ReportOnboardUpdateStatus` im `CarConnectionStore` ablegen und an die Gruppe
  `Car-{carId}` pushen.
- `version-sync` um den Status erweitern.

Fertig, wenn: Manifest und Download per `curl` funktionieren (auch mit `Range`)
und ein simulierter Statusbericht in `version-sync` erscheint.

### U4: Onboard-Update-Dienst

- `OnboardUpdateService` (Singleton, in `IServiceCollectionExtensions`
  registrieren):
  - Architektur über `RuntimeInformation.OSArchitecture` (`Arm64` →
    `linux-arm64`, `X64` → `linux-x64`, sonst `NoPackage`).
  - Runtime-Prüfung: Gibt es `$DOTNET_ROOT/shared/Microsoft.NETCore.App/<major>.*`
    zur `framework`-Angabe im Manifest?
  - Download mit Fortschritt, SHA256-Prüfung, bis zu 3 Versuche, Entpacken mit
    `ZipFile.ExtractToDirectory`.
  - Symlink setzen: `current.new` mit `File.CreateSymbolicLink` anlegen und per
    `rename(2)` über `current` schieben. Zu prüfen ist, ob `File.Move(…,
    overwrite: true)` bei einem Symlink auf ein Verzeichnis zuverlässig
    `rename(2)` aufruft; sonst `rename` aus libc per P/Invoke.
  - `pending` schreiben, Status melden, Neustart über
    `IHostApplicationLifetime.StopApplication` bzw. den bestehenden
    Shutdown-Pfad mit Exit-Code 0.
  - Bestätigung nach Handshake, `ConfirmTimeoutMinutes`-Watchdog, Aufräumen,
    `blocked` pflegen, `last-rollback` melden.
  - Beim Start ohne Release-Layout (Entwicklung mit `dotnet run`) meldet der
    Dienst `Disabled` mit Grund und tut nichts.
- `ServerConnectionService.CheckServerVersionAsync`: bei Abweichung an den
  Dienst übergeben statt nur zu warnen.
- `ControlService`:
  - `StartOnboardUpdate(sessionId)` mit Sitzungsprüfung.
  - Flag „Update läuft“: `UpdateChannel` ignoriert Befehle, `AquireCarControl`
    lehnt neue Sitzungen ab.
  - `SessionChanged` dient dem Dienst als Signal für „Fahrer weg“.

Fertig, wenn: Unit-Tests für die reine Logik grün sind (siehe Tests) und ein
lokaler Durchlauf gegen einen Test-Server ein Release installiert und
neu startet.

### U5: Prestart-Skript, `install.sh`, `update.sh`

- `scripts/onboard-prestart.sh` wie unter „Bestätigung und Rollback“
  beschrieben. Bash, ohne zusätzliche Abhängigkeiten, immer Exit 0, loggt nach
  stdout (landet in `onboard.log`).
- `install.sh` (Onboard):
  - `dotnet publish … -o Onboard/releases/<commit>/`, `current` setzen.
  - Unit mit `ExecStartPre` und `ExecStart=…/Onboard/current/SignalRC.Onboard.dll`.
  - Abfrage „Automatisches Update aktivieren?“ → `AutoUpdate.Enabled` in
    `appSettings.json` (über die bestehende `update_onboard_appsettings`).
- `update.sh` (Onboard):
  - Publiziert nach `Onboard/releases/<commit>/` und setzt `current`. Schreibt
    **kein** `pending`: Ein manueller Rollout verhält sich wie bisher.
  - Migration: Zeigt `ExecStart` noch auf `bin/Release/…/publish`, wird die Unit
    neu geschrieben und `systemctl daemon-reload` ausgeführt.
  - Aufräumen auf aktuelles + 3 vorherige.

Fertig, wenn: eine frische Installation und die Migration einer bestehenden
Installation (z. B. `track-racer`) im neuen Layout starten.

### U6: GUI

- `version-banner.tsx`: Update-Status anzeigen (Auto-Update an/aus, wartet auf
  Fahrer, Download mit Fortschritt, fehlgeschlagen mit Grund, zurückgerollt,
  gesperrt, Runtime fehlt). Live über den Hub-Push, `version-sync` als
  Anfangsstand.
- Button „Jetzt aktualisieren“: nur sichtbar bei Abweichung, verfügbarem Paket
  und eigener Steuersitzung (Sitzung aus `car-control.tsx` bzw.
  `control-flow-store.ts`).
- Während des Updates: Bedienelemente gesperrt, Hinweis „Fahrzeug wird
  aktualisiert, Steuerung danach neu übernehmen“.
- Texte in `i18n/translations.ts` (de/en).

Fertig, wenn: `tsc --noEmit` sauber ist und die Zustände in der Browser-Checkliste
(siehe Tests) durchgespielt sind.

### U7: Dokumentation

- `Docs/INSTALLATION.md` und `Docs/CONFIGURATION.md`: neues Layout,
  `AutoUpdate`-Abschnitt, manueller Rollback per SSH
  (`ln -sfn releases/<commit> current && sudo systemctl restart signalrc-onboard`).

## Tests

**Unit-Tests** (neues Projekt `Tests/SignalRC.Onboard.Tests`, nur reine Logik):

- Versionsvergleich: Branch- oder Commit-Abweichung löst aus, Gleichstand nicht.
- Entscheidungslogik: Enabled/Disabled, blockiert, kein Paket, Runtime fehlt,
  Sitzung aktiv; manuell übersteuert Enabled und Sperrliste, aber nicht die
  Runtime.
- `pending`/`blocked`-Format lesen und schreiben.
- Aufräumen: behält `current`, `previous` und die 3 neuesten.

**Skripttest** für `onboard-prestart.sh` in einem temporären Verzeichnis:
1–3 Fehlstarts ohne Rollback, der 4. Start rollt zurück und sperrt, ohne
`pending` passiert nichts, Exit-Code immer 0.

**Integrationsdurchlauf auf einer Onboard Unit** (nach Freigabe, kein
automatischer Rollout):

1. Migration per `update.sh`, Service startet aus `current`.
2. Server auf neuen Commit, Auto-Update an, kein Fahrer → Update, Neustart,
   Bestätigung, altes Release bleibt erhalten.
3. Dasselbe mit verbundenem Fahrer → `WaitingForDriver`, Update erst nach
   Sitzungsende.
4. Auto-Update aus, Fahrer klickt „Jetzt aktualisieren“ → Controls neutral,
   GUI gesperrt, Neustart, Sitzung neu übernehmen.
5. Absichtlich defektes Paket (z. B. Exception im Start) → nach 3 Fehlstarts
   Rollback, Status `RolledBack`, kein erneuter Versuch für diesen Commit.
6. Paket mit falschem SHA256 → `Failed`, alte Version läuft weiter.

## Nicht im Umfang

- armv7/armv6, Pakete mit eigener Runtime, automatische Runtime-Installation.
- Signierte Pakete über HTTPS und SHA256 hinaus.
- Gestaffelte Rollouts oder Auswahl einzelner Fahrzeuge auf dem Server.
- Aktualisierung von `mediamtx` oder Systempaketen.
- Rollenmodell auf dem Server; berechtigt ist, wer die SSH-Steuersitzung hält.
