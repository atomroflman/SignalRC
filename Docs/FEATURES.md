# SignalRC Features

## Overview

SignalRC provides the following features for remote vehicle control:

- **Remote Control**: Drive your car over LTE/Internet with low latency
- **Video Streaming**: Real-time video from on-board camera
- **Audio Chat**: Listen to the vehicle, push-to-talk, sound channels
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

Two-way audio between driver and vehicle, plus sound files the driver can trigger like any other control channel. Everything is configured in the web UI on the vehicle's config page (`/car/{id}/channels`, sections *Audio* and *Sounds*); the Onboard reports its ALSA devices (`arecord -l/-L`, `aplay -l/-L`) on every connect, so the fields offer them as suggestions.

| Direction | Who | Configured where |
|---|---|---|
| Vehicle → browser (listen) | Every logged-in user, independent of video | *Audio → Microphone*: device, channel (mix/left/right), recording gain, noise filter, bitrate |
| Browser → vehicle (push-to-talk) | Only the driver (active control session) | *Audio → Speaker*: device, default volume, mute microphone while talking |
| Sound channels → vehicle | Whoever drives (control channels) | *Sounds* (files) + control channels of type `SoundPlayer` |

The settings are stored per car (`Car.Audio*`, `SignalRC.Shared.Audio.AudioSettings`) and pushed to the Onboard on every (re)connect and on every change; a running uplink or speaker adapts without a restart where possible.

### Audio engine on the vehicle

```
Mic ─ALSA─► ffmpeg capture ─PCM─► gain + mute ─► ffmpeg Opus/RTP ──UDP──► Janus audio mountpoint ─WebRTC─► Browser

Push-to-talk chunks ─► ffmpeg decoder ─► jitter buffer ─┐
SoundPlayer channels ─► clip cache / ffmpeg stream ─────┼─► AudioMixer (20 ms frames, master volume) ─► aplay ─ALSA─► Speaker
```

- **MicUplink**: ffmpeg captures from ALSA (channel pick, optional denoise `highpass=f=100,afftdn=nf=-25`) and hands raw PCM to the Onboard, which applies the gain and the push-to-talk mute live (10 ms fade); a second ffmpeg encodes Opus and sends RTP. Restarted automatically if it dies. Outbound UDP like the video, so it works behind LTE CGNAT.
- **AudioMixer**: one `aplay` per speaker session; all sources are mixed, so push-to-talk and sounds play at the same time. The pipe into `aplay` is shrunk to one page, so the mixer runs at the device clock with about 100 ms of buffer. The device is opened when something plays and closed after 3 s of silence (free for other programs again). Volume changes ramp, no clicks.
- **Status**: while the uplink or the speaker runs, the Onboard reports levels and state (`AudioStatus`) four times per second; the server relays it to subscribed browsers (`SubscribeToAudioStatus`) for meters and the "playing" line.

### Listen

- The car's microphone has its **own audio-only Janus mountpoint** (id `1000000 + carId`, Opus PT 111), separate from the video mountpoints. Listening works without video, and audio changes never interrupt a running video stream.
- The *Vehicle audio* panel (right column) has the listen toggle (starts off — browser autoplay rules), a local volume up to 200 % and a level meter. The browser registers as listener with `StartAudioListening(carId)`; the server (`CarAudioService`) creates the mountpoint and sends `StartAudioUplink(port)` for the first listener and tears both down after the last one leaves (`StopAudioListening`, or the browser disconnects).
- Listeners see when the vehicle mic is muted because the driver is talking.

### Push-to-talk

```
Browser mic ─Web Audio (gain)─► MediaRecorder (WebM/Ogg, Opus)─► SignalR chunks ─► Server ─► Onboard ─► decoder ─► mixer ─► Speaker
```

1. While the button — or the bound key / gamepad button — is held, the browser records 60 ms chunks (`audio/webm;codecs=opus` in Chromium, `audio/ogg;codecs=opus` in Firefox; Safari is not supported). The microphone stays open for the whole control session after the first press (*Close mic* releases it), and recording starts at the press: chunks are held until the vehicle accepted, so no words are lost to the start-up round trip.
2. `StartAudioTalk` (driver only) → `StartAudioPlayback(sessionId, format)`; the Onboard checks the control session and adds a decoder source to the mixer. `SendAudioChunk` is only relayed for the connection that started talking; `StopAudioTalk` lets the buffered rest play out.
3. Playback stops after 5 s without data, when the browser disconnects, or when the control session changes. Talking counts as driver activity, so the session doesn't time out meanwhile.
4. **Echo**: with *Mute microphone while talking* (default on) the vehicle mutes its own microphone while push-to-talk plays plus 400 ms, so listeners don't hear the driver a second time; the driver's own player mutes locally too. There is no acoustic echo cancellation (half-duplex by design: the driver mostly listens).
5. The push-to-talk panel also has the driver's microphone gain (per browser), the **vehicle speaker volume** (driver only, `SetSpeakerVolume`, stored as the car's speaker volume and applied live) and meters for the own microphone and the vehicle speaker.

The push-to-talk panel only appears when the vehicle has a speaker configured. Expect roughly 200–300 ms from mouth to speaker.

