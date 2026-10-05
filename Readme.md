# LteCar – Remote Control over LTE/Internet

*[Deutsche Version](Readme.de.md)*

## Quick Start

### 1. Install the server

Run this on the machine (VM, home server, …) that will host the stack. It clones the repo and walks you through choosing a container engine and the Compose stack to deploy:

```bash
curl -fsSL https://raw.githubusercontent.com/atomroflman/SignalRC/master/install.sh | sudo bash
# → choose "1) Server"
```

This installs the full container stack (`nginx` + `client` + `server` + `janus` + `postgres` + `turn`) via Docker or Podman Compose, and can optionally register a `ltecar.service` systemd unit so the stack survives reboots.

### 2. Install onboard (the vehicle) — via the web UI

Once the server is running, open it in a browser (`https://your-server/`). With no vehicle selected yet, the page shows an **install button** that generates a ready-to-paste command, preconfigured with your server's URL and branch:

```bash
curl -fsSL https://YOUR-SERVER/api/install/onboard.sh | sudo bash
```

Paste that on the Raspberry Pi. It runs the same `install.sh`, pre-filled for `onboard` mode, and can register `ltecar-onboard.service` (+ `ltecar-mediamtx.service`) for autostart. Vehicle-specific configuration (channels, name, hardware) happens afterwards from the web client at `/car/[carId]`.

Prefer to do it by hand instead? Run the installer directly on the vehicle and choose option 2:

```bash
curl -fsSL https://raw.githubusercontent.com/atomroflman/SignalRC/master/install.sh | sudo bash
# → choose "2) Onboard"
```

### Local development

```bash
# Server
cd Server && dotnet run

# Onboard (vehicle)
cd Onboard && dotnet run             # normal start

# Full stack (client + server + nginx + janus + postgres + turn)
docker compose up --build

# Stop the stack
docker compose down
```

**Documentation:** see [Docs/README.md](Docs/README.md) for the full documentation (English, with a [German overview page](Docs/README.de.md)).

---

## Key Notes

> **LTE connectivity**: The onboard vehicle client initiates an **outbound-only connection** to the server. The vehicle is **not directly reachable from the internet** — all communication is initiated by the vehicle.

> **Database**: Never modify the database manually. Always use EF Core migrations.

---

## Features

| Feature | Description |
|---------|--------------|
| Remote Control | Low-latency control over LTE/Internet |
| Video Streaming | Real-time video from the vehicle's camera |
| Audio Chat | Bidirectional audio communication |
| Bash Tool | Run remote bash commands on the vehicle |
| Channel Tester | Test hardware channels from the web UI |
| Templates | Share and reuse vehicle channel configurations |

**Feature flags**: `appSettings.json` supports `webSetup`, `bashTool`, `channelTester`, `audio`, `video` flags. Of these, only `bashTool` currently gates real runtime behavior (it enables/disables the bash relay to the server, and defaults to off when unset). The others are stored for future use but don't gate anything yet — see [Docs/CONFIGURATION.md](Docs/CONFIGURATION.md#feature-flags) for details.

---

## Installation

### Server

```bash
curl -fsSL https://raw.githubusercontent.com/atomroflman/SignalRC/master/install.sh | sudo bash
```

Or manually:

```bash
git clone https://github.com/atomroflman/SignalRC.git
cd SignalRC && sudo bash install.sh
```

### Onboard (Raspberry Pi)

Use the **install button in the server's web UI** (see Quick Start above) to get a preconfigured command, or run the installer directly on the vehicle:

```bash
git clone https://github.com/atomroflman/SignalRC.git
cd SignalRC && sudo bash install.sh
# → choose "2) Onboard"
```

**Details:** [Docs/INSTALLATION.md](Docs/INSTALLATION.md)

---

## Configuration

Vehicle configuration (channels, name, hardware) and testing happen in the web client at `/car/[carId]` — see the "Install New Vehicle" flow above. There is no console setup tool anymore.

### Onboard (appSettings.json)

```json
{
  "ServerName": "your-server.example.com",
  "ServerPort": 443,
  "UseHttps": true,
  "CarName": "My RC Car",
  "CarSecret": "change-me",
  "CameraOptions": {
    "CameraLib": "rpicam-vid"
  }
}
```

### Feature Flags

| Flag | Default | Actually wired up? |
|------|---------|------|
| `webSetup` | on in the flag model, but no such interface exists yet | No — toggle is inert |
| `bashTool` | off (unset in appSettings.json falls back to `false`) | Yes — gates the bash relay |
| `channelTester` | on in the flag model | No — toggle is inert |
| `audio` | on in the flag model | No — `CarAudioHub` exists in code but isn't registered yet |
| `video` | on in the flag model | Video streaming itself always runs; not gated by this flag |

**Details:** [Docs/CONFIGURATION.md](Docs/CONFIGURATION.md)

---

## Architecture

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
│  ┌────────────┐  ┌────────────┐  ┌─────────────┐   │
│  │  Telemetry │  │  Control   │  │  BashTool   │   │
│  │  (via      │  │  Service   │  │  Service    │   │
│  │  Connection)│ │            │  │             │   │
│  └────────────┘  └────────────┘  └─────────────┘   │
└────────────────────────────────────────────────────┘
```

---

## SignalR Hubs

| Hub | Path | Purpose |
|-----|------|-------|
| CarConnectionHub | `/hubs/connection` | The single vehicle-side hub: connection state, control, telemetry, video signaling, file transfer, channel sync |
| UserChannelHub | `/hubs/userchannel` | Browser/gamepad-side channel value updates |
| CarBashHub | `/hubs/carbash` | Bash command relay (dispatch only — output streams back over `CarConnectionHub`) |

*(`CarAudioHub` exists in the codebase but is not yet registered/reachable.)*

---

## Documentation

- [Docs/README.md](Docs/README.md) – Overview
- [Docs/INSTALLATION.md](Docs/INSTALLATION.md) – Installation guide
- [Docs/FEATURES.md](Docs/FEATURES.md) – Feature documentation
- [Docs/CONFIGURATION.md](Docs/CONFIGURATION.md) – Configuration reference
- [Docs/README.de.md](Docs/README.de.md) – Deutsche Übersicht

---

## Environment Variables

| Variable | Description |
|----------|--------------|
| `CONFIG_DIR` | Config directory (Onboard) |
| `VEHICLE_TEMPLATES_PATH` | Template base path (filesystem vehicle templates in `VehicleTemplates/`/`vehicleTemplates/`) |
| `COTURN_EXTERNAL_IP` / `COTURN_USERNAME` / `COTURN_CREDENTIAL` | TURN server public IP and credentials (Docker Compose) |
| `JANUS_NAT_1_1` | Public IP for Janus WebRTC NAT traversal (Docker Compose); falls back to Azure IMDS if unset |

---

## Contact & Support

Questions, feedback, or contributions — please open an issue or discussion directly on the GitHub repository.
