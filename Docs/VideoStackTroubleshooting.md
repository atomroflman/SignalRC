# LteCar Video Stack – Architecture & Step-by-Step Test Guide

This document describes the complete data flow of a video stream from the Raspberry Pi camera sensor to the browser, defines test points at each link in the chain, and gives commands to check whether the stream is working up to that point.

> As of: 2026-08-10  
> Affected systems: `lte-truck` (Onboard / Raspberry Pi), `lte-rc-server` (Server + Janus), browser client.

---

## 1. Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  BROWSER                                                                      │
│  ┌─────────────────┐   WebRTC (SFU)   ┌──────────────────────────────────┐  │
│  │ video-stream.tsx│ ◄────────────────► │ Janus WebRTC Server (Container)  │  │
│  └─────────────────┘                   │  - streaming plugin              │  │
│                                        │  - RTP mountpoint (UDP ingest)   │  │
└────────────────────────────────────────┴──────────────────────────────────┘  │
                                           ▲                                    │
                                           │ UDP/RTP (port 10000–10200)         │
                                           │                                    │
┌──────────────────────────────────────────┴──────────────────────────────────┐
│  lte-rc-server                                                                │
│  ┌──────────────────────────┐    SignalR     ┌────────────────────────────┐ │
│  │ LteCar.Server            │ ◄──────────────►│ LteCar.Onboard (lte-truck) │ │
│  │  - VideoStreamReceiver   │                 │  - VideoStreamService      │ │
│  │  - ActiveVideoStreamViewerRegistry          │  - MediaMtxConfigurator    │ │
│  └──────────────────────────┘                 └────────────────────────────┘ │
│                          │                                                    │
│                          ▼ Janus HTTP API (localhost:8088)                    │
│                   ┌──────────────┐                                            │
│                   │ Janus        │                                            │
│                   └──────────────┘                                            │
└───────────────────────────────────────────────────────────────────────────────┘

                                           │
                                           │ RTSP
                                           │
                            ┌──────────────▼──────────────┐
                            │ MediaMTX (on lte-truck)      │
                            │  - source: rpiCamera        │
                            │  - runOnInit: ffmpeg        │
                            └──────────────┬──────────────┘
                                           │
                                           ▼ libcamera
                            ┌─────────────────────────────┐
                            │ Raspberry Pi Camera (OV5647)│
                            │  /dev/media0 + /dev/media3  │
                            └─────────────────────────────┘
```

### Brief description of the steps

1. **Camera / libcamera** – MediaMTX opens the Raspberry Pi camera via `libcamera`.
2. **MediaMTX / RTSP** – MediaMTX exposes the stream internally as `rtsp://localhost:8554/<streamId>`.
3. **Onboard ffmpeg** – MediaMTX starts `runOnInit: ffmpeg`, which reads the RTSP stream and sends RTP to the server.
4. **Network lte-rc-server** – RTP packets arrive at the server (UDP port range 10000–10200).
5. **Janus ingest** – The server creates an RTP mountpoint via the Janus HTTP API, and Janus receives the RTP.
6. **SignalR control** – Client and server coordinate over SignalR when a stream should be active.
7. **WebRTC delivery** – The browser fetches the stream from Janus via WebRTC.

---

## 2. Step-by-step test guide

### Step 0: Onboard process is running

The entire video stack starts on the truck. If `LteCar.Onboard` is not running, there is no stream.

**What happens:**
- `LteCar.Onboard` registers itself with the server (`CarConnectionHub.OpenCarConnection`).
- When it receives `StartVideoStream(streamId, settings)`, it restarts MediaMTX and configures ffmpeg with `settings.TargetPort`.

**Test:**

```bash
ssh lte-truck "ps aux | grep -E 'LteCar.Onboard|mediamtx|mtxrpicam' | grep -v grep"
```

**Expected result:**
```text
greg-e  <pid>  …  ./LteCar.Onboard
greg-e  <pid>  …  /…/Extern/mediamtx /…/Extern/mediamtx.yml
greg-e  <pid>  …  /dev/shm/mediamtx-rpicamera-…/mtxrpicam
```

**If not:**
- The `ltecar-onboard.service` service is in a `failed` state (see `systemctl status ltecar-onboard`).
- Or the manually started process was terminated (reboot, crash, terminal session ended).
- Fix: restart `LteCar.Onboard` (see section 3).

---

### Step 1: Camera is opened by MediaMTX

