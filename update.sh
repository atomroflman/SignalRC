#!/bin/bash
set -euo pipefail

# LteCar Update-Skript
# Erkennt automatisch, ob auf diesem Host der Server-Compose-Stack oder der
# Onboard-Vehicle-Client installiert ist, stoppt den Service, aktualisiert das
# Repo, baut neu und startet wieder.
#
# Aufruf:
#   sudo ./update.sh
#
# Unterstützte Installationen (von install.sh angelegt):
#   - /etc/systemd/system/ltecar.service        -> Server (Docker/Podman Compose)
#   - /etc/systemd/system/ltecar-onboard.service -> Onboard (Vehicle Client)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ "$EUID" -ne 0 ]; then
    echo "Bitte mit sudo ausführen:  sudo ./update.sh"
    exit 1
fi

if [ -z "${SUDO_USER:-}" ] || [ "$SUDO_USER" = "root" ]; then
    echo "Nicht als root direkt ausführen."
    echo "Bitte mit sudo von einem normalen Benutzer ausführen:  sudo ./update.sh"
    exit 1
fi

RUN_USER="$SUDO_USER"
RUN_USER_HOME="$(eval echo "~$RUN_USER")"

run_as_user() {
    sudo -H -u "$RUN_USER" --preserve-env=PATH "$@"
}

# ── Deployment erkennen ──────────────────────────────────────────────
SERVER_SERVICE="/etc/systemd/system/ltecar.service"
ONBOARD_SERVICE="/etc/systemd/system/ltecar-onboard.service"

if [ -f "$SERVER_SERVICE" ]; then
    DEPLOY_TYPE="server"
    SERVICE_NAME="ltecar.service"
elif [ -f "$ONBOARD_SERVICE" ]; then
    DEPLOY_TYPE="onboard"
    SERVICE_NAME="ltecar-onboard.service"
else
    echo "Fehler: Kein bekannter LteCar-Service gefunden."
    echo "Erwartet: $SERVER_SERVICE  oder  $ONBOARD_SERVICE"
    exit 1
fi

echo "============================================"
echo "  LteCar Update"
echo "============================================"
echo "  Typ : $DEPLOY_TYPE"
echo "  User: $RUN_USER"
echo "  Repo: $SCRIPT_DIR"
echo "============================================"
echo ""

# ── 1. Git update ────────────────────────────────────────────────────
echo "[1/4] Git-Update ..."
cd "$SCRIPT_DIR"
run_as_user git pull

# ── 2. Bauen (vor dem Stoppen, damit bei Build-Fehlern der Service läuft) ──
if [ "$DEPLOY_TYPE" = "server" ]; then
    echo "[2/4] Server-Images bauen ..."

    # Engine und Compose-File aus dem systemd-Service auslesen
    COMPOSE_FILE="$(grep -oP '^ExecStart=\S+\s+compose\s+-f\s+\K\S+' "$SERVER_SERVICE" | head -1 || echo "docker-compose.yml")"
    if grep -qE '^ExecStart=.*podman' "$SERVER_SERVICE"; then
        COMPOSE_CMD="podman compose"
    else
        COMPOSE_CMD="docker compose"
    fi

    if ! command -v ${COMPOSE_CMD%% *} &>/dev/null; then
        echo "Fehler: '${COMPOSE_CMD%% *}' nicht gefunden."
        exit 1
    fi

    GIT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
    GIT_COMMIT="$(git rev-parse HEAD)"

    run_as_user \
        GIT_BRANCH="$GIT_BRANCH" \
        GIT_COMMIT="$GIT_COMMIT" \
        $COMPOSE_CMD -f "$COMPOSE_FILE" build

elif [ "$DEPLOY_TYPE" = "onboard" ]; then
    echo "[2/4] Onboard bauen ..."

    # .NET-Pfad aus dem Service auslesen (z. B. /home/pi/.dotnet/dotnet)
    DOTNET_BIN="$(grep -oP '^ExecStart=\K\S+' "$ONBOARD_SERVICE" | head -1 | awk '{print $1}')"
    if [ -z "$DOTNET_BIN" ] || [ ! -f "$DOTNET_BIN" ]; then
        DOTNET_BIN="$RUN_USER_HOME/.dotnet/dotnet"
    fi
    if [ ! -f "$DOTNET_BIN" ]; then
        echo "Fehler: dotnet nicht gefunden unter $DOTNET_BIN"
        exit 1
    fi

    run_as_user \
        DOTNET_ROOT="$(dirname "$DOTNET_BIN")" \
        PATH="$(dirname "$DOTNET_BIN"):$(dirname "$DOTNET_BIN")/tools:$PATH" \
        "$DOTNET_BIN" publish "$SCRIPT_DIR/Onboard/LteCar.Onboard.csproj" -c Release
fi

# ── 3. Service stoppen ───────────────────────────────────────────────
echo "[3/4] Service stoppen: $SERVICE_NAME ..."
systemctl stop "$SERVICE_NAME"

# ── 4. Service starten ───────────────────────────────────────────────
echo "[4/4] Service starten: $SERVICE_NAME ..."
systemctl start "$SERVICE_NAME"

systemctl status "$SERVICE_NAME" --no-pager || true

echo ""
echo "============================================"
echo "  Update abgeschlossen"
echo "============================================"
