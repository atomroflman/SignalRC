#!/usr/bin/env bash
# Overlay check (AP14): type check, Vitest, builds and xUnit in one run.
#
#   scripts/overlay-check.sh [--start-server] [--perf]
#
# Optional environment (never commit credentials):
#   SIGNALRC_TEST_POSTGRES  connection string of a migrated test database;
#                           enables the Postgres variants of the xUnit tests.
#   SIGNALRC_LIVE_URL       URL of a running server on that database; together
#                           with SIGNALRC_TEST_POSTGRES the opt-in live tests
#                           (*live*.test.ts) run, otherwise they are skipped.
#   SIGNALRC_PERF=1         long performance runs (10 min simulated); same as --perf.
#
# --start-server starts the freshly built server on a free local port against
# SIGNALRC_TEST_POSTGRES (only when SIGNALRC_LIVE_URL is not set), runs the
# live tests against it and stops it afterwards. The server applies pending
# migrations on start – use a test database only.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$PWD
START_SERVER=0
for arg in "$@"; do
  case "$arg" in
    --start-server) START_SERVER=1 ;;
    --perf) export SIGNALRC_PERF=1 ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

SERVER_PID=""
LOG_DIR=$(mktemp -d)
cleanup() {
  if [[ -n "$SERVER_PID" ]]; then kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true; fi
  rm -rf "$LOG_DIR"
}
trap cleanup EXIT

declare -a RESULTS=()
step() {
  local name=$1; shift
  echo "==> $name"
  if "$@"; then RESULTS+=("ok    $name"); else RESULTS+=("FAIL  $name"); FAILED=1; fi
}
FAILED=0

if [[ ! -x Client/node_modules/.bin/tsc ]]; then
  echo "Client/node_modules fehlt (npm ci in Client/ ausführen)." >&2
  exit 1
fi

step "Client: tsc" Client/node_modules/.bin/tsc --noEmit -p Client/tsconfig.json
step "Server: build" dotnet build Server/SignalRC.Server.csproj -c Release --nologo -v q
step "Onboard: build" dotnet build Onboard/SignalRC.Onboard.csproj -c Release --nologo -v q
step "Tests: dotnet test" dotnet test Tests/SignalRC.Overlay.Tests -c Release --nologo -v q

if [[ $START_SERVER == 1 && -z "${SIGNALRC_LIVE_URL:-}" ]]; then
  if [[ -z "${SIGNALRC_TEST_POSTGRES:-}" ]]; then
    echo "--start-server braucht SIGNALRC_TEST_POSTGRES." >&2
    exit 2
  fi
  PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')
  BIN="$ROOT/Server/bin/Release/net10.0"
  echo "==> Server starten auf 127.0.0.1:$PORT (Log: $LOG_DIR/server.log)"
  (cd "$BIN" && ConnectionStrings__DefaultConnection="$SIGNALRC_TEST_POSTGRES" \
     exec dotnet SignalRC.Server.dll --urls "http://127.0.0.1:$PORT") >"$LOG_DIR/server.log" 2>&1 &
  SERVER_PID=$!
  export SIGNALRC_LIVE_URL="http://127.0.0.1:$PORT"
  for _ in $(seq 1 120); do
    # Any HTTP answer (also 404 for the unknown vehicle 0) means the server is up.
    code=$(curl -s -o /dev/null -w '%{http_code}' "$SIGNALRC_LIVE_URL/api/cars/0/overlay/sources" 2>/dev/null || true)
    [[ "$code" != "000" && -n "$code" ]] && break
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then cat "$LOG_DIR/server.log" >&2; echo "Server beendet sich beim Start." >&2; exit 1; fi
    sleep 0.5
  done
fi

if [[ -n "${SIGNALRC_LIVE_URL:-}" && -n "${SIGNALRC_TEST_POSTGRES:-}" ]]; then
  echo "    Live-Tests aktiv gegen $SIGNALRC_LIVE_URL"
else
  echo "    Live-Tests übersprungen (SIGNALRC_LIVE_URL und SIGNALRC_TEST_POSTGRES nicht beide gesetzt)"
fi
step "Client: vitest" bash -c 'cd Client && node_modules/.bin/vitest run'

echo
printf '%s\n' "${RESULTS[@]}"
exit $FAILED
