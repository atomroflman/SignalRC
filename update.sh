#!/bin/bash
set -euo pipefail

# SignalRC Update-Skript
# Erkennt automatisch, ob auf diesem Host der Server-Compose-Stack oder der
# Onboard-Vehicle-Client installiert ist, stoppt den Service, aktualisiert das
# Repo, baut neu und startet wieder.
#
# Aufruf:
#   sudo ./update.sh
#
# Unterstützte Installationen (von install.sh angelegt):
#   - /etc/systemd/system/signalrc.service        -> Server (Docker/Podman Compose)
#   - /etc/systemd/system/ltecar.service          -> Server, ältere Installation
#   - /etc/systemd/system/signalrc-onboard.service -> Onboard (Vehicle Client)

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
SERVER_SERVICE="/etc/systemd/system/signalrc.service"
ONBOARD_SERVICE="/etc/systemd/system/signalrc-onboard.service"

if [ ! -f "$SERVER_SERVICE" ] && [ -f /etc/systemd/system/ltecar.service ]; then
    SERVER_SERVICE="/etc/systemd/system/ltecar.service"
fi

if [ -f "$SERVER_SERVICE" ]; then
    DEPLOY_TYPE="server"
    SERVICE_NAME="$(basename "$SERVER_SERVICE")"
elif [ -f "$ONBOARD_SERVICE" ]; then
    DEPLOY_TYPE="onboard"
    SERVICE_NAME="signalrc-onboard.service"
else
    echo "Fehler: Kein bekannter SignalRC-Service gefunden."
    echo "Erwartet: $SERVER_SERVICE  oder  $ONBOARD_SERVICE"
    exit 1
fi

echo "============================================"
echo "  SignalRC Update"
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

    # Release-Layout (Docs/OnboardAutoUpdate.md): baut nach Onboard/releases/<commit>/
    # und setzt Onboard/current um. Der laufende Dienst behält seine Dateien.
    run_as_user \
        DOTNET_ROOT="$(dirname "$DOTNET_BIN")" \
        PATH="$(dirname "$DOTNET_BIN"):$(dirname "$DOTNET_BIN")/tools:$PATH" \
        bash "$SCRIPT_DIR/scripts/onboard-publish-release.sh" "$SCRIPT_DIR" "$DOTNET_BIN"

    # Migration: Eine Unit aus der Zeit vor dem Release-Layout startet noch
    # bin/Release/.../publish und kennt den Rollback-Wächter nicht.
    if ! grep -q '^ExecStart=.*/Onboard/current/SignalRC.Onboard.dll' "$ONBOARD_SERVICE" \
        || ! grep -q '^ExecStartPre=.*onboard-prestart.sh' "$ONBOARD_SERVICE"; then
        echo "Migriere $ONBOARD_SERVICE auf das Release-Layout ..."
        LOG_DIR="$(grep -oP '^StandardOutput=append:\K.*(?=/onboard.log)' "$ONBOARD_SERVICE" | head -1 || true)"
        [ -n "$LOG_DIR" ] || LOG_DIR="/var/log/signalrc"
        cp "$ONBOARD_SERVICE" "$ONBOARD_SERVICE.bak"
        bash "$SCRIPT_DIR/scripts/onboard-write-service.sh" "$SCRIPT_DIR" "$(dirname "$DOTNET_BIN")" "$RUN_USER" "$LOG_DIR"
        systemctl daemon-reload
        echo "Alte Unit gesichert unter $ONBOARD_SERVICE.bak"
    fi

    # Logrotate für die append:-Logs der Units, auch auf älteren Installationen.
    LOG_DIR="$(grep -oP '^StandardOutput=append:\K.*(?=/onboard.log)' "$ONBOARD_SERVICE" | head -1 || true)"
    [ -n "$LOG_DIR" ] || LOG_DIR="/var/log/signalrc"
    bash "$SCRIPT_DIR/scripts/onboard-write-logrotate.sh" "$LOG_DIR"

    # Migration: StartLimitIntervalSec=infinity lässt das Zählfenster nie
    # ablaufen, nach 5 Starts blieb die Unit in start-limit-hit hängen.
    # 0 schaltet die Begrenzung wirklich ab.
    UNITS_FIXED=""
    for UNIT_FILE in "$ONBOARD_SERVICE" /etc/systemd/system/signalrc-mediamtx.service; do
        if [ -f "$UNIT_FILE" ] && grep -q '^StartLimitIntervalSec=infinity' "$UNIT_FILE"; then
            sed -i 's/^StartLimitIntervalSec=infinity$/StartLimitIntervalSec=0/' "$UNIT_FILE"
            echo "StartLimitIntervalSec=0 gesetzt in $UNIT_FILE"
            UNITS_FIXED="yes"
        fi
    done
    if [ -n "$UNITS_FIXED" ]; then
        systemctl daemon-reload
    fi
    systemctl reset-failed signalrc-onboard.service signalrc-mediamtx.service 2>/dev/null || true
fi

# ── 3. Service stoppen ───────────────────────────────────────────────
echo "[3/4] Service stoppen: $SERVICE_NAME ..."
systemctl stop "$SERVICE_NAME"

# ── 4. Service starten ───────────────────────────────────────────────
echo "[4/4] Service starten: $SERVICE_NAME ..."
systemctl start "$SERVICE_NAME"

systemctl status "$SERVICE_NAME" --no-pager || true

# Jeder Build hinterlässt namenlose Images; ohne Aufräumen läuft die Platte voll.
# Getaggte Images und Volumes bleiben. Ein Fehler hier macht das Update nicht ungültig.
if [ "$DEPLOY_TYPE" = "server" ]; then
    echo "Alte Build-Images entfernen ..."
    run_as_user "${COMPOSE_CMD%% *}" image prune -f >/dev/null \
        || echo "Warnung: Build-Images konnten nicht entfernt werden."
fi

echo ""
echo "============================================"
echo "  Update abgeschlossen"
echo "============================================"