**What happens:**
- MediaMTX starts the `mtxrpicam` helper for each `source: rpiCamera` path.
- `mtxrpicam` talks to `/dev/media0` and `/dev/media3` via libcamera.

**Test:**

```bash
ssh lte-truck "sudo lsof /dev/media0 /dev/media3 2>/dev/null"
```

**Expected result:**
```text
COMMAND    PID   USER FD   TYPE DEVICE NAME
mtxrpicam <pid> greg-e 6uW  CHR  511,0 /dev/media0
mtxrpicam <pid> greg-e 7uW  CHR  511,3 /dev/media3
```

**Test:**

```bash
ssh lte-truck "grep -E 'Camera.acquire|stream is available' /tmp/ltecar_onboard_restart.log | tail -10"
```

**Expected result:**
```text
[path mainCamera] stream is available and online, 1 track (H264)
```

**If not:**
- Error `Pipeline handler in use by another process` → an old `mtxrpicam` process is blocking the camera.
- Fix: kill all `mtxrpicam` processes, restart Onboard/MediaMTX.

---

### Step 2: RTSP stream available on localhost

**What happens:**
- MediaMTX publishes the camera stream at `rtsp://localhost:8554/<streamId>`.
- `runOnInit: ffmpeg` reads this RTSP stream and sends it to the server as RTP.

**Test:**

```bash
ssh lte-truck "ffmpeg -rtsp_transport tcp -i rtsp://localhost:8554/mainCamera -c copy -f null - 2>&1 | tail -20"
```

**Expected result:**
- No `404 Not Found`.
- Output contains `Stream #0:0: Video: h264` and keeps running (with `frame= … fps= …`).

**If not:**
- MediaMTX did not create the path correctly.
- Check the config: `cat /home/greg-e/SignalRC/Onboard/bin/Debug/net10.0/Extern/mediamtx.yml`.

---

### Step 3: ffmpeg sends RTP to the server

**What happens:**
- `ffmpeg -i rtsp://localhost:8554/mainCamera -c copy -f rtp rtp://<server>:<targetPort>?pkt_size=1300`
- `<targetPort>` is assigned by the server and passed to Onboard via SignalR.

**Test on lte-truck:**

```bash
ssh lte-truck "ps aux | grep -E 'ffmpeg.*rtp' | grep -v grep"
```

**Expected result:**
```text
greg-e  <pid>  …  ffmpeg -t 2147483647 -i rtsp://localhost:8554/mainCamera -c copy -f rtp rtp://lte-rc.northeurope.cloudapp.azure.com:<port>?pkt_size=1300
```

**Test on lte-rc-server (incoming UDP packets):**

```bash
ssh lte-rc-server "ss -uanp | grep -E ':10000|:10001'"
```

**Expected result:**
```text
UNCONN 0  0  *:<port>  *:*  users:(("rootlessport",pid=…,fd=…))
```

**More precise test (count packets, 30 seconds):**

```bash
ssh lte-rc-server "sudo timeout 30 tcpdump -nni any udp port <targetPort> -c 100 2>&1 | tail -20"
```

**If not:**
- Firewall / NAT is blocking outgoing RTP traffic.
- Incorrect ffmpeg arguments (server hostname / port).
- Onboard did not receive a valid `TargetPort` from the server.

---

### Step 4: Janus is running and reachable from the server

**What happens:**
- The server talks to Janus via its HTTP API on port 8088.
- An RTP mountpoint is created in `janus.plugin.streaming` for each active stream.

**Test:**

```bash
ssh lte-rc-server "curl -s http://localhost:8088/janus/info | head -10"
```

**Expected result:**
```json
{
  "janus": "server_info",
  "name": "Janus WebRTC Server",
  "version_string": "1.1.4",
  ...
}
```

**Test:**

```bash
ssh lte-rc-server "docker ps | grep janus"
# or podman
ssh lte-rc-server "podman ps | grep janus"
```

**Expected result:**
```text
<container-id>  docker.io/canyan/janus-gateway:latest  …  Up …  0.0.0.0:8088->8088, 0.0.0.0:8188->8188, 10000-10200/udp
```

**If not:**
- Janus container not started.
- `janus.transport.http.jcfg` only binds IPv6; set `ip = "0.0.0.0"`.

---

### Step 5: Janus mountpoint exists for the stream

**What happens:**
- `VideoStreamReceiverService.OpenJanusEndpointAsync` creates:
  1. a Janus session
  2. a handle for `janus.plugin.streaming`
  3. an RTP mountpoint with the stream's DB id and `VideoPort = stream.JanusPort`

