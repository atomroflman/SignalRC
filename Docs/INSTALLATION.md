# LteCar Installation Guide

## Prerequisites

- **Server**: Linux host with Docker or Podman (the recommended path is the `install.sh` Compose stack — see below)
- **Onboard (Vehicle)**: Raspberry Pi 3/4, Linux (Raspberry Pi OS/Ubuntu/Debian) — `install.sh` installs the .NET SDK itself
- **Client**: Modern web browser (Chrome, Firefox, Edge)

## Server Installation

### Quick install (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/atomroflman/SignalRC/master/install.sh | sudo bash
# → choose "1) Server"
```

`install.sh` clones the repo (if not already checked out), asks whether to use Docker or Podman, and whether to deploy the **full stack** (`nginx` + `client` + `server` + `janus` + `postgres` + `turn`) or just the **local-debug** stack (`postgres` + `janus`, see below). It then builds/pulls the images and, at the end, offers to install a `ltecar.service` systemd unit so the stack is enabled and restarted automatically — no manual systemd unit file needed.

Run it directly instead of piping from GitHub if you already have the repo checked out:

```bash
git clone https://github.com/atomroflman/SignalRC.git
cd SignalRC
sudo bash install.sh
```

### Local Debug Setup

For local debugging, start only PostgreSQL and Janus with Docker, layering the dev overrides (extra published ports) on top of the base file:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres janus
```

`docker-compose.dev.yml` only adds host-port publishing to the `postgres`/`janus` services already defined in `docker-compose.yml` — it has no `image`/`build` of its own, so it does not work as a standalone `-f docker-compose.dev.yml` file. (Note: `install.sh`'s "Local debug support only" server option currently invokes it standalone and will fail — use the two-file form above, or the plain `docker compose up -d postgres janus` from the base file, until that's fixed.)

Then run the server from `Server/` with the development launch profile. This keeps Janus external, so the server can also point to a remote Janus by changing `JanusConfiguration__HostName`.

### Full Container Stack (manual)

If you don't use the installer, you can start the full Compose stack directly:

```bash
docker compose up --build
```

This starts nginx in front, plus client, server, Janus, PostgreSQL, and a coturn TURN server (for WebRTC clients behind restrictive NATs). All services use `restart: unless-stopped`, so they come back automatically after the container runtime restarts — but only `install.sh`'s systemd option (or your own unit) makes the stack survive a full host reboot.

### Automatic HTTPS

If you install the server with `install.sh`, you can opt into automatic HTTPS via Caddy. The installer will ask for a public domain name and then configure Caddy as a reverse proxy in front of the local client container.

### 1. Clone Repository

```bash
git clone https://github.com/atomroflman/SignalRC.git
cd SignalRC
```

### 2. Configure Server

Edit `Server/appSettings.json` (only the keys that actually bind — see [CONFIGURATION.md](CONFIGURATION.md) for the full reference and known dead keys):

```json
{
  "ConnectionStrings": {
    "DefaultConnection": "Host=localhost;Database=ltecar;Username=ltecar;Password=your-password"
  },
  "JanusConfiguration": {
    "HostName": "localhost"
  }
}
```

