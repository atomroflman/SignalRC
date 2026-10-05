# LteCar Features

## Overview

LteCar provides the following features for remote vehicle control:

- **Remote Control**: Drive your car over LTE/Internet with low latency
- **Video Streaming**: Real-time video from on-board camera
- **Audio Chat**: Bidirectional audio communication
- **Telemetry**: Monitor battery, CPU temperature, and other sensors
- **Bash Tool**: Execute bash commands on the vehicle remotely
- **Channel Tester**: Test hardware channels from the web interface

---

## Remote Control

### How It Works

1. User opens the web interface and selects a vehicle
2. SSH authentication challenge-response occurs
3. Upon successful authentication, control is granted
4. User uses gamepad/keyboard to drive
5. Control signals are sent via SignalR to the server, then to the vehicle
6. Vehicle executes controls and streams telemetry back

### Channels

LteCar supports unlimited control channels defined in `channelMap.json`, each backed by a `controlType` implementation (`Onboard/Control/ControlTypes/`) — see [Configuration Reference → Control Types](CONFIGURATION.md#control-types) for the full, current list. The common ones:

| `controlType` value | Description |
|-------------|-------------|
| `Steering` | Servo-based steering control |
| `Throttle` | Motor speed control |
| `PwmLight` / `PwmBlinker` | LED and lighting control |
| `RotaryLight` | Rotating lights |

There is no built-in "Gear"/transmission control type — implement one as a custom `ControlTypeBase` subclass if needed.

---

## Video Streaming

### Architecture

- **Janus Gateway**: WebRTC signaling and streaming
- **MediaMTX**: RTSP server for camera feeds
- **WebRTC**: Browser-compatible video streaming

### Configuration

```json
{
  "videoStreams": {
    "front": {
      "streamId": "rpi0",
      "enabled": true,
      "location": "front"
    }
  }
}
```

### Ports

Janus's WebRTC media (all video streams) uses the UDP range configured on the `janus` container — `10000-10200` in the shipped `docker-compose.yml` (`JanusConfiguration__PortRangeStart/End`). A coturn TURN server (`3478` udp/tcp + `49152-50152` udp relay range) is also part of the stack, for clients behind NATs where STUN alone isn't enough — see `GET /api/webrtc/ice-servers`.

---

## Audio Chat

### Features

- Bidirectional audio between driver and vehicle (`AudioChatService` on the Onboard side)
- Microphone and speaker selection
- Echo cancellation enabled by default
- Noise suppression

### Status

The audio signaling hub (`CarAudioHub`, `Server/Hubs/CarAudioHub.cs`) exists in the codebase but is **not currently registered** in `Server/Program.cs`, so it isn't reachable yet. The `audio` feature flag doesn't gate anything at runtime either way.

---

## Bash Tool (Remote Command Execution)

> **Security Note**: BashTool allows remote execution of bash commands on the vehicle. Enable only when needed.

### How It Works

Command dispatch and output streaming use two different hubs:

1. Web client calls `CarBashHub.ExecuteCommand` (`/hubs/carbash`) on the server
2. Server forwards the command to the vehicle's connection on the same hub; the vehicle's `BashToolService` (connected separately, subscribed to the `ExecuteCommand` server-to-client method) runs it
3. Output streams back the other way: the Onboard `ControlService` calls `SendBashOutput` on its single `CarConnectionHub` (`/hubs/connection`) connection, and the server broadcasts it to **all** connected browser clients (`IConnectionHubServer.SendBashOutput` → `Clients.All`)

### Architecture

```
┌──────────────┐  ExecuteCommand   ┌──────────────┐   ExecuteCommand  ┌──────────────┐
│ Web Client   │──────────────────►│    Server    │──────────────────►│   Vehicle    │
│              │   /hubs/carbash   │  CarBashHub  │   /hubs/carbash   │ BashToolSvc  │
└──────────────┘                   └──────────────┘                   └──────────────┘

┌──────────────┐  SendBashOutput   ┌──────────────────┐  SendBashOutput  ┌──────────────┐
│   Vehicle    │◄──────────────────│      Server       │◄─────────────────│ Web Client(s)│
│ ControlSvc   │ /hubs/connection  │ CarConnectionHub   │ broadcast (all) │  (receive)   │
└──────────────┘                   └──────────────────┘                  └──────────────┘
```

### Enable

Set it in `appSettings.json`:

```json
{
  "bashTool": true
}
```

This is the one feature flag that's actually read at startup (`Onboard/Program.cs`, falls back to `false` if the key is absent) — it's the only one of the five feature flags that currently has any runtime effect.

### Usage

Commands are executed in the vehicle's userspace with:
- Working directory: User's home directory
- Environment: Standard user environment
- Output: UTF-8 encoded, streamed in real-time

### Security

- Commands run as the user running the Onboard service
- No root privileges by default
- Can be disabled via feature flag

---

## Channel Tester

The Channel Tester allows testing individual hardware channels from the web interface.

### How It Works

1. User selects a channel from the web UI
2. User sets a value (e.g., 50% throttle)
3. Command is sent to vehicle via SignalR
4. Vehicle executes the control
5. Telemetry confirms execution

### Use Cases

- Test servo calibration
- Verify motor response
- Check LED connections
- Validate sensor readings

The web client's `/car/[carId]/test` page provides this today, independent of any feature flag. The `channelTester` flag can be stored in `appSettings.json` but currently has no effect — it doesn't gate this page or anything else.

---

## Web-Based Vehicle Configuration

There's no dedicated "Web Setup Interface" gated by a `webSetup` flag — that flag can be set in `appSettings.json` but is currently inert (nothing reads it). What *is* available, always, with no flag needed, is the web client itself at `/car/[carId]`:

- **Templates panel** — import/export gamepad-to-channel flow-graph configurations
- **Channels page** (`/car/[carId]/channels`) — channel configuration
- **Test page** (`/car/[carId]/test`) — the channel tester described above
- **Bash page** (`/car/[carId]/bash`) — the bash tool UI, talking to `CarBashHub`

These are ordinary pages of the always-on Next.js client served through nginx — not a separate, flag-gated "setup interface."

---

## Templates

Vehicle templates allow sharing and reusing configurations.

### Template Structure

```
vehicleTemplates/
├── MyCar/
│   ├── config.json      # ChannelMap configuration
│   └── metadata.json    # Template metadata
└── AnotherCar/
    └── ...
```

### Template Metadata

```json
{
  "name": "My RC Car",
  "description": "Standard RC car configuration",
  "version": "1.0.0",
  "author": "Your Name",
  "created": "2024-01-01"
}
```

### Creating or Applying a Template

The filesystem templates under `VehicleTemplates/`/`vehicleTemplates/` are created and applied by hand (copy a folder, edit `config.json`/`metadata.json`) — see [VehicleTemplates/README.md](../VehicleTemplates/README.md). There is no console tool for this anymore.

### Template Base Path

Templates are looked up from:
1. `VEHICLE_TEMPLATES_PATH` environment variable
2. `~/vehicleTemplates/` by default (the user's home directory, not `~/.ltecar/`)

### A second, separate template system

The filesystem templates above are independent of a newer, **server-side** template store: `GET/POST /api/templates` (`Server/Controllers/TemplatesController.cs`) persists named `ChannelTemplate` rows in the database and can push one onto a car's live channel map (`POST /api/templates/cars/{carId}/apply/{templateId}`). This is managed from the web client's Templates panel (`/car/[carId]`) and currently works independently of the filesystem templates — applying one does not update the other.

---

## LTE Connectivity Note

> **Important**: The Onboard client initiates an **outbound-only connection** to the server. This means:
>
> - The vehicle cannot be reached directly from the internet
> - All communication is initiated by the vehicle
> - No inbound ports need to be opened on the vehicle
> - This works through NAT and most firewall configurations

The server only needs to be reachable at whatever `ServerName`/`ServerPort`/`UseHttps` are configured in the vehicle's `appSettings.json` (see [CONFIGURATION.md](CONFIGURATION.md)) — there's no fixed "standard" port; the shipped example config points at port 443 over HTTPS.

---

## Feature Flags Summary

All five flags below can be set in `appSettings.json`. Only one of them currently changes what the running Onboard process does:

| Feature | Actually wired up at runtime? |
|---------|---------|
| `webSetup` | No — no such interface exists; toggling it has no effect |
| `bashTool` | **Yes** — gates the bash relay connection (`Onboard/Program.cs`); defaults to `false` when the key is absent |
| `channelTester` | No — the web client's test page works regardless of this flag |
| `audio` | No — `CarAudioHub` isn't registered on the server yet |
| `video` | No — video streaming isn't gated by this flag |

Treat these as reserved-for-future-use rather than as functioning on/off switches, except for `bashTool`.
