#!/bin/bash
# filepath: /home/greg-e/SignalRC/Builds/PropagandaTruck/next.sh
# Play next track on all mpv IPC sockets (no arguments).
set -euo pipefail

SOCKETS=(/tmp/mpvsocket0 /tmp/mpvsocket1)
TIMEOUT=1

if ! command -v socat >/dev/null 2>&1; then
    echo "socat nicht gefunden. Bitte socat installieren." >&2
    exit 3
fi

if [ $# -ne 0 ]; then
    echo "Dieses Script akzeptiert keine Parameter." >&2
    exit 2
fi

for sock in "${SOCKETS[@]}"; do
    if [ ! -S "$sock" ]; then
        echo "Socket fehlt: $sock" >&2
        continue
    fi
    printf '{ "command": ["set_property", "volume", 110] }\n' | socat - UNIX-CONNECT:"$sock"
    printf '%s\n' '{"command":["playlist-next"]}' | socat -t "$TIMEOUT" - UNIX-CONNECT:"$sock" >/dev/null 2>&1
    printf '%s\n' '{"command":["set_property","pause",false]}' | socat -t "$TIMEOUT" - UNIX-CONNECT:"$sock" >/dev/null 2>&1
done
echo "Nächster Track auf allen mpv-Instanzen abgespielt."
