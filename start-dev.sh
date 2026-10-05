#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if command -v podman >/dev/null 2>&1; then
  podman compose -f docker-compose.yml -f docker-compose.dev.yml up postgres janus
  exit 0
fi

if command -v docker >/dev/null 2>&1; then
  docker compose -f docker-compose.yml -f docker-compose.dev.yml up postgres janus
  exit 0
fi

echo "Neither docker nor podman is available." >&2
exit 1