**Test (manual Janus API):**

```bash
ssh lte-rc-server '
  SESSION=$(curl -s -X POST http://localhost:8088/janus -d "{\"janus\":\"create\",\"transaction\":\"t1\"}" | jq -r .data.id) &&
  HANDLE=$(curl -s -X POST http://localhost:8088/janus/$SESSION -d "{\"janus\":\"attach\",\"plugin\":\"janus.plugin.streaming\",\"transaction\":\"t2\"}" | jq -r .data.id) &&
  curl -s -X POST http://localhost:8088/janus/$SESSION/$HANDLE -d "{\"janus\":\"message\",\"body\":{\"request\":\"list\"},\"transaction\":\"t3\"}" | jq .'
```

**Expected result:**
```json
{
  "janus": "success",
  "plugindata": {
    "data": {
      "streaming": "list",
      "list": [
        {
          "id": <streamDbId>,
          "description": "<car>-<streamName>",
          "type": "rtp",
          "video_port": <janusPort>
        }
      ]
    }
  }
}
```

**If not:**
- Check the server log: `VideoStreamReceiverService` could not create the Janus endpoint.
- Possible causes: port range exhausted, Janus unreachable, mountpoint id collision.

---

### Step 6: SignalR control works

**What happens:**
- A stream is selected in the browser (`car-video-panel.tsx`).
- `ActivateStream(streamId)` is called over SignalR on the `CarConnectionHub`.
- The server starts the stream (`StartStreamForViewersAsync`) and sends `StartVideoStream` to the truck.
- The truck then starts MediaMTX/ffmpeg (see step 3).

**Test from the browser DevTools console tab (authenticated on the UI):**

```javascript
const conn = new signalR.HubConnectionBuilder()
  .withUrl('/hubs/connection')
  .withAutomaticReconnect()
  .build();
await conn.start();
const streams = await conn.invoke('GetVideoStreamsForCar', <carId>);
console.table(streams);
await conn.invoke('ActivateStream', streams[0].id);
```

**Expected result:**
- `GetVideoStreamsForCar` returns at least one activated stream.
- `ActivateStream` returns without error.
- An ffmpeg process appears on the truck (see step 3).

**If not:**
- Check the SignalR connection (`/hubs/connection` must be proxied to the server through nginx).
- Check the server log for errors in `ActivateStream`.

---

### Step 7: Browser can reach Janus

**What happens:**
- `video-stream.tsx` loads `/janus.js` and connects to `/janus` (HTTP) and `/janus-ws` (WebSocket).
- nginx forwards both to the Janus container.

**Test:**

```bash
# from the local machine / browser host
curl -s https://<server-url>/janus/info | head -5
# e.g.:
curl -s https://lte-rc.northeurope.cloudapp.azure.com/janus/info | head -5
```

**Expected result:**
```json
{ "janus": "server_info", ... }
```

**WebSocket test:**

```bash
curl -i -N \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  -H "Sec-WebSocket-Version: 13" \
  https://<server-url>/janus-ws
```

**Expected result:**
- HTTP/1.1 101 Switching Protocols.

**If not:**
- Check the nginx config (`nginx/nginx.conf`).
- Check the firewall on the server.
- The WebSocket path must be reachable at exactly `/janus-ws` (no trailing slash).

---

### Step 8: WebRTC ICE and media flow in the browser

**What happens:**
- `video-stream.tsx` fetches ICE server config from `GET /api/webrtc/ice-servers` (STUN always, TURN if configured) and passes it to Janus, then attaches the `janus.plugin.streaming` plugin.
- It requests `request: 'list'`, finds the matching mountpoint by `streamId`, and sends `request: 'watch'`.
- Janus responds with an SDP offer; the browser creates an SDP answer and sends `request: 'start'`.
- Janus delivers video frames to the browser.

**Test in the browser DevTools:**

1. **Network tab:** `/janus` and `/janus-ws` must return 200/101.
2. **Console:** no errors such as `Janus init error`, `plugin attach error`, `noStreamsAvailable`.
3. **WebRTC internals:** `chrome://webrtc-internals` (Chrome) or `about:webrtc` (Firefox).
   - ICE state should become `connected` or `completed`.
   - Inbound RTP stats should show `packetsReceived` and `framesPerSecond` increasing.

**Expected result:**
- The `<video>` element shows an image.
- The overlay shows fps and bitrate.

