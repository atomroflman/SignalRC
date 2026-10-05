# LteCar – Fernsteuerung über LTE/Internet

*[English version](Readme.md)*

> Diese Seite ist eine deutsche Übersicht. Die vollständige, laufend gepflegte Dokumentation ist Englisch – siehe [Docs/README.md](Docs/README.md) bzw. die [deutsche Docs-Übersicht](Docs/README.de.md).

## Quick Start

### 1. Server installieren

Auf der Maschine ausführen, die den Stack hosten soll (VM, Homeserver, …). Das Skript klont das Repo und führt interaktiv durch die Wahl der Container-Engine und des Compose-Stacks:

```bash
curl -fsSL https://raw.githubusercontent.com/atomroflman/SignalRC/master/install.sh | sudo bash
# → "1) Server" wählen
```

Das installiert den vollständigen Container-Stack (`nginx` + `client` + `server` + `janus` + `postgres` + `turn`) über Docker- oder Podman-Compose und kann optional eine `ltecar.service`-Systemd-Unit anlegen, damit der Stack Reboots übersteht.

### 2. Onboard (Fahrzeug) installieren – über die Web-UI

Sobald der Server läuft, im Browser öffnen (`https://euer-server/`). Solange kein Fahrzeug ausgewählt ist, zeigt die Seite einen **Install-Button**, der einen fertigen, mit Server-URL und Branch vorbefüllten Befehl generiert:

```bash
curl -fsSL https://EUER-SERVER/api/install/onboard.sh | sudo bash
```

Diesen Befehl auf dem Raspberry Pi einfügen. Er führt dasselbe `install.sh` aus, vorbefüllt für den `onboard`-Modus, und kann `ltecar-onboard.service` (+ `ltecar-mediamtx.service`) für den Autostart registrieren. Die fahrzeugspezifische Konfiguration (Kanäle, Name, Hardware) erfolgt danach über den Web-Client unter `/car/[carId]`.

Lieber manuell? Installer direkt auf dem Fahrzeug starten und Option 2 wählen:

```bash
curl -fsSL https://raw.githubusercontent.com/atomroflman/SignalRC/master/install.sh | sudo bash
# → "2) Onboard" wählen
```

### Lokale Entwicklung

```bash
# Server
cd Server && dotnet run

# Onboard (Fahrzeug)
cd Onboard && dotnet run             # normaler Start

# Voller Stack (Client + Server + nginx + Janus + Postgres + TURN)
docker compose up --build

# Stack stoppen
docker compose down
```

---

## Wichtige Hinweise

> **LTE-Konnektivität**: Der Onboard-Client des Fahrzeugs initiiert eine **ausgehende Verbindung** zum Server. Das Fahrzeug ist **nicht direkt aus dem Internet erreichbar** – alle Kommunikation wird vom Fahrzeug initiiert.

> **Datenbank**: Niemals die Datenbank manuell ändern. Immer EF Core Migrations verwenden.

---

## Features

| Feature | Beschreibung |
|---------|--------------|
| Remote Control | Steuerung über LTE/Internet mit niedriger Latenz |
| Video-Streaming | Echtzeit-Video von der Fahrzeugkamera |
| Audio-Chat | Bidirektionale Audiokommunikation |
| Bash Tool | Remote Bash-Befehle auf dem Fahrzeug ausführen |
| Channel Tester | Hardware-Kanäle über die Web-UI testen |
| Templates | Fahrzeugkonfigurationen teilen und wiederverwenden |

