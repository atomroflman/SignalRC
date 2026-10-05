# LteCar Documentation

*This documentation is maintained primarily in English. For a German-language overview, see [README.de.md](README.de.md).*

## Quick Links

- [Installation Guide](INSTALLATION.md) - Server and Onboard setup
- [Features](FEATURES.md) - Feature overview and usage
- [Configuration Reference](CONFIGURATION.md) - Complete configuration reference
- [Concepts](CONCEPTS.md) - Condensed architecture/implementation reference
- [Architecture](Architecture.md) - Detailed architecture walkthrough
- [Video Stack Troubleshooting](VideoStackTroubleshooting.md) - Step-by-step video pipeline diagnostics

For the full container stack, see the installation guide. It covers the nginx + client + server + janus + postgres + turn deployment and the reboot setup.

---

## System Overview

LteCar is a system for building and operating remotely controlled cars over LTE/Internet.

### Key Features

- **Quasi unlimited control channels** (steering, throttle, lights, sensors)
- **Real-time video streaming** from vehicle to web interface
- **Responsive remote control** over the internet
- **Multiple cars per server** - manage and control different vehicles simultaneously
- **Bidirectional audio chat** between driver and vehicle
- **Web interface** for control, video display, audio chat and configuration
- **Vehicle templates** for sharing vehicle configurations

### Architecture

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
│  ┌────────────┐  ┌────────────┐  ┌─────────────┐  │
│  │  Vehicle   │  │   Video    │  │    Audio    │  │
│  │ Connection │  │  Service   │  │    Chat     │  │
│  │  Manager   │  │            │  │             │  │
│  └────────────┘  └────────────┘  └─────────────┘  │
└────────────────────────────────────────────────────┘
```

---

## Important Notes

### LTE Connectivity

> The Onboard client initiates an **outbound-only connection** to the server. The vehicle **cannot be reached directly** from the internet - all communication is initiated by the vehicle. This works through NAT and most firewall configurations.

### Database Changes

> **Never modify the database manually.** Always use EF Core migrations.

### Onboard Client

> The Onboard client is **not reachable from the web** because of LTE's outbound-only connection. All features (bash tool, channel tester, etc.) work by the vehicle connecting to the server and the web client also connecting to the same server.

---

## Getting Started

1. [Install the server](INSTALLATION.md#server-installation) — one-line installer
2. [Install the onboard software](INSTALLATION.md#onboard-vehicle-installation) — via the server's web UI install button, or the installer directly
3. Configure the vehicle (channels, name, hardware) and test it from the web client at `/car/[carId]`
4. [Enable desired features](FEATURES.md#feature-flags-summary)

---

## Feature Flags

`appSettings.json` supports five feature flags, but only one of them currently gates real behavior:

| Feature | Actually wired up? |
|---------|-------------|
| `webSetup` | No — no web-based setup interface exists yet; toggle is inert |
| `bashTool` | **Yes** — enables the bash relay to the server; defaults to off when unset |
| `channelTester` | No — toggle is inert |
| `audio` | No — `CarAudioHub` exists in code but is not registered/reachable yet |
| `video` | No — video streaming itself always runs; not gated by this flag |

See [Configuration Reference](CONFIGURATION.md#feature-flags) for the full picture, including where each flag is (and isn't) read.

---

## Directories

| Directory | Purpose |
|-----------|---------|
| `Server/` | ASP.NET Core server application |
| `Onboard/` | Raspberry Pi vehicle software |
| `Client/` | Web client application |
| `Shared/` | Shared libraries and SignalR contracts |
| `Docs/` | Documentation |
| `vehicleTemplates/` | Vehicle configuration templates |
