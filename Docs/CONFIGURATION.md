# SignalRC Configuration Reference

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

#### `AutoUpdate` (self-update from the server)

```json
"AutoUpdate": {
  "Enabled": false,
  "ConfirmTimeoutMinutes": 10
}
```

| Key | Default | Meaning |
|-----|---------|---------|
| `Enabled` | `false` (also when the section is missing) | Install newer server builds automatically while no driver holds the control session. A driver can update from the GUI regardless. |
| `ConfirmTimeoutMinutes` | `10` | A freshly installed release that does not reach the server within this time exits; after three such starts it is rolled back. |

`install.sh` asks for `Enabled`; the shipped `Onboard/appSettings.json` leaves the section out so that `git pull` on vehicles with a locally edited file does not conflict. Changes take effect after restarting `signalrc-onboard.service`. Only installations in the release layout (`Onboard/current`) update themselves; `dotnet run` reports the self-update as disabled. See [OnboardAutoUpdate.md](OnboardAutoUpdate.md).

Audio devices, volumes and sound files are not configured here but per vehicle in the web UI — see [FEATURES.md](FEATURES.md#audio-chat).

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

#### `options`

The `options` of pin managers, control channels and telemetry channels are set on the public writable properties of the type with the same name (case-insensitive, `ChannelOptionBinder`); unknown keys are logged and skipped. Control properties that come from the channel itself (`name`, `address`, `pinManager`, …) cannot be overridden through `options`. Video stream `options` are read by `MediaMtxConfigurator` (`inputFormat`, `hwEncoder` for V4L2 webcams).

The onboard reports these options per type when it connects (`OptionSchemaBuilder`: JSON type, default of a fresh instance, XML doc summary as description); the server serves them at `GET /api/cars/{carId}/channels/option-schemas`. The channel config page uses them in its options editor: Ctrl+Space completes keys and values, hovering a key shows its description, and unknown keys, wrong types and unknown pin manager names are flagged. A new option property only needs a `/// <summary>` to be documented there.

---

## Feature Flags

`appSettings.json` supports five boolean feature flags, but the shipped default doesn't set any of them, and only two are actually read anywhere at runtime:

| Flag | Actually read at runtime? |
|------|-------------|
| `webSetup` | No — no code path checks it |
| `bashTool` | **Yes** — `Onboard/Program.cs` reads `configuration.GetValue<bool?>("bashTool") ?? false` to decide whether to connect the bash relay; effectively **off by default** since the key is absent from the shipped file |
| `channelTester` | No — no code path checks it |
| `audio` | **Yes** — `AudioService` reads `configuration.GetValue<bool?>("audio") ?? true`; `false` refuses stream audio and push-to-talk. **On by default** |
| `video` | No — no code path checks it; video streaming is not gated by a flag |

### Enabling Features

Set the flag directly in `appSettings.json` — as shown above, only `bashTool` and `audio` currently change behavior:

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
    "DefaultConnection": "Host=localhost;Database=signalrc;Username=signalrc;Password=signalrc;Include Error Detail"
  },
  "JanusConfiguration": {
    "HostName": "localhost"
  },
  "FileTransfer": {
    "ThrottleKBytesPerSecond": 20,
    "StoragePath": "/var/data/signalrc",
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


---

## Environment Variables

### Onboard

| Variable | Description |
|----------|-------------|
| `VEHICLE_TEMPLATES_PATH` | Template base path for filesystem vehicle templates (`VehicleTemplates/`/`vehicleTemplates/`) |

There is no `LTE_USE_NEW_CONNECTION_MODEL` variable in the current code — it doesn't appear anywhere outside old documentation. The single-hub connection model it used to toggle is now simply the only model.

### Server

| Variable | Description |
|----------|-------------|
| `ASPNETCORE_ENVIRONMENT` | Development/Production |
| `ConnectionStrings__DefaultConnection` | PostgreSQL connection string |
| `JanusConfiguration__HostName` | Janus host name or IP, as the server reaches it (HTTP API) |
| `JanusConfiguration__PublicHostName` | Host the vehicles send their RTP video to; empty = the vehicle's `ServerName` |
| `JanusConfiguration__PortRangeStart` | First UDP video port |
| `JanusConfiguration__PortRangeEnd` | Last UDP video port |
| `FileTransfer__StoragePath` | Local file storage path |
| `WebRtc__Username` / `WebRtc__Credential` | TURN credentials handed out by `/api/webrtc/ice-servers` |
| `COTURN_EXTERNAL_IP` / `COTURN_USERNAME` / `COTURN_CREDENTIAL` | Compose-level TURN setup — feeds both the `server` and `turn` (coturn) containers; falls back to an Azure IMDS public-IP lookup if `COTURN_EXTERNAL_IP` is unset |
| `JANUS_NAT_1_1` | Public IP Janus advertises for WebRTC NAT traversal (Compose); also falls back to Azure IMDS if unset, and the container hard-fails to start if neither resolves |
| `GIT_BRANCH` / `GIT_COMMIT` | Baked into the server image and its onboard packages at build time; surfaced back out via `/api/version`, the onboard-install-command endpoint and the self-update manifest. Set by `scripts/build-images.sh` from the checkout (never a fixed value: the commit is the version the onboards compare) |
| `OnboardPackages__Path` | Folder with the onboard packages `<rid>.zip`; default `onboard-packages` next to the server (`/app/onboard-packages` in the image) |

There is no `RunJanusServer` variable — the server never runs Janus in-process; it's always a separate process/container.

In Compose, the service names resolve via Docker DNS as `server`, `janus`, and `postgres`.
In the production stack, nginx is the only public entry point; browsers should use the nginx host name, not the internal service names.
If you choose the installer HTTPS option, Caddy becomes the public entry point instead of nginx.

---

## Database

SignalRC uses PostgreSQL. **Never modify the database manually** - always use EF Core migrations.

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
| `ssh_key` | Config dir | Owner private key (PKCS#8 DER), deleted after the one-time download |
| `ssh_key.pub` | Config dir | Owner public key (SPKI DER); reported to the server for config sessions |
| `device_key` | Config dir | Device private key (ECDSA P-256, PKCS#8 DER, mode 600); never leaves the vehicle |
| `device_key.pub` | Config dir | Device public key (SPKI DER); the server stores it on the first signed handshake |

The owner key is the master of every change: driving needs the control session the
vehicle issues for a signature of it, configuring needs that or a config session the
server opens for a signature of it (also while the vehicle is offline). The device key
only proves to the server that a connection is the vehicle. Details, update mode for
old onboards and how to reset a stored key: [VehicleKeyAuth.md](VehicleKeyAuth.md).

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
| `Pca9685PwmExtension` | 16-channel PWM controller via I2C; addresses 0–15 are the channels |
| `RaspberryPiGpioManager` | The Pi's own 40-pin header via `System.Device.Gpio` (libgpiod, no `pigpio` daemon); addresses are **physical** pins 1–40 |

`default` is a `RaspberryPiGpioManager` every vehicle has without an entry. Add an entry named `default` (or any other name) of that type to configure its pins:

```json
"pinManagers": {
  "default": {
    "type": "RaspberryPiGpioManager",
    "options": {
      "pins": [
        { "pin": 11, "mode": "Input", "pull": "Up", "activeLow": true, "debounceMs": 20, "label": "door" },
        { "pin": 13, "mode": "Output", "initialState": false },
        { "pin": 12, "mode": "Pwm" }
      ]
    }
  }
}
```

| Pin option | Meaning |
|------|-------------|
| `pin` | Physical header pin (1–40). The BCM number is looked up (`RaspberryPiPinMap`). |
| `mode` | `Output`, `Input` or `Pwm` (hardware PWM only on pins 12, 32, 33, 35). |
| `pull` | Inputs: `None`, `Up` (switch to GND) or `Down` (switch to 3.3 V). |
| `activeLow` | Logical "on" is electrical low; applies to reads and writes. |
| `debounceMs` | Inputs: a level counts once it was stable this long (from edge timestamps). |
| `initialState` | Outputs: logical level when the pin is opened. |
| `label` | Free text for the pin editor. |

Manager options: `driver` (`Auto`, `LibGpiod`, `LibGpiodV2`, `SysFs`; `Auto` lets `System.Device.Gpio` pick libgpiod v1/v2 and the header's `pinctrl` chip, Pi 5 included) and `gpioChip` (force a gpiochip number). Unconfigured pins become an output on the first write and an input on the first read. Problems (power pin, PWM on a non-PWM pin, duplicate pins) show up as channel health warnings.

The channel page draws the board for these two types: the Raspberry Pi matching the model the onboard reports (`/proc/device-tree/model`, sent as `boardModel` with the available channel types) or the PCA9685 breakout. Pins are hoverable and clickable; the selected pin is configured in place and can prefill a new control or telemetry channel.

**Wiring diagram** (`/car/{id}/wiring`, button on the channel page): generated from the channel map. The Pi with the parts on its header, the PCA9685 boards on the I²C bus (chained when several share bus 1), BECs for servo power and CAN/serial managers as external boxes. Parts follow the control type (`Steering`/`ServoOnOff`/`OnOffServo` → servo, `Throttle` → ESC + motor, `PwmLight`/`PwmBlinker`/`RotaryLight` → LED); a `GpioOutput` becomes a relay or buzzer when its name says so (relay, pump, horn …), otherwise an LED; input pins become buttons with the pull resistor drawn. To say what is really wired there, set `device` (`Auto`, `Led`, `Relay`, `Buzzer`, `Servo`, `Esc`, `Button`, `Sensor`, `Other`) on a pin of `RaspberryPiGpioManager` (`pins[].device`) or in the PCA9685 option `channels` (`[{ "channel": 4, "device": "Led", "label": "Blinker links" }]`); both board editors and the wiring page (click a part) have a select for it. The onboard only stores it. `GpioPinReader`/`PwmOutputReader` channels light the LEDs and turn the servo horns live. Also shows wiring warnings (servo on a non-PWM pin, I²C address clash, SDA/SCL in use), a parts list and a wire list; exports as SVG or print.

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
| `GpioOutput` | Switches a digital pin: on at or above `threshold` (0.5); `releaseState` `Off`/`On`/`Keep` |
| `LoggingOnly` | No hardware effect — logs the value (also the fallback when a `controlType` string doesn't match anything) |

There is no `ServoControl` or `GearControl` type in the current code.

### Telemetry Types

| Type | Description |
|------|-------------|
| `CpuTemperatureReader` | CPU temperature in °C as a plain number (data type Number; the unit belongs to the channel) |
| `ApplicationLifetimeReader` | Onboard uptime in whole seconds (data type Integer, unit `s`) |
| `JbdBmsTelemetryReader` | Battery BMS via UART |
| `GpioPinReader` | State of a digital pin (`1`/`0`, data type Boolean) from the channel's `pinManager` + `address`. `latch` (default true) keeps a pulse shorter than the read interval for one read; `report: Edges` counts debounced edges instead. Works for inputs and outputs. |
| `PwmOutputReader` | What a PWM output drives. PCA9685: read back from the chip registers (`Valid`; `Error` when the chip was reset and sleeps); Pi hardware PWM: last write (`Unchecked`). `report`: `Percent` (default), `DutyCycle`, `PulseWidthMs`, `PulseWidthUs`, `Counts`. |

Readers declare what they deliver per value key with `[TelemetryValue(key, dataType, unit, Decimals = …, When = "option=Value")]` (empty key: the single value of a one-value reader). The onboard reports this with the option schema; the channel editor of the setup page takes it over as data type, unit and decimals when a channel is created (until one of them is edited by hand) and offers an **Apply** button on existing channels that differ. `TelemetryValueHintTests` checks that the track drive and LiDAR readers declare every key they produce. JBD BMS values only have suggestions for the keys the code knows (`voltage`, `current`, `soc`, `remaining`, `capacity`, `cycles`, `temperature`, `currentAvg`, `runtime`); the others come from jbdtool unchanged.

Both pin readers take `pinManager` and `address` from the channel itself and share the module instance of the control on the same pin. In flows the node **Telemetry** (`channel`, `fallback`; outputs `value`, `valid`) turns any telemetry channel into a flow input; it runs in the driver's browser, so end stops and e-stops belong on the vehicle.