**Feature Flags**: `appSettings.json` kennt die Flags `webSetup`, `bashTool`, `channelTester`, `audio`, `video`. Davon wirkt sich aktuell nur `bashTool` tatsächlich auf das Laufzeitverhalten aus (schaltet die Bash-Relay-Verbindung zum Server frei, Standard ist aus, wenn der Wert fehlt). Die übrigen Flags werden zwar in `appSettings.json` gespeichert, steuern aber derzeit nichts. Details siehe [Docs/CONFIGURATION.md](Docs/CONFIGURATION.md#feature-flags) (Englisch).

---

## Installation

### Server

```bash
curl -fsSL https://raw.githubusercontent.com/atomroflman/SignalRC/master/install.sh | sudo bash
```

Oder manuell:

```bash
git clone https://github.com/atomroflman/SignalRC.git
cd SignalRC && sudo bash install.sh
```

### Onboard (Raspberry Pi)

Am einfachsten über den **Install-Button in der Web-UI des Servers** (siehe Quick Start oben), alternativ den Installer direkt auf dem Fahrzeug starten:

```bash
git clone https://github.com/atomroflman/SignalRC.git
cd SignalRC && sudo bash install.sh
# → "2) Onboard" wählen
```

**Details:** [Docs/INSTALLATION.md](Docs/INSTALLATION.md) (Englisch)

---

## Konfiguration

Die fahrzeugspezifische Konfiguration (Kanäle, Name, Hardware) sowie das Testen erfolgen über den Web-Client unter `/car/[carId]` – siehe den "Neues Fahrzeug installieren"-Flow oben. Ein Konsolen-Setup-Tool gibt es nicht mehr.

### Onboard (appSettings.json)

```json
{
  "ServerName": "euer-server.example.com",
  "ServerPort": 443,
  "UseHttps": true,
  "CarName": "Mein RC-Auto",
  "CarSecret": "aendern",
  "CameraOptions": {
    "CameraLib": "rpicam-vid"
  }
}
```

**Details:** [Docs/CONFIGURATION.md](Docs/CONFIGURATION.md) (Englisch)

---

## Architektur

```
┌──────────────┐     WebRTC      ┌──────────────┐
│   Browser    │◄──────────────►│    Server    │
│   (Client)   │    SignalR     │  (ASP.NET)   │
└──────────────┘                └──────┬───────┘
                                       │
                              SignalR  │  WebRTC
                                       │
┌──────────────────────────────────────▼───────────────┐
│                    Onboard (Raspberry Pi)             │
│  ┌────────────┐  ┌────────────┐  ┌─────────────┐   │
│  │  Vehicle   │  │   Video    │  │    Audio    │   │
│  │ Connection │  │  Service   │  │    Chat     │   │
│  │  Manager   │  │            │  │             │   │
│  └────────────┘  └────────────┘  └─────────────┘   │
└────────────────────────────────────────────────────┘
```

## SignalR Hubs

| Hub | Pfad | Zweck |
|-----|------|-------|
| CarConnectionHub | `/hubs/connection` | Der eine Fahrzeug-seitige Hub: Verbindungsstatus, Steuerung, Telemetrie, Video-Signaling, Filetransfer, Channel-Sync |
| UserChannelHub | `/hubs/userchannel` | Browser-/Gamepad-seitige Channel-Wert-Updates |
| CarBashHub | `/hubs/carbash` | Bash-Befehls-Relay (nur Dispatch – Output läuft über `CarConnectionHub` zurück) |

*(`CarAudioHub` existiert im Code, ist aber noch nicht registriert/erreichbar.)*

---

## Dokumentation

- [Docs/README.md](Docs/README.md) – Übersicht (Englisch)
- [Docs/README.de.md](Docs/README.de.md) – Deutsche Docs-Übersicht
- [Docs/INSTALLATION.md](Docs/INSTALLATION.md) – Installationsanleitung (Englisch)
- [Docs/FEATURES.md](Docs/FEATURES.md) – Feature-Dokumentation (Englisch)
- [Docs/CONFIGURATION.md](Docs/CONFIGURATION.md) – Konfigurationsreferenz (Englisch)

---

## Environment-Variablen

| Variable | Beschreibung |
|----------|--------------|
| `CONFIG_DIR` | Konfigurationsverzeichnis (Onboard) |
| `VEHICLE_TEMPLATES_PATH` | Template-Pfad (Dateisystem-Fahrzeugvorlagen in `VehicleTemplates/`/`vehicleTemplates/`) |
| `COTURN_EXTERNAL_IP` / `COTURN_USERNAME` / `COTURN_CREDENTIAL` | Öffentliche IP und Zugangsdaten des TURN-Servers (Docker Compose) |
| `JANUS_NAT_1_1` | Öffentliche IP für Janus-WebRTC-NAT-Traversal (Docker Compose); fällt ohne Angabe auf Azure IMDS zurück |

---

## Kontakt & Support

Fragen, Feedback oder Beiträge bitte direkt im GitHub-Repository stellen.
