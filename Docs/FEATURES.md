# SignalRC Features

## Overview

SignalRC provides the following features for remote vehicle control:

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

SignalRC supports unlimited control channels defined in `channelMap.json`, each backed by a `controlType` implementation (`Onboard/Control/ControlTypes/`) — see [Configuration Reference → Control Types](CONFIGURATION.md#control-types) for the full, current list. The common ones:

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

Two-way audio between driver and vehicle. Everything is configured in the web UI on the vehicle's channel page (`/car/{id}/channels`); the Onboard reports its ALSA devices (`arecord -l/-L`, `aplay -l/-L`) on every connect, so the fields offer them as suggestions.

| Direction | Who | Configured where |
|---|---|---|
| Vehicle → browser (listen) | Everyone watching the video stream | Per video stream: *Audio input (ALSA)* + optional *Noise filter* |
| Browser → vehicle (push-to-talk) | Only the driver (active control session) | Per vehicle: *Audio → Speaker (ALSA)* |

### Listen (part of the video stream)

```
Mic ─ALSA─► ffmpeg (Opus/RTP) ──UDP──► Janus mountpoint (video + audio) ──WebRTC──► Browser
```

- A video stream with an audio input gets an audio port on its Janus mountpoint (Opus, PT 111) next to the video port.
- When the stream starts (first viewer), the server sends `StartVideoStream` and `StartAudioUplink(streamId, port)`; when it stops, `StopAudioUplink`. The Onboard's `AudioService` runs the capture in its **own** ffmpeg, so a broken microphone can't take the video down, and restarts it if it dies. Outbound UDP like the video, so it works behind LTE CGNAT.
- *Noise filter* adds `highpass=f=100,afftdn=nf=-25` (rumble cut + FFT denoiser against steady motor/wind noise).
- The video panel shows a *Vehicle audio* toggle for streams with audio; it starts muted (browser autoplay rules).
- Changing the audio input takes effect the next time the stream starts.

### Push-to-talk

```
Browser mic ─MediaRecorder (WebM/Ogg, Opus)─► SignalR chunks ─► Server ─► Onboard ─stdin─► ffmpeg ─ALSA─► Speaker
```

1. While the button is held, the browser records 100 ms chunks (`audio/webm;codecs=opus` in Chromium, `audio/ogg;codecs=opus` in Firefox; Safari is not supported).
2. `StartAudioTalk` → the server looks up the car's speaker and calls `StartAudioPlayback(sessionId, format, device)`; the Onboard checks the control session and starts ffmpeg reading from stdin. `SendAudioChunk` pipes the chunks in order; `StopAudioTalk` closes stdin.
3. Playback stops after 5 s without data, when the browser disconnects, or when the control session changes. Talking counts as driver activity, so the session doesn't time out meanwhile.
4. While talking, the browser mutes the vehicle audio (half-duplex), so you don't hear yourself through the vehicle microphone. Janus does no acoustic echo cancellation; full duplex would need e.g. PipeWire `module-echo-cancel` on the vehicle.

The push-to-talk panel only appears when the vehicle has a speaker configured. Expect a few hundred milliseconds of latency.

### Requirements

- Vehicle: microphone/speaker on ALSA (a Raspberry Pi has no mic input — use a USB sound card), `ffmpeg` with `libopus`, `alsa-utils`, service user in the `audio` group (`install.sh` sets this up). Prefer the `plughw:CARD=…,DEV=…` entries: the service runs without a desktop session, so `default`/`pipewire`/`pulse` usually don't work.
- Browser: HTTPS (or `localhost`) for microphone access.
- Feature flag `audio` (default `true`); `false` makes the vehicle refuse both directions.

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

This is the one feature flag that's actually read at startup (`Onboard/Program.cs`, falls back to `false` if the key is absent) — besides `audio`, it's the only one of the five feature flags that currently has any runtime effect.

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
2. `~/vehicleTemplates/` by default (the user's home directory, not `~/.signalrc/`)

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

All five flags below can be set in `appSettings.json`. Two of them currently change what the running Onboard process does:

| Feature | Actually wired up at runtime? |
|---------|---------|
| `webSetup` | No — no such interface exists; toggling it has no effect |
| `bashTool` | **Yes** — gates the bash relay connection (`Onboard/Program.cs`); defaults to `false` when the key is absent |
| `channelTester` | No — the web client's test page works regardless of this flag |
| `audio` | **Yes** — `AudioService` refuses stream audio and push-to-talk when `false`; defaults to `true` |
| `video` | No — video streaming isn't gated by this flag |

Treat the others as reserved-for-future-use rather than as functioning on/off switches.