**If not:**
- Open `chrome://webrtc-internals` and check:
  - No ICE candidates? → NAT/firewall problem, check `JANUS_NAT_1_1` in `docker-compose.yml`.
  - ICE connected but no packets? → RTP is not reaching Janus (check steps 3–5).
  - `noStreamsAvailable` → the mountpoint does not exist (step 5).

---

## 3. Recovery after a failure

### 3.1 Truck was rebooted

Onboard on `lte-truck` currently does not start automatically after a reboot, because `ltecar-onboard.service` is in a `failed` state. After a reboot it must be restarted manually:

```bash
ssh lte-truck

cd /home/greg-e/SignalRC/Onboard/bin/Debug/net10.0/
DOTNET_ROOT=/home/greg-e/.dotnet \
DOTNET_ENVIRONMENT=Production \
PATH=/home/greg-e/.dotnet:/home/greg-e/.dotnet/tools:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
nohup ./LteCar.Onboard > /tmp/ltecar_onboard_restart.log 2>&1 &
```

Then check steps 0–2.

### 3.2 Camera blocked

```bash
ssh lte-truck "ps aux | grep -E 'mtxrpicam|mediamtx' | grep -v grep"
# If multiple instances are running:
ssh lte-truck "sudo killall -9 mtxrpicam mediamtx"
# Restart Onboard (see 3.1)
```

### 3.3 Janus mountpoint stale / duplicated

```bash
ssh lte-rc-server '
  SESSION=$(curl -s -X POST http://localhost:8088/janus -d "{\"janus\":\"create\",\"transaction\":\"t1\"}" | jq -r .data.id) &&
  HANDLE=$(curl -s -X POST http://localhost:8088/janus/$SESSION -d "{\"janus\":\"attach\",\"plugin\":\"janus.plugin.streaming\",\"transaction\":\"t2\"}" | jq -r .data.id) &&
  curl -s -X POST http://localhost:8088/janus/$SESSION/$HANDLE -d "{\"janus\":\"message\",\"body\":{\"request\":\"list\"},\"transaction\":\"t3\"}" | jq .'
```

If needed, destroy individual mountpoints:

```bash
ssh lte-rc-server '
  SESSION=… HANDLE=…
  curl -s -X POST http://localhost:8088/janus/$SESSION/$HANDLE \
    -d "{\"janus\":\"message\",\"body\":{\"request\":\"destroy\",\"id\":<streamDbId>},\"transaction\":\"t4\"}"'
```

---

## 4. Known issues & planned fixes

| Problem | Cause | Status |
|---------|---------|--------|
| Onboard does not start automatically after reboot | `ltecar-onboard.service` is `failed` | Needs investigation / the service needs to be fixed |
| Camera stays blocked by an old `mtxrpicam` | `MediaMtxConfigurator.StopAsync()` only terminates the main process, not the helper | Fix implemented in `Onboard/Services/MediaMtxConfigurator.cs` |
| Server-pushed ChannelMap does not include `pinManagers` | `ChannelMap.PinManagers` has `[IgnoreMember]` | Fix implemented in `Shared/Channels/ChannelMap.cs` |
| Server container restart loses Janus sessions | Janus keeps sessions in RAM | No fix needed; the server recreates mountpoints on demand |

---

## 5. Files in the project

| File | Purpose |
|-------|-------|
| `Onboard/Video/VideoStreamService.cs` | Starts/stops MediaMTX based on active streams |
| `Onboard/Services/MediaMtxConfigurator.cs` | Writes `mediamtx.yml`, starts/stops MediaMTX |
| `Server/Hubs/CarConnectionHub.cs` | SignalR hub for stream activation/deactivation |
| `Server/Services/VideoStreamReceiverService.cs` | Assigns ports, creates Janus mountpoints |
| `Server/Services/ActiveVideoStreamViewerRegistry.cs` | Counts viewers per stream |
| `Shared/Channels/ChannelMap.cs` | Data type for the ChannelMap, including PinManagers |
| `Client/src/components/car-video-panel.tsx` | UI for stream selection and activation |
| `Client/src/components/video-stream.tsx` | Janus/WebRTC player in the browser |
| `nginx/nginx.conf` | Reverse proxy for client, server, Janus |
| `docker-compose.yml` | Container orchestration |
| `janus-config/janus.plugin.streaming.jcfg` | Disables Janus example streams (`no_default_streams = true`) |
