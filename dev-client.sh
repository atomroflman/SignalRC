#!/bin/bash
# Startet einen Dev-Container für den Next.js-Client, der die Source per
# bind-mount vom Host holt. Hot-Reload funktioniert ohne Container-Build.
# Voraussetzung: source unter ~/LteCar/Client ist via git pull aktuell.
set -euo pipefail

cd ~/LteCar

echo "[dev-client] stoppe abhängige container (nginx) ..."
podman stop ltecar_nginx_1 2>/dev/null || true
for i in $(seq 1 15); do
  if ! podman inspect ltecar_nginx_1 >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
podman rm -f ltecar_nginx_1 2>/dev/null || true

echo "[dev-client] stoppe alten prod-client ..."
podman stop ltecar_client_1 2>/dev/null || true
for i in $(seq 1 15); do
  if ! podman inspect ltecar_client_1 >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
podman rm -f ltecar_client_1 2>/dev/null || true

echo "[dev-client] starte dev-container (node:22-alpine, npm run dev) ..."
podman run --name ltecar_client_1 \
  --network ltecar_default \
  --network-alias client \
  -p 3000:3000 \
  -v "$HOME/LteCar/Client":/app:Z \
  -v ltecar_client_nm:/app/node_modules \
  --env NODE_ENV=development \
  --env PORT=3000 \
  --env HOSTNAME=0.0.0.0 \
  --restart unless-stopped \
  -d docker.io/library/node:22-alpine \
  sh -c "cd /app && (test -d node_modules || npm ci) && npm run dev"

echo "[dev-client] warte auf dev-server ..."
for i in $(seq 1 30); do
  if curl -fsS -o /dev/null http://localhost:3000/ 2>/dev/null; then
    echo "[dev-client] bereit nach ${i}s auf http://localhost:3000/"
    break
  fi
  sleep 1
done

echo "[dev-client] starte nginx wieder hoch ..."
podman compose up -d nginx 2>&1 | tail -3

echo "[dev-client] healthcheck nginx ..."
for i in $(seq 1 15); do
  if curl -fsS -o /dev/null http://localhost:8080/ 2>/dev/null; then
    echo "[dev-client] nginx bereit nach ${i}s auf http://localhost:8080/"
    exit 0
  fi
  sleep 1
done

echo "[dev-client] nginx nicht bereit, logs:"
podman logs --tail=20 ltecar_nginx_1
exit 1
