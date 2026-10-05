# LteCar – Concepts & Implementation Reference

*A condensed, code-level reference. For the narrative version, see [Architecture.md](Architecture.md). For a German summary of the whole documentation set, see [README.de.md](README.de.md).*

## Architecture
- **3-tier stack**: Browser (Next.js) ↔ Server (ASP.NET Core 8) ↔ Onboard (Raspberry Pi, .NET 8).
- **Communication**: SignalR (MessagePack/JSON) + WebRTC (Janus) for video.
- **LTE design**: Onboard only ever opens outbound connections → NAT-/firewall-friendly.
- **Containers**: `docker-compose.yml` starts `postgres`, `server`, `janus`, `turn` (coturn), `client`, `nginx` (port 8080).
- **Nginx**: reverse proxy with WebSocket upgrade for `/hubs/`, `/api/`, `/janus/`, `/janus-ws/`.

## SignalR Hubs (`Shared/HubPaths.cs`)

The vehicle-side hubs were consolidated onto a single connection; `CarControlHub`, `TelemetryHub`, and `CarVideoHub` no longer exist as separate classes. `CarUiHub` still has a path constant but no hub uses it — it's dead.

| Hub | Path | Purpose |
|-----|------|-------|
| `CarConnectionHub` | `/hubs/connection` | The one vehicle-side hub: registration, ChannelMap sync, control, telemetry, video signaling, file transfer |
| `CarBashHub` | `/hubs/carbash` | Bash command dispatch (output streams back over `CarConnectionHub.SendBashOutput`, broadcast to all clients) |
| `UserChannelHub` | `/hubs/userchannel` | Gamepad sync between browsers |
| `CarAudioHub` *(exists, not mapped)* | — | Audio chat signaling — implemented but not registered in `Program.cs` yet |

## Connection Model
- The server is the single source of truth for the channel map.
- `OpenCarConnection(carIdentityKey, hash)` compares the client's hash against the server's.
  - On a mismatch, the server immediately pushes the current map via `ApplyChannelMap`.
  - If the server has no configuration yet, it stays empty; initial configuration happens via the web UI or a template.
- `SyncChannelMap` fetches the current server map including hash and IDs; the client overwrites its local configuration with it.
- UI changes to a channel push the changed single value to the connected vehicle immediately.

There used to be an `LTE_USE_NEW_CONNECTION_MODEL` flag toggling between an old multi-hub model and this one; the flag no longer exists in the code — this single-hub model is now simply the only one.

## VehicleConnectionManager (Onboard)
- Central `HubConnection` with auto-reconnect (exponential backoff) to `CarConnectionHub`.
- Reflects over all `IVehicleService` implementations → calls `OnConnected`/`OnReconnected`.
- `CarConnectionStore` (Server) maps `connectionId ↔ carId` via a `BiDictionary`.
- `channelMap.server.json` caches the server-side ID assignment.

## Feature Flags

Five flags can be set in `appSettings.json` — but only `bashTool` is actually read anywhere at runtime (`Onboard/Program.cs`, defaults to `false` when unset):

| Flag | Actually wired up? |
|------|--------------|
| `webSetup` | No — no web-based setup interface exists |
| `bashTool` | **Yes** — gates the bash relay connection |
| `channelTester` | No |
| `audio` | No — and `CarAudioHub` isn't registered either |
| `video` | No — video streaming isn't gated by this flag |

## Onboard Services
- **TelemetryService** – tick loop, reads `TelemetryReaderBase` implementations (CpuTemp, JBD BMS, lifetime), pushes over `CarConnectionHub`.
- **ControlService** – receives control commands, SSH challenge auth, delegates to hardware (PCA9685/GPIO); also relays bash output via `SendBashOutput`.
- **VideoStreamService** – manages the MediaMTX process and its configuration from the ChannelMap.
- **AudioChatService** – bidirectional audio connection, device management, echo cancellation (not currently reachable — see `CarAudioHub` above).
- **BashToolService** – subscribes to `ExecuteCommand` on `CarBashHub`, runs local processes, streams output back via `CarConnectionHub`.
- **SshKeyService** – RSA-2048, challenge/verify, fingerprint logging; serves the private key over a LAN-only listener on ports 8080/8443.
- **CarConfigurationService** – stores server-assigned config (Janus, video settings).
- **MediaMtxConfigurator** – configures `mediamtx.yml` for the camera stream.

## WebRTC / Janus
- Path: camera → MediaMTX (RTSP) → ffmpeg/TCP relay → Janus (RTP → WebRTC) → browser.
- `VideoStreamReceiverService` allocates UDP ports (`10000`–`10200` in the Compose stack), sets up Janus stream endpoints.
- `ActiveVideoStreamViewerRegistry` starts/stops the stream only while a viewer is actually watching.
- A coturn TURN server (`turn` service in Compose) is available alongside plain STUN; the server hands out ICE server config (STUN always, TURN if configured) via `GET /api/webrtc/ice-servers`, and the client feeds it into the Janus session.