There is no `ServerName` or `RunJanusServer` setting — the server derives its own public URL per-request from forwarded headers, and Janus always runs as a separate process/container (there's no in-process mode).

### 3. Database Migration

The server automatically runs migrations on startup. To manually apply:

```bash
cd Server
dotnet ef database update
```

### 4. Start Server (development)

```bash
cd Server
dotnet run
```

For production, use `install.sh` or `docker compose up --build` as described above. The repo-root `start-server.sh` is a stale leftover pointing at a path from an older project layout (`LteCar.Server/bin/...`) — it does not work against the current `Server/` project and should not be used.

### Local vs Remote Janus

- Local debug: `JanusConfiguration__HostName=localhost` and run `docker compose up -d janus`
- Remote Janus: leave `JanusConfiguration.HostName` pointed at the remote instance

---

## Onboard (Vehicle) Installation

### Quick install from the server's web UI (recommended)

Open the server in a browser. With no vehicle selected, the page shows an install button that generates a command preconfigured with the server's URL, branch, and (if resolvable) git ref — paste it on the vehicle:

```bash
curl -fsSL https://YOUR-SERVER/api/install/onboard.sh | sudo bash
```

This is `install.sh` itself with `DEPLOY_MODE=onboard` and the server settings pre-filled as shell variables (see `Server/Services/OnboardInstallScriptService.cs`); it still asks interactively for anything not pre-filled and does **not** start the onboard service immediately unless you opt into the systemd prompt at the end. Vehicle-specific configuration (channels, hardware, name) and testing are done afterwards from the web client at `/car/[carId]`.

### Or run the installer directly on the vehicle

```bash
git clone https://github.com/atomroflman/SignalRC.git
cd SignalRC
sudo bash install.sh
# → choose "2) Onboard"
```

For a Raspberry Pi, `install.sh` automatically:

1. Installs `git`, `curl`, `ffmpeg`, `i2c-tools`, `python3`, and whichever camera runtime packages (`rpicam-apps`/`libcamera-tools`/`libcameraN`) are available for your distro.
2. Installs `mediamtx` (from the package manager if available, otherwise downloads the upstream release tarball into `Onboard/Extern/`).
3. Installs the .NET SDK via `dotnet-install.sh` (channel 10.0) into `~/.dotnet` — no `apt` `dotnet-sdk` package or Microsoft package feed needed.
4. Prompts for the server URL and writes it into `Onboard/appSettings.json`.
5. Publishes the Onboard client (`dotnet publish -c Release`).
6. Optionally installs and enables `ltecar-onboard.service` (+ `ltecar-mediamtx.service`) via systemd.

Hardware connections: PCA9685 PWM controller via I2C (SDA/SCL), plain GPIO outputs, a Raspberry Pi Camera Module, and an optional JBD BMS via UART for battery telemetry. GPIO/I2C access goes through the .NET `System.Device.Gpio`/`System.Device.I2c` libraries directly — no `pigpio` daemon is required or installed.

### Start Onboard Software manually

```bash
cd Onboard
dotnet run             # normal start
```

---

## Config Directory

The Onboard client supports flexible config directory locations:

### Command Line

```bash
dotnet run -- --config-dir=/path/to/config
```

### Environment Variable

```bash
export CONFIG_DIR=/path/to/config
dotnet run
```

### Interactive Selection

If no config directory is specified, the Onboard app will prompt interactively for one on first run. The chosen path is persisted in `.configdir` file.

---

## Azure Firewall

If using an Azure VM to host the **server** stack, open these ports (matches the ports actually published in `docker-compose.yml`):

| Port | Protocol | Service |
|------|------|---------|
| 8080 | TCP | nginx — the single public entry point (client, `/api/`, `/hubs/`, Janus proxy) |
| 8088, 8188 | TCP | Janus HTTP/WebSocket control plane (only needed if something talks to Janus directly, bypassing nginx) |
| 10000-10200 | UDP | Janus WebRTC media (matches `JanusConfiguration__PortRangeStart/End` in Compose) |
| 3478 | UDP + TCP | coturn TURN signaling |
| 49152-50152 | UDP | coturn TURN relay range |

```bash
az network nsg rule create \
  --resource-group myResourceGroup \
  --nsg-name myNsg \
  --name allow-http \
  --protocol tcp \
  --destination-port-range 8080 \
  --priority 100
```

**Do not** open PostgreSQL (`5432`, published by the base Compose file for local access) or the vehicle's own SSH-key listener (`8080`/`8443`, LAN-only, unrelated to the server's nginx port — see [CONFIGURATION.md](CONFIGURATION.md#ssh-key-authentication)) to the internet.

The server itself never publishes port 5000 to the host; it's only reachable through nginx. There's no TLS termination in the bundled nginx config — either put a TLS-terminating proxy in front, or use `install.sh`'s Caddy/automatic-HTTPS option.

---

## Troubleshooting

### Onboard won't connect to server

1. Check server URL is correct
2. Ensure server is running and accessible
3. Check firewall rules
4. Verify HTTPS certificate is valid

### Hardware not detected

1. Check I2C is enabled: `sudo raspi-config` → Interface Options → I2C
2. Verify connections: `i2cdetect -y 1`
3. Check GPIO permissions

### Database migration errors

Never manually modify the database. Always use EF Core migrations:

```bash
cd Server
dotnet ef migrations add AddNewFeature
dotnet ef database update
```
