#!/bin/bash
# filepath: /home/greg-e/SignalRC/Builds/PropagandaTruck/init-video-player.sh
# Initialize two mpv instances that listen on unix sockets for JSON IPC.
set -euo pipefail

SOCKETS=(/tmp/mpvsocket0 /tmp/mpvsocket1)
MPV_BIN=${MPV_BIN:-mpv}
LOG_DIR=${LOG_DIR:-/tmp/propaganda-mpv-logs}
START_TIMEOUT=${START_TIMEOUT:-5}

if ! command -v "$MPV_BIN" >/dev/null 2>&1; then
    echo "mpv not found in PATH (tried: $MPV_BIN)" >&2
    exit 1
fi

mkdir -p "$LOG_DIR"

# Clean or release existing sockets
for sock in "${SOCKETS[@]}"; do
    if [ -S "$sock" ]; then
        if command -v lsof >/dev/null 2>&1; then
            pids=$(lsof -t "$sock" || true)
            if [ -n "$pids" ]; then
                echo "Killing mpv processes holding $sock: $pids"
                kill $pids || true
                sleep 0.2
            fi
        fi
        if [ -S "$sock" ]; then
            echo "Removing leftover socket $sock"
            rm -f "$sock"
        fi
    fi
done

# Start mpv instances in idle mode so they accept IPC commands
i=0
for sock in "${SOCKETS[@]}"; do
    log="$LOG_DIR/mpv-$i.log"
    echo "Starting mpv for $sock -> log: $log"
    nohup "$MPV_BIN" --fs --fs-screen=$i --no-terminal --idle --input-ipc-server="$sock" \
        --no-osd-bar --pause=yes --keep-open=always --ontop --hwdec=auto --cache=no \
        >/dev/null 2>"$log" &
    i=$((i + 1))
done

# Wait for sockets to appear
deadline=$((SECONDS + START_TIMEOUT))
for sock in "${SOCKETS[@]}"; do
    while [ ! -S "$sock" ]; do
        if [ "$SECONDS" -ge "$deadline" ]; then
            echo "Timed out waiting for socket $sock" >&2
            exit 2
        fi
        sleep 0.1
    done
    echo "Socket ready: $sock"
done

echo "mpv IPC sockets initialized."
exit 0