## Database (EF Core 9, PostgreSQL)
Entities: `User`, `Car`, `CarChannel`, `CarPinManager`, `CarTelemetry`, `CarVideoStream`, `ChannelTemplate`, `UserCarSetup`, `UserSetupFlowNodeBase` (and subclasses), `UserSetupLink`, `FileTransfer`. Sqids-encoded session IDs via `UserSessionSeq`.

## Client (Next.js 15, React 19, Zustand, ReactFlow)
- `/` – main page: video, car selection, control, telemetry.
- `/car/[carId]` – ReactFlow editor for gamepad→channel mapping, plus the Templates panel.
- `/car/[carId]/channels` – channel configuration.
- `/car/[carId]/test` – channel tester.
- `/car/[carId]/bash` – bash terminal.
- Components: `car-control`, `car-video-panel`, `video-stream` (Janus client), `telemetry`, `ssh-key-manager`, `session-transfer`, `gamepad-viewer`, `audio-chat`, `update-control`, `config-guard`, `install-dialog`, `onboard-diagnostics`, `setup-template-panel`.

## Templates

There are **two independent template systems**:

1. **Filesystem templates** (`VehicleTemplates/`) — a folder per vehicle with `config.json` (ChannelMap) plus optional `scripts/`, `models/`, `docs/`, `README.md`. Managed by hand (there is no console tool for this anymore — see [VehicleTemplates/README.md](../VehicleTemplates/README.md)). Base path via `VEHICLE_TEMPLATES_PATH`, default `~/vehicleTemplates/`.
2. **Server-side channel templates** (`Server/Controllers/TemplatesController.cs`, `ChannelTemplate` DB entity) — `GET/POST /api/templates`, applied to a live car via `POST /api/templates/cars/{carId}/apply/{templateId}`, managed from the web client's Templates panel.

They don't currently interoperate — applying one does not affect the other.

## Bash Tool
- Web → Server: `CarBashHub.ExecuteCommand`.
- Server → Onboard: same hub relays `ExecuteCommand` to the vehicle's `BashToolService`.
- Onboard → Server → Browsers: `BashToolService` starts `/bin/bash`, pipes output through `ControlService.SendBashOutput` over `CarConnectionHub`; the server broadcasts it to all connected clients.

## File Transfer
- **Upload**: `RequestFileUpload` → token → `POST /api/filetransfer/{token}` (max 100 MB, SHA-256 check) → `FileReady` notification.
- **Download**: `GET /api/filetransfer/{token}/download` with range support and bandwidth throttling (default 20 KB/s).
- The `FileTransfer` entity tracks status.

## Authentication
- **Browser**: `LteCarAuth` cookie (`HttpOnly`, `SameSite=Lax`), Sqids session token, recovery key, 5-minute `TransferCode` for session transfer.
- **Vehicle identity**: GUID (`carIdentityKey.txt`), SHA-256 verification.
- **Control auth**: SSH-key challenge-response (RSA-2048, Web Crypto API). The private key is deleted from the vehicle after download.
- **DataProtection keys** live in `Server/DataProtectionKeys/`.

## Configuration
- **Onboard `appSettings.json`**: `ServerName`, `ServerPort`, `UseHttps`, `CarName`, `CarSecret`, `CameraOptions`, plus the (mostly inert) feature flags — see [CONFIGURATION.md](CONFIGURATION.md).
- **Server `appSettings.json`**: `IdSalt`, `IdAlphabet`, `ConnectionStrings.DefaultConnection`, `JanusConfiguration` (`HostName`, `PortRangeStart`/`PortRangeEnd`), `FileTransfer`, `WebRtc` (TURN config). No `ServerName`/`Application`/`RunJanusServer` section exists.
- **Onboard config directory**: via `CONFIG_DIR`, `--config-dir=`, or `.configdir`.
- **ChannelMap**: separates `pinManagers`, `controlChannels`, `telemetryChannels`, `videoStreams`.
- **Server env vars**: `ConnectionStrings__DefaultConnection`, `JanusConfiguration__HostName`, `JanusConfiguration__PortRangeStart`/`PortRangeEnd`, `FileTransfer__StoragePath`, `WebRtc__Username`/`WebRtc__Credential`, `COTURN_EXTERNAL_IP`/`COTURN_USERNAME`/`COTURN_CREDENTIAL`, `JANUS_NAT_1_1`, `ASPNETCORE_ENVIRONMENT`, `GIT_BRANCH`, `GIT_COMMIT`.
