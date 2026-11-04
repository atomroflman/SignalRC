#!/usr/bin/env bash
# Capture raw bytes from the FM1828 lidar. Nothing but coreutils and stty, so
# it runs on any Linux box without installing anything.
#
#   ./lidar-capture.sh /dev/ttyUSB0 10 lidar.bin
#
# The module idles until told to spin. "startlds$" wakes it and it then streams
# on its own; there is nothing to poll.
set -euo pipefail

PORT="${1:-/dev/ttyUSB0}"
SECONDS_TO_RUN="${2:-10}"
OUT="${3:-lidar-$(date +%Y%m%d-%H%M%S).bin}"

if [ ! -e "$PORT" ]; then
    echo "No such port: $PORT" >&2
    echo "Plugged in? Try: ls /dev/ttyUSB* /dev/ttyACM*  and  dmesg | tail -20" >&2
    exit 1
fi

if [ ! -w "$PORT" ]; then
    echo "Cannot write to $PORT. Add yourself to the dialout group:" >&2
    echo "    sudo usermod -aG dialout \$USER     (then log out and back in)" >&2
    echo "or just run this with sudo." >&2
    exit 1
fi

echo "Port   $PORT at 115200 8N1"
stty -F "$PORT" 115200 cs8 -cstopb -parenb raw -echo -echoe -echok -crtscts min 0 time 10

# Hold the port open for the whole run. Without this the line settings are
# reset between the write and the read on some drivers, and nothing arrives.
exec 3<>"$PORT"
printf 'startlds$' >&3
echo "Woke the motor, capturing ${SECONDS_TO_RUN}s..."

timeout "$SECONDS_TO_RUN" cat <&3 > "$OUT" || true
exec 3<&-

SIZE=$(stat -c%s "$OUT")
echo "Wrote $OUT, $SIZE bytes"
echo
# 22 bytes a packet, 90 packets a revolution, about 5 revolutions a second:
# roughly 9900 bytes a second. Far short of that means it never spun up.
EXPECTED=$(( SECONDS_TO_RUN * 9900 ))
if [ "$SIZE" -lt $(( EXPECTED / 3 )) ]; then
    echo "That is well under the ~${EXPECTED} bytes expected." >&2
    echo "Either the motor did not start, or 5 V is not reaching it - the unit" >&2
    echo "draws 0.35 A and some USB serial adapters cannot supply that." >&2
else
    echo "Looks about right (~9900 bytes a second expected)."
fi
echo "Now check it:  ./lidar-check.py $OUT"
