# LteCar Configuration Reference

## Configuration Files

### appSettings.json (Onboard)

Located in the config directory (see [Config Directory](#config-directory) below), contains vehicle and server settings. This is the shape actually read by `Onboard/Program.cs` at startup — the shipped default (`Onboard/appSettings.json`):

```json
{
  "ServerName": "lte-rc.northeurope.cloudapp.azure.com",
  "ServerPort": 443,
  "UseHttps": true,
  "MediaMtxPath": "",
  "CarName": "MyCar",
  "CarSecret": "mysecret",
  "EnableChannelTest": true,
  "CameraOptions": {
    "CameraLib": "rpicam-vid"
  }
}
```

Optional feature-flag keys (`webSetup`, `bashTool`, `channelTester`, `audio`, `video`) can also be set here — see [Feature Flags](#feature-flags) for which of them actually do anything.

### channelMap.json (Onboard)

Defines all hardware channels, telemetry, and video streams (`Shared/Channels/ChannelMap.cs`, `ChannelMapItem.cs`, `Shared/Video/VideoStreamMapItem.cs`):

```json
{
  "pinManagers": {
    "pca9685": {
      "type": "Pca9685PwmExtension",
      "options": {
        "boardAddress": 64,
        "i2cBus": 1
      }
    }
  },
  "controlChannels": {
    "steering": {
      "address": 0,
      "controlType": "Steering",
      "pinManager": "pca9685"
    },
    "throttle": {
      "address": 1,
      "controlType": "Throttle",
      "pinManager": "pca9685",
      "testDisabled": true
    }
  },
  "telemetryChannels": {
    "battery": {
      "telemetryType": "JbdBmsTelemetryReader",
      "readIntervalTicks": 50
    },
    "cpuTemp": {
      "telemetryType": "CpuTemperatureReader",
      "readIntervalTicks": 100
    }
  },
  "videoStreams": {
    "front": {
      "streamId": "rpi0",
      "enabled": true,
      "location": "front"
    }
  }
}
```

There's no `minPulse`/`maxPulse`/`centerPulse` or `priority` field on channel items — servo calibration lives in the pin manager's own `options`/hardware configuration, not per-channel, and there's no stream priority field. `telemetryChannels` use a `telemetryType` key (not `type` — that's only the discriminator field name for `pinManagers`).

---

## Feature Flags

`appSettings.json` supports five boolean feature flags, but the shipped default doesn't set any of them, and only one is actually read anywhere at runtime:

| Flag | Actually read at runtime? |
|------|-------------|
| `webSetup` | No — no code path checks it |
| `bashTool` | **Yes** — `Onboard/Program.cs` reads `configuration.GetValue<bool?>("bashTool") ?? false` to decide whether to connect the bash relay; effectively **off by default** since the key is absent from the shipped file |
| `channelTester` | No — no code path checks it |
| `audio` | No — no code path checks it (and `CarAudioHub` isn't registered on the server either) |
| `video` | No — no code path checks it; video streaming is not gated by a flag |

### Enabling Features

Set the flag directly in `appSettings.json` — as shown above, only `bashTool` currently changes behavior:

```json
{
  "bashTool": true
}
```

---

## Server appSettings.json

### Application Configuration

The real binding class is `Server/Configuration/ApplicationConfiguration.cs` — there is no `ServerName`, no `Application` section, and no `RunJanusServer`/`IdleTimeoutMinutes`/`MaxConcurrentCars`. This is the shipped default (`Server/appSettings.json`):

```json
{
  "IdSalt": "...",
  "IdAlphabet": "...",
  "SessionTransferAlphabet": "...",
  "ConnectionStrings": {
    "DefaultConnection": "Host=localhost;Database=ltecar;Username=ltecar;Password=ltecar;Include Error Detail"
  },
  "JanusConfiguration": {
    "HostName": "localhost"
  },
  "FileTransfer": {
    "ThrottleKBytesPerSecond": 20,
    "StoragePath": "/var/data/ltecar",
    "MaxFileSizeMB": 100
  },
  "WebRtc": {
    "Urls": [],
    "Username": "",
    "Credential": ""
  }
}
```

- `JanusConfiguration.PortRangeStart`/`PortRangeEnd` default to `10000`/`11000` in code. **Known bug**: the shipped JSON instead sets `UdpPortRangeStart`/`UdpPortRangeEnd`/`TcpPortRangeStart`/`TcpPortRangeEnd`, which don't exist on the config class and are silently ignored by ASP.NET's config binder. In the Docker Compose stack this doesn't matter because the `server` container overrides the real property names directly via `JanusConfiguration__PortRangeStart`/`JanusConfiguration__PortRangeEnd` environment variables (`10000`/`10200`) — but if you rely on the JSON file alone (e.g. running `dotnet run` outside Compose), the port range silently falls back to the code default `10000`-`11000`, not what the JSON file appears to say.
- `WebRtc` configures the TURN server exposed via `GET /api/webrtc/ice-servers` (`Server/Controllers/WebRtcController.cs`) — populated from `COTURN_*` environment variables in Compose, empty by default outside it.
- The server never reads its own public hostname/port from config — see [Environment Variables](#environment-variables) and `OnboardInstallScriptService` for how it derives its URL per-request instead.

---

## SignalR Hubs

The vehicle-side hubs were consolidated during the `experimental` branch's WebRTC/channel-spot work — `CarControlHub`, `TelemetryHub`, and `CarVideoHub` no longer exist as separate classes; everything moved onto `CarConnectionHub`. `Shared/HubPaths.cs` still has a `CarUiHub` path constant, but no hub class uses it and it is never mapped — treat it as dead.

Hubs actually mapped in `Server/Program.cs`:

| Hub | Path | Purpose |
|-----|------|---------|
| CarConnectionHub | `/hubs/connection` | The single vehicle-side hub — connection state, control, telemetry, video signaling, file transfer, and channel-map sync all go through this one connection |
| UserChannelHub | `/hubs/userchannel` | Browser/gamepad-side channel value updates |
| CarBashHub | `/hubs/carbash` | Bash command dispatch (output streams back via `CarConnectionHub.SendBashOutput`, broadcast to all connected clients) |

Exists in code but **not mapped/reachable**:

| Hub | Would-be purpose |
|-----|---------|
| CarAudioHub | Audio chat signaling (`IAudioChatClient`/`IAudioChatServer`) — fully implemented but never registered in `Program.cs` |

---

## Environment Variables

### Onboard

| Variable | Description |
|----------|-------------|
| `CONFIG_DIR` | Config directory path (`Onboard/Program.cs`) |
| `VEHICLE_TEMPLATES_PATH` | Template base path for filesystem vehicle templates (`VehicleTemplates/`/`vehicleTemplates/`) |

There is no `LTE_USE_NEW_CONNECTION_MODEL` variable in the current code — it doesn't appear anywhere outside old documentation. The single-hub connection model it used to toggle is now simply the only model.

### Server

| Variable | Description |
|----------|-------------|
| `ASPNETCORE_ENVIRONMENT` | Development/Production |
| `ConnectionStrings__DefaultConnection` | PostgreSQL connection string |
| `JanusConfiguration__HostName` | Janus host name or IP |
| `JanusConfiguration__PortRangeStart` | First UDP video port |
| `JanusConfiguration__PortRangeEnd` | Last UDP video port |
| `FileTransfer__StoragePath` | Local file storage path |
| `WebRtc__Username` / `WebRtc__Credential` | TURN credentials handed out by `/api/webrtc/ice-servers` |
| `COTURN_EXTERNAL_IP` / `COTURN_USERNAME` / `COTURN_CREDENTIAL` | Compose-level TURN setup — feeds both the `server` and `turn` (coturn) containers; falls back to an Azure IMDS public-IP lookup if `COTURN_EXTERNAL_IP` is unset |
| `JANUS_NAT_1_1` | Public IP Janus advertises for WebRTC NAT traversal (Compose); also falls back to Azure IMDS if unset, and the container hard-fails to start if neither resolves |
| `GIT_BRANCH` / `GIT_COMMIT` | Baked into the server image at build time; surfaced back out via the onboard-install-command endpoint |

There is no `RunJanusServer` variable — the server never runs Janus in-process; it's always a separate process/container.

In Compose, the service names resolve via Docker DNS as `server`, `janus`, and `postgres`.
In the production stack, nginx is the only public entry point; browsers should use the nginx host name, not the internal service names.
If you choose the installer HTTPS option, Caddy becomes the public entry point instead of nginx.

---

## Database

LteCar uses PostgreSQL. **Never modify the database manually** - always use EF Core migrations.

### Migrations

```bash
cd Server

# Add migration
dotnet ef migrations add MigrationName

# Apply migrations
dotnet ef database update

# Remove last migration (if not applied)
dotnet ef migrations remove
```

### Key Tables

| Table | Description |
|-------|-------------|
| Users | User accounts |
| Cars | Registered vehicles |
| CarChannels | Channel definitions per car |
| CarPinManagers | Pin manager (I2C/GPIO) configuration per car |
| CarTelemetry | Telemetry channel definitions per car |
| CarVideoStreams | Video stream definitions per car |
| ChannelTemplates | Server-side reusable hardware channel templates (see [Features → Templates](FEATURES.md#templates)) |
| UserCarSetups | User-vehicle associations, plus the ReactFlow gamepad→channel binding graph (`UserSetupFlowNodeBase` and subclasses, `UserSetupLink`) |

---

## SSH Key Authentication

Vehicles authenticate using SSH key pairs:

1. On first startup, vehicle generates RSA-2048 key pair
2. The private key is served over a **LAN-only** HTTP/HTTPS listener the Onboard process itself runs on ports `8080`/`8443` (`Onboard/Program.cs`), bound to `+:8080`/`+:8443` — this is by design the *only* path the key ever leaves the vehicle over; it is never routed through SignalR, REST, or the server
3. User downloads the key from that local listener (while on the same network as the vehicle) and uses it for SSH authentication
4. Private key is deleted from the vehicle after download

This vehicle-side `8080` is unrelated to the server stack's nginx port (also `8080` in the default Compose file, coincidentally) — don't open the vehicle's listener to the internet; it's meant to be reachable only from the vehicle's local network.

### Key Files

| File | Location | Purpose |
|------|----------|---------|
| `carIdentityKey` | Config dir | Vehicle identity (GUID) |
| `ssh_key` | Config dir | Private key (PKCS#8 DER) |
| `ssh_key.pub` | Config dir | Public key (SPKI DER) |

---

## Network Ports

### Server stack (as published by `docker-compose.yml`)

| Port | Protocol | Service |
|------|----------|---------|
| 8080 | TCP | nginx — the only public entry point (client, `/api/`, `/hubs/`, Janus proxy) |
| 8088 | TCP | Janus HTTP control plane, published directly |
| 8188 | TCP | Janus WebSocket control plane, published directly |
| 10000-10200 | UDP | Janus WebRTC media |
| 3478 | UDP + TCP | coturn TURN signaling |
| 49152-50152 | UDP | coturn TURN relay range |
| 5432 | TCP | PostgreSQL, published for local/dev access — do not expose to the internet |

The server's own process listens on `5000` internally (`ASPNETCORE_URLS=http://0.0.0.0:5000`) but that port is never published to the host — it's only reachable through nginx. See [Installation Guide](INSTALLATION.md#azure-firewall) for which of these to open on a cloud firewall.

### Onboard (Vehicle)

| Port | Protocol | Service |
|------|----------|---------|
| 22 | TCP | SSH (optional) |
| 8080 / 8443 | TCP | LAN-only SSH-key download listener (see [SSH Key Authentication](#ssh-key-authentication)) — not the same thing as the server's nginx port |

The vehicle has no other inbound ports — it only makes outbound connections to the server (see the LTE Connectivity note).

---

## Hardware Configuration

### Pin Managers

| Type | Description |
|------|-------------|
| `Pca9685PwmExtension` | 16-channel PWM controller via I2C |
| `RaspberryPiGpioManager` | Native GPIO pins (via `System.Device.Gpio`, no `pigpio` daemon) |

### Control Types

Discriminated by the `[ControlType("...")]` attribute on each class (`Onboard/Control/ControlTypes/`), not by class name:

| Type | Description |
|------|-------------|
| `Steering` | Servo steering control (`SteeringControl`) |
| `Throttle` | Motor/throttle control (`ThrottleControl`) |
| `ServoOnOff` | Two-position servo control |
| `OnOffServo` | On/off servo control |
| `RotaryLight` | Rotating lights |
| `PwmLight` / `PwmBlinker` | PWM-driven light / blinking light |
| `CustomBash` | Runs a fixed shell command on activation |
| `LoopbackToTelemetry` | Feeds a control value straight back out as telemetry |
| `LoggingOnly` | No hardware effect — logs the value (also the fallback when a `controlType` string doesn't match anything) |

There is no `ServoControl` or `GearControl` type in the current code.

### Telemetry Types

| Type | Description |
|------|-------------|
| `CpuTemperatureReader` | CPU temperature |
| `ApplicationLifetimeReader` | App uptime |
| `JbdBmsTelemetryReader` | Battery BMS via UART |
