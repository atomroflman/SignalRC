# DebugDesktop

Minimal debug configuration for running the Onboard client on a non-Pi machine
(dev notebook, x86_64 Linux with webcam).

## Contains

- One control channel `log` (LoggingOnly — logs every value received from the
  server, does nothing else)
- One telemetry channel: `cpuTemperature` (works via `/sys/class/thermal`)
- One video stream `webcam` (v4l2, `/dev/video0`, 1280x720@30)

## Start

From `Onboard/`:

```bash
dotnet run -- --config-dir=../Builds/DebugDesktop
```

Requires a local Server on `localhost:5000` (HTTP) — e.g.
`cd Server && dotnet run` against the existing dev PostgreSQL.

## Purpose

This config avoids Raspberry Pi-only hardware so you can run server and client
locally for testing. Video comes from any V4L2 device exposed at `/dev/video0`
(use `v4l2-ctl --list-devices` to verify, override `cameraDevice` in the
`webcam` entry of `channelMap.json` for others).