**Key / gamepad binding:** *Assign* in the push-to-talk panel, then press a key or a gamepad button (Esc cancels). The binding is stored per browser (`localStorage`). Keys are ignored while typing in input fields; releasing focus stops talking. Don't map the same gamepad button to a vehicle channel in the flow as well.

### Sound channels

- **Library**: *Sounds* section of the config page — upload (mp3, wav, ogg/oga/opus, flac, m4a/aac, webm; up to 20 MB each), preview, delete. Files are stored in the server database (`CarSoundFiles`). The Onboard keeps a copy in `<config dir>/sounds/`: the server pushes the list on connect and after every change (`SyncSoundFiles`), missing or changed files (by SHA-256) are downloaded in 128 KB chunks over the hub (`GetSoundFileChunk`), files no longer listed are deleted.
- **Channel**: a control channel with control type `SoundPlayer`; the config page shows a structured editor for its options. The channel value is a button (|value| ≥ 0.5 = pressed), so it is bound in the flow like a light or a horn.

| Option | Default | Meaning |
|---|---|---|
| `file` | — | Library file name |
| `mode` | `toEnd` | `toEnd`: press starts, plays to the end · `hold`: plays while pressed · `toggle`: press starts, next press stops |
| `retrigger` | `restart` | (`toEnd`) pressing while it plays: `restart`, `ignore` or `stop` |
| `loop` | `false` | Repeat until stopped |
| `volumePercent` | `100` | 0–200 |
| `startSeconds` / `endSeconds` | `0` / end | Play only this part of the file |
| `fadeInMs` / `fadeOutMs` | `0` / `0` | Fades on start / on stop (stopping always fades at least 10 ms) |
| `duckOnTalk` | `false` | Quieter (25 %) while push-to-talk plays |

- Short clips (≤ 30 s per range) are decoded once and played from memory, so they start immediately; longer files are streamed through ffmpeg. Options are read on every press — edits apply without restarting the Onboard, and new channels are set up on first use.
- When control is lost (session ended, connection gone), looping, `hold` and `toggle` sounds stop; a plain one-shot plays to its end.
- Sounds only play when the vehicle has a speaker configured.

### Diagnostics

The onboard diagnostics (web UI → *Onboard diagnostics*) append audio checks (`A*`): ffmpeg with libopus and ALSA, alsa-utils (`aplay` drives the speaker), `audio` group membership, a 1 s capture test of the microphone, and a 1 s silence playback on the speaker. Devices currently in use by the uplink or the mixer are reported as OK without testing; "busy" errors usually mean PipeWire/PulseAudio holds the device.

### Requirements

- Vehicle: microphone/speaker on ALSA (a Raspberry Pi has no mic input — use a USB sound card), `ffmpeg` with `libopus`, `alsa-utils`, service user in the `audio` group (`install.sh` sets this up). Prefer the `plughw:CARD=…,DEV=…` entries: the service runs without a desktop session, so `default`/`pipewire`/`pulse` usually don't work.
- Browser: HTTPS (or `localhost`) for microphone access.
- Feature flag `audio` (default `true`); `false` makes the vehicle refuse all audio (listening, push-to-talk, sounds).

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

## Telemetry History

The page `/car/[carId]/telemetry` stores selected telemetry channels on the
server and shows them as charts per drive.

### Recording

- Under **Recording** you tick the channels to record (numbers and booleans
  only) and set how many days to keep them (default 7, per vehicle).
- The server asks the onboard for recorded channels even when nobody watches,
  so they cost LTE traffic for as long as the vehicle is connected.
- A **drive** runs from the onboard connecting until it disconnects. A
  reconnect within two minutes continues the same drive.
- At most one row per 100 ms and channel is stored. If several samples arrive
  within that time, the one furthest from the last stored value is kept, so
  short peaks survive, and the newest value follows. An unchanged value is
  repeated once per second. Stale, missing or failed values are stored as gaps.
- Older drives and samples are deleted every hour
  (`TelemetryRecorder.ApplyRetentionAsync`).
- The section **Telemetry recording** on the main page shows whether recording
  runs and has a master switch per vehicle that stops all recording (the
  channel selection is kept). It is stored on the vehicle; only the driver who
  currently controls the vehicle can change it (same rule as enabling video
  streams), everyone else sees the state only.

### Dashboard

- Charts with lines defined as formulas in the HUD expression language
  (`Shared/Overlay/expression/README.md`), e.g. power as
  `tel("bms_voltage") * tel("bms_current")`. Only `tel()` is available; outputs,
  signals and `driverActive()` are not recorded.
- The layout is stored per vehicle on the server. Without one, every unit gets
  a chart.
- Drag to zoom (the range is fetched again at a finer resolution). Double-click
  shows the whole drive again. Long ranges are reduced on the server to the
  minimum and maximum per time bucket.
- A running drive follows live (polled every second).

Code: `Server/Telemetry/History/` (recorder, reader, API under
`api/cars/{carId}/telemetry-history`) and `Client/src/components/telemetry-history/`.
The PostgreSQL tests run with `SIGNALRC_TEST_POSTGRES` set.

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
