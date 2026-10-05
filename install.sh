#!/bin/bash
set -e

# ── Guard: must run via sudo, not as direct root login ──────────────
if [ "$EUID" -ne 0 ]; then
    echo "Please run with sudo:  sudo bash install.sh"
    exit 1
fi

if [ -z "$SUDO_USER" ] || [ "$SUDO_USER" = "root" ]; then
    echo "Do not run this script as the root user directly."
    echo "Please run with sudo from a regular user account:  sudo bash install.sh"
    exit 1
fi

RUN_USER="$SUDO_USER"
RUN_USER_HOME=$(eval echo "~$RUN_USER")
REPO_URL="https://github.com/atomroflman/SignalRC.git"

# ── Package manager detection ────────────────────────────────────────
# PM is one of: apt-get, apt, pacman. Anything else aborts the installer.
PM=""
if command -v apt-get &>/dev/null; then
    PM="apt-get"
elif command -v apt &>/dev/null; then
    PM="apt"
elif command -v pacman &>/dev/null; then
    PM="pacman"
else
    echo "Error: no supported package manager found (apt, apt-get, pacman)."
    exit 1
fi

# Update is silent on pacman (it's always fresh) and loud on apt.
pkg_update() {
    case "$PM" in
        apt|apt-get) "$PM" update -y ;;
        pacman)      pacman -Sy --noconfirm ;;
    esac
}

# Default install aborts on missing package (keeps existing set -e behaviour).
pkg_install() {
    case "$PM" in
        apt|apt-get) "$PM" install -y "$@" ;;
        pacman)      pacman -S --noconfirm --needed "$@" ;;
    esac
}

# Try to install a single package; return 0 on success, 1 on failure.
# Used for optional packages (e.g. mediamtx) where a missing repo entry
# should fall back to an alternative install path instead of aborting.
pkg_install_optional() {
    case "$PM" in
        apt|apt-get) "$PM" install -y "$@" >/dev/null 2>&1 ;;
        pacman)      pacman -S --noconfirm --needed "$@" >/dev/null 2>&1 ;;
    esac
}

pkg_candidate_exists() {
    local package_name="$1"
    case "$PM" in
        apt|apt-get)
            local candidate
            candidate=$(apt-cache policy "$package_name" 2>/dev/null | awk '/Candidate:/ { print $2 }')
            [ -n "$candidate" ] && [ "$candidate" != "(none)" ]
            ;;
        pacman)
            pacman -Si "$package_name" >/dev/null 2>&1
            ;;
    esac
}

prompt_with_default() {
    local prompt_text="$1"
    local default_value="$2"
    local user_input

    if [ -n "$default_value" ]; then
        read -rp "$prompt_text [$default_value]: " user_input
        echo "${user_input:-$default_value}"
    else
        read -rp "$prompt_text: " user_input
        echo "$user_input"
    fi
}

normalize_boolean() {
    case "${1,,}" in
        1|true|yes|y|j|on) echo "true" ;;
        0|false|no|n|off) echo "false" ;;
        *) echo "$1" ;;
    esac
}

parse_server_url() {
    local raw_url="$1"
    local scheme="http"
    local host_and_path="$raw_url"
    local host_port

    if [[ "$raw_url" == https://* ]]; then
        scheme="https"
        host_and_path="${raw_url#https://}"
    elif [[ "$raw_url" == http://* ]]; then
        host_and_path="${raw_url#http://}"
    fi

    host_port="${host_and_path%%/*}"
    if [ -z "$host_port" ]; then
        return 1
    fi

    if [[ "$host_port" == *:* ]]; then
        LTECAR_SERVER_NAME="${host_port%%:*}"
        LTECAR_SERVER_PORT="${host_port##*:}"
    else
        LTECAR_SERVER_NAME="$host_port"
        LTECAR_SERVER_PORT=$([ "$scheme" = "https" ] && echo "443" || echo "80")
    fi

    LTECAR_USE_HTTPS=$([ "$scheme" = "https" ] && echo "true" || echo "false")
    return 0
}

prompt_onboard_server_settings() {
    local appsettings_path="$1"
    local current_server_name=""
    local current_server_port=""
    local current_use_https=""

    if [ -n "${LTECAR_SERVER_URL:-}" ]; then
        parse_server_url "$LTECAR_SERVER_URL" || true
    fi

    if [ -f "$appsettings_path" ] && command -v python3 &>/dev/null; then
        mapfile -t current_settings < <(python3 - "$appsettings_path" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    data = json.load(handle)

print(data.get("ServerName", ""))
print(data.get("ServerPort", ""))
print("true" if data.get("UseHttps", False) else "false")
PY
)
        current_server_name="${current_settings[0]}"
        current_server_port="${current_settings[1]}"
        current_use_https="${current_settings[2]}"
    fi

    local default_server_name="${LTECAR_SERVER_NAME:-$current_server_name}"
    local default_server_port="${LTECAR_SERVER_PORT:-$current_server_port}"
    local default_use_https
    default_use_https=$(normalize_boolean "${LTECAR_USE_HTTPS:-$current_use_https}")

    [ -n "$default_server_name" ] || default_server_name="localhost"
    if [ -z "$default_server_port" ]; then
        default_server_port=$([ "$default_use_https" = "true" ] && echo "443" || echo "5000")
    fi
    [ -n "$default_use_https" ] || default_use_https="false"

    local default_scheme="http"
    [ "$default_use_https" = "true" ] && default_scheme="https"

    echo ""
    echo "── Server connection defaults ────────────────────────"
    local server_url
    server_url=$(prompt_with_default "Server URL" "${default_scheme}://${default_server_name}:${default_server_port}")

    if ! parse_server_url "$server_url"; then
        echo "Invalid server URL: $server_url"
        exit 1
    fi
}

update_onboard_appsettings() {
    local appsettings_path="$1"

    if [ ! -f "$appsettings_path" ]; then
        echo "Warning: appSettings.json not found at $appsettings_path"
        return 0
    fi

    python3 - "$appsettings_path" "${LTECAR_SERVER_NAME:-}" "${LTECAR_SERVER_PORT:-}" "$(normalize_boolean "${LTECAR_USE_HTTPS:-false}")" "$(MEDIAMTX_DEST)" <<'PY'
import json
import sys

path, server_name, server_port, use_https, mtx_dest = sys.argv[1:6]

with open(path, encoding="utf-8") as handle:
    data = json.load(handle)

if server_name:
    data["ServerName"] = server_name
if server_port:
    data["ServerPort"] = int(server_port)
if mtx_dest:
    data["MediaMtxPath"] = mtx_dest
data["UseHttps"] = use_https == "true"

with open(path, "w", encoding="utf-8") as handle:
    json.dump(data, handle, indent=2)
    handle.write("\n")
PY

    echo "Applied server defaults to $appsettings_path"
}

# ── Helper: run a command as the real user ───────────────────────────
run_as_user() {
    sudo -H -u "$RUN_USER" --preserve-env=PATH "$@"
}

# ── Repository ───────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -d "$SCRIPT_DIR/.git" ]; then
    REPO_DIR="$SCRIPT_DIR"
    if [[ -n "$CURRENT_BRANCH" ]]; then
        git checkout "$CURRENT_BRANCH"
    fi
    CURRENT_BRANCH=$(git -C "$REPO_DIR" branch --show-current)
    echo "Repository found at $REPO_DIR (branch: $CURRENT_BRANCH)"
else
    echo "No repository found. Cloning SignalRC ..."
    pkg_install git

    REPO_DIR="$RUN_USER_HOME/SignalRC"

    if [[ -n $LTECAR_BRANCH ]]; then
        echo "Branch preselected: $LTECAR_BRANCH"
        BRANCH_CHOICE="$LTECAR_BRANCH"
        CURRENT_BRANCH=$BRANCH_CHOICE
        if [ -d "$REPO_DIR" ] && [ "$(ls -A "$REPO_DIR")" ]; then
            echo "Target directory $REPO_DIR already exists and is not empty. Skipping clone."
            cd "$REPO_DIR"
            run_as_user git checkout "$BRANCH_CHOICE"
            run_as_user git pull
        else 
            echo "git clone -b \"$BRANCH_CHOICE\" \"$REPO_URL\" \"$REPO_DIR\""
            run_as_user git clone -b "$BRANCH_CHOICE" "$REPO_URL" "$REPO_DIR"
        fi    
    else
        echo ""
        echo "Available branches:"
        mapfile -t BRANCHES < <(git ls-remote --heads "$REPO_URL" | sed 's|.*refs/heads/||' | sort)

        DEFAULT_IDX=1
        DEFAULT_BRANCH="${LTECAR_BRANCH:-}"
        for i in "${!BRANCHES[@]}"; do
            idx=$((i + 1))
            marker=""
            if [ -n "$DEFAULT_BRANCH" ] && [ "${BRANCHES[$i]}" = "$DEFAULT_BRANCH" ]; then
                DEFAULT_IDX=$idx
                marker=" (preselected)"
            elif [ -z "$DEFAULT_BRANCH" ] && [ "${BRANCHES[$i]}" = "master" ]; then
                DEFAULT_IDX=$idx
                marker=" (default)"
            fi
            echo "  $idx) ${BRANCHES[$i]}$marker"
        done

        echo ""
        BRANCH_PROMPT_DEFAULT="${DEFAULT_BRANCH:-$DEFAULT_IDX}"
        read -rp "Choose branch [${BRANCH_PROMPT_DEFAULT}]: " BRANCH_INPUT
        BRANCH_INPUT="${BRANCH_INPUT:-$BRANCH_PROMPT_DEFAULT}"

        if [[ "$BRANCH_INPUT" =~ ^[0-9]+$ ]] && [ "$BRANCH_INPUT" -ge 1 ] && [ "$BRANCH_INPUT" -le "${#BRANCHES[@]}" ]; then
            BRANCH_CHOICE="${BRANCHES[$((BRANCH_INPUT - 1))]}"
        else
            BRANCH_CHOICE="$BRANCH_INPUT"
        fi

        if [ -d "$REPO_DIR" ] && [ "$(ls -A "$REPO_DIR")" ]; then
            echo "Target directory $REPO_DIR already exists and is not empty. Skipping clone."
            CURRENT_BRANCH="$BRANCH_CHOICE"
            git checkout "$BRANCH_CHOICE"
        else
            run_as_user git clone -b "$BRANCH_CHOICE" "$REPO_URL" "$REPO_DIR"
            CURRENT_BRANCH="$BRANCH_CHOICE"
            echo "Cloned branch '$CURRENT_BRANCH' to $REPO_DIR"
        fi
    fi

    #if [ -n "${LTECAR_GIT_REF:-}" ]; then
    #    echo "Checking out preselected git ref: $LTECAR_GIT_REF"
    #    run_as_user git -C "$REPO_DIR" fetch --all --tags --prune
    #    run_as_user git -C "$REPO_DIR" checkout "$LTECAR_GIT_REF"
    #    CURRENT_BRANCH=$(git -C "$REPO_DIR" branch --show-current || echo "$LTECAR_GIT_REF")
    #fi
fi

echo ""
echo "============================================"
echo "  LteCar Installer"
echo "============================================"
echo "  User  : $RUN_USER"
echo "  Home  : $RUN_USER_HOME"
echo "  Repo  : $REPO_DIR"
echo "  Branch: $CURRENT_BRANCH"
echo "============================================"
echo ""

# ── Deployment mode selection ────────────────────────────────────────
DEFAULT_DEPLOY_MODE="${DEPLOY_MODE:-}"
case "$DEFAULT_DEPLOY_MODE" in
    server|Server) DEFAULT_DEPLOY_MODE="1" ;;
    onboard|Onboard) DEFAULT_DEPLOY_MODE="2" ;;
esac

if [[ -z "$DEPLOY_MODE" ]]; then
    echo "What do you want to install?"
    echo "  1) Server   (Compose stack: client + server + nginx + janus + postgres)"
    echo "  2) Onboard  (Bare metal: vehicle / car client for Raspberry Pi)"
    echo ""
    read -rp "Choose [1/2${DEFAULT_DEPLOY_MODE:+, default $DEFAULT_DEPLOY_MODE}]: " DEPLOY_MODE_INPUT
    DEPLOY_MODE="${DEPLOY_MODE_INPUT:-$DEFAULT_DEPLOY_MODE}"
fi

case "$DEPLOY_MODE" in
    1|server|Server) DEPLOY_MODE="server" ;;
    2|onboard|Onboard) DEPLOY_MODE="onboard" ;;
    *)
        echo "Invalid choice. Exiting."
        exit 1
        ;;
esac

echo ""

# =====================================================================
#  SERVER – Compose stack
# =====================================================================
if [ "$DEPLOY_MODE" = "server" ]; then

    # ── Container engine selection ───────────────────────────────────
    echo "Which container engine do you want to use?"
    echo "  1) Docker"
    echo "  2) Podman"
    echo ""
    read -rp "Choose [1/2]: " ENGINE_CHOICE

    case "$ENGINE_CHOICE" in
        1) COMPOSE_ENGINE="docker" ;;
        2) COMPOSE_ENGINE="podman" ;;
        *)
            echo "Invalid choice. Exiting."
            exit 1
            ;;
    esac

    # ── Compose stack selection ──────────────────────────────────────
    echo ""
    echo "Which compose stack do you want to deploy?"
    echo "  1) Full stack (client + server + nginx + janus + postgres)"
    echo "  2) Local debug support only (postgres + janus)"
    echo ""
    read -rp "Choose [1/2]: " STACK_CHOICE

    case "$STACK_CHOICE" in
        1) INSTALL_MODE="compose-full" ;;
        2) INSTALL_MODE="compose-debug" ;;
        *)
            echo "Invalid choice. Exiting."
            exit 1
            ;;
    esac

    echo ""
    echo ">> Engine : $COMPOSE_ENGINE"
    echo ">> Stack  : $INSTALL_MODE"
    echo ""

    # ── Phase 1: System packages ─────────────────────────────────────
    echo "── Phase 1: System packages ──────────────────────────"
    pkg_update
    pkg_install git curl

    if [ "$COMPOSE_ENGINE" = "docker" ]; then
        if ! command -v docker &>/dev/null; then
            echo "Installing Docker ..."
            pkg_install docker.io docker-compose-plugin
            usermod -aG docker "$RUN_USER"
            echo "User '$RUN_USER' added to the docker group."
        else
            echo "Docker already installed: $(docker --version)"
            if ! id -nG "$RUN_USER" | grep -qw docker; then
                usermod -aG docker "$RUN_USER"
                echo "User '$RUN_USER' added to the docker group."
            fi
        fi
        COMPOSE_CMD="docker compose"
        COMPOSE_PULL_ARGS=(--ignore-buildable)
    else
        if ! command -v podman &>/dev/null; then
            echo "Installing Podman ..."
            pkg_install podman podman-compose
        else
            echo "Podman already installed: $(podman --version)"
        fi
        COMPOSE_CMD="podman compose"
        COMPOSE_PULL_ARGS=()
    fi

    # ── Phase 2: Compose stack ───────────────────────────────────────
    echo ""
    echo "── Phase 2: Compose stack ────────────────────────────"

    if [ "$INSTALL_MODE" = "compose-full" ]; then
        COMPOSE_FILE="$REPO_DIR/docker-compose.yml"
    elif [ "$INSTALL_MODE" = "compose-debug" ]; then
        COMPOSE_FILE="$REPO_DIR/docker-compose.dev.yml"
    fi

    if [ ! -f "$COMPOSE_FILE" ]; then
        echo "Error: Compose file not found at $COMPOSE_FILE"
        exit 1
    fi

    echo "Compose file: $COMPOSE_FILE"
    echo "Pulling/building images ..."
    run_as_user $COMPOSE_CMD -f "$COMPOSE_FILE" pull "${COMPOSE_PULL_ARGS[@]}"
    run_as_user GIT_BRANCH=$(git -C "$REPO_DIR" rev-parse --abbrev-ref HEAD) \
        GIT_COMMIT=$(git -C "$REPO_DIR" rev-parse HEAD) \
        $COMPOSE_CMD -f "$COMPOSE_FILE" build

    # ── Phase 3: systemd service (optional) ─────────────────────────
    echo ""
    read -rp "Install as systemd autostart service? [y/N]: " INSTALL_SERVICES
    if [[ ! "${INSTALL_SERVICES,,}" =~ ^(y|j)$ ]]; then
        echo ""
        echo "Autostart skipped. Start the stack manually:"
        echo "  $COMPOSE_CMD -f $COMPOSE_FILE up -d"
        echo ""
        echo "============================================"
        echo "  Installation complete!"
        echo "============================================"
        exit 0
    fi

    echo ""
    echo "── Phase 3: systemd service ──────────────────────────"

    if [ "$COMPOSE_ENGINE" = "docker" ]; then
        ENGINE_BIN="/usr/bin/docker"
        AFTER_TARGET="docker.service"
        EXEC_START_PRE=""
    else
        ENGINE_BIN="/usr/bin/podman"
        AFTER_TARGET="podman.service"
        # Rootless podman-compose v1.0.6 can't `up -d` over existing stopped
        # containers without exiting non-zero. ExecStartPre brings back any
        # existing containers so `up -d` becomes a no-op on warm starts.
        # `|| true` so missing containers on a first-ever boot don't abort.
        # Wrapped in `/bin/sh -c` because systemd ExecStartPre does not invoke
        # a shell – `|| true` would otherwise be passed to podman as args.
        EXEC_START_PRE="ExecStartPre=/bin/sh -c '$ENGINE_BIN start ltecar_postgres_1 ltecar_janus_1 ltecar_server_1 ltecar_client_1 ltecar_nginx_1 || true'"
    fi

    cat > /etc/systemd/system/ltecar.service <<EOF
[Unit]
Description=LteCar compose stack
Wants=network-online.target
After=network-online.target $AFTER_TARGET
# Limit restart attempts to 5 in 10 minutes when ExecStart fails
# (e.g. transient podman/docker daemon hiccup on cold boot).
StartLimitIntervalSec=600
StartLimitBurst=5

[Service]
Type=oneshot
RemainAfterExit=yes
User=$RUN_USER
WorkingDirectory=$REPO_DIR
$EXEC_START_PRE
ExecStart=$ENGINE_BIN compose -f $COMPOSE_FILE up -d
ExecStop=$ENGINE_BIN compose -f $COMPOSE_FILE down
TimeoutStartSec=0
Restart=on-failure
RestartSec=30s

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable --now ltecar.service

    # Rootless podman kills its containers when the owning user's session
    # ends. Without linger the stack dies whenever greg-e (or whoever owns
    # the containers) logs out / the SSH session drops. Only relevant for
    # podman, but harmless to enable for docker users as well.
    if command -v loginctl &>/dev/null; then
        if ! loginctl show-user "$RUN_USER" 2>/dev/null | grep -q "Linger=yes"; then
            loginctl enable-linger "$RUN_USER"
            echo "Enabled systemd linger for user '$RUN_USER' (rootless podman survives logout)."
        else
            echo "systemd linger already enabled for user '$RUN_USER'."
        fi
    fi

    echo ""
    systemctl status ltecar.service --no-pager || true

    echo ""
    echo "============================================"
    echo "  Installation complete!"
    echo "============================================"
    echo "  Manage:  sudo systemctl {start|stop|restart|status} ltecar.service"
    echo "  Logs  :  $COMPOSE_CMD -f $COMPOSE_FILE logs -f"
    echo "============================================"
    exit 0
fi

# =====================================================================
#  ONBOARD – Bare metal (Raspberry Pi)
# =====================================================================
if [ "$DEPLOY_MODE" = "onboard" ]; then

    echo ">> Installing Onboard (bare metal) ..."
    echo ""

    # ── Phase 1: System packages ─────────────────────────────────────
    echo "── Phase 1: System packages ──────────────────────────"
    pkg_update

    base_packages=(git curl ffmpeg i2c-tools python3)
    camera_packages=()

    if pkg_candidate_exists rpicam-apps; then
        camera_packages+=(rpicam-apps)
    fi

    if pkg_candidate_exists libcamera-tools; then
        camera_packages+=(libcamera-tools)
    fi

    for libcamera_pkg in libcamera0 libcamera0.7 libcamera0.6 libcamera0.5 libcamera0.4 libcamera0.3; do
        if pkg_candidate_exists "$libcamera_pkg"; then
            camera_packages+=("$libcamera_pkg")
            break
        fi
    done

    if [ "${#camera_packages[@]}" -eq 0 ]; then
        echo "Warning: No libcamera runtime package found in apt. Continuing without it."
    fi

    pkg_install "${base_packages[@]}" "${camera_packages[@]}"

    # ── Phase 2: mediamtx ───────────────────────────────────────────
    echo ""
    echo "── Phase 2: mediamtx ─────────────────────────────────"

    MEDIAMTX_VERSION="v1.17.1"
    EXTERN_DIR="$REPO_DIR/Onboard/Extern"
    MEDIAMTX_DEST="$EXTERN_DIR/mediamtx"

    # Prefer the local package manager. If mediamtx isn't available in the
    # configured repos (common — Debian, Raspbian and most Arch setups don't
    # ship it), fall back to fetching the upstream tarball into the repo.
    echo "Trying local package manager ($PM) for mediamtx ..."
    if pkg_install_optional mediamtx; then
        echo "mediamtx installed via $PM (system-wide; the app will pick it up from PATH)."
    else
        echo "mediamtx not in configured $PM repos — falling back to GitHub tarball."

        ARCH=$(uname -m)
        case "$ARCH" in
            aarch64)        MEDIAMTX_ARCH="linux_arm64" ;;
            armv7l|armv7)   MEDIAMTX_ARCH="linux_armv7" ;;
            armv6l)         MEDIAMTX_ARCH="linux_armv6" ;;
            x86_64)         MEDIAMTX_ARCH="linux_amd64" ;;
            *)
                echo "Unsupported architecture: $ARCH"
                exit 1
                ;;
        esac

        MEDIAMTX_TARBALL="mediamtx_${MEDIAMTX_VERSION}_${MEDIAMTX_ARCH}.tar.gz"
        MEDIAMTX_URL="https://github.com/bluenviron/mediamtx/releases/download/${MEDIAMTX_VERSION}/${MEDIAMTX_TARBALL}"

        echo "Architecture : $ARCH -> $MEDIAMTX_ARCH"
        echo "Version      : $MEDIAMTX_VERSION"
        echo "Downloading  : $MEDIAMTX_URL"

        TMP_DIR=$(mktemp -d)
        curl -fsSL "$MEDIAMTX_URL" -o "$TMP_DIR/$MEDIAMTX_TARBALL"
        tar -xzf "$TMP_DIR/$MEDIAMTX_TARBALL" -C "$TMP_DIR" mediamtx
        install -m 755 "$TMP_DIR/mediamtx" "$MEDIAMTX_DEST"
        chown "$RUN_USER:$RUN_USER" "$MEDIAMTX_DEST"
        rm -rf "$TMP_DIR"

        echo "mediamtx installed to $MEDIAMTX_DEST"
    fi

    # ── Phase 3: .NET SDK ────────────────────────────────────────────
    echo ""
    echo "── Phase 3: .NET SDK ─────────────────────────────────"

    # Resolve DOTNET_ROOT for the user
    DOTNET_ROOT="$RUN_USER_HOME/.dotnet"

    if ! command -v "$DOTNET_ROOT" >/dev/null 2>&1; then
        echo "Installing dotnet SDK..."
        DOTNET_INSTALL_SCRIPT="/tmp/dotnet-install.sh"
        curl -fsSL https://dot.net/v1/dotnet-install.sh -o "$DOTNET_INSTALL_SCRIPT"
        chmod +x "$DOTNET_INSTALL_SCRIPT"
        run_as_user "$DOTNET_INSTALL_SCRIPT" --channel 10.0
        rm -f "$DOTNET_INSTALL_SCRIPT"
        echo "Installing dotnet SDK done."
    else
        echo "Dotnet is already installed. Skipping install."
    fi

    APPSETTINGS_PATH="$REPO_DIR/Onboard/appSettings.json"
    prompt_onboard_server_settings "$APPSETTINGS_PATH"
    update_onboard_appsettings "$APPSETTINGS_PATH"

    # ── Phase 4: Build ───────────────────────────────────────────────
    echo ""
    echo "── Phase 4: Build ────────────────────────────────────"
    export PATH="$DOTNET_ROOT:$DOTNET_ROOT/tools:$PATH"

    echo "Building .NET Onboard Client ..."
    echo "\"$DOTNET_ROOT/dotnet\" publish \"$REPO_DIR/Onboard/LteCar.Onboard.csproj\" -c Release"
    run_as_user "$DOTNET_ROOT/dotnet" publish "$REPO_DIR/Onboard/LteCar.Onboard.csproj" -c Release || true

    ONBOARD_DLL="$REPO_DIR/Onboard/bin/Release/net10.0/publish/LteCar.Onboard.dll"
    if [ ! -f "$ONBOARD_DLL" ]; then
        echo "Error: Onboard DLL not found at $ONBOARD_DLL. Build failed?"
        exit 1
    fi

    # ── Phase 5: systemd service (optional) ─────────────────────────
    echo ""
    read -rp "Install as systemd autostart service? [y/N]: " INSTALL_SERVICES
    if [[ ! "${INSTALL_SERVICES,,}" =~ ^(y|j)$ ]]; then
        echo ""
        echo "Autostart skipped. Start manually when you are ready:"
        echo "  cd $REPO_DIR/Onboard && $DOTNET_ROOT/dotnet $ONBOARD_DLL"
        echo ""
        echo "============================================"
        echo "  Installation complete!"
        echo "============================================"
        exit 0
    fi

    echo ""
    echo "── Phase 5: systemd service ──────────────────────────"

    LOG_DIR="/var/log/ltecar"
    mkdir -p "$LOG_DIR"
    chown "$RUN_USER:$RUN_USER" "$LOG_DIR"

    cat > /etc/systemd/system/ltecar-onboard.service <<EOF
[Unit]
Description=LteCar Onboard Client
After=network-online.target
Wants=network-online.target
# Endless retry: Onboard must always come back, even after a hard crash.
StartLimitIntervalSec=infinity

[Service]
Type=simple
ExecStart=$DOTNET_ROOT/dotnet $ONBOARD_DLL
Restart=always
RestartSec=5
User=$RUN_USER
WorkingDirectory=$REPO_DIR/Onboard
Environment=DOTNET_ROOT=$DOTNET_ROOT
Environment=DOTNET_ENVIRONMENT=Production
Environment=PATH=$DOTNET_ROOT:$DOTNET_ROOT/tools:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
StandardOutput=append:$LOG_DIR/onboard.log
StandardError=append:$LOG_DIR/onboard.err

[Install]
WantedBy=multi-user.target
EOF

   cat > /etc/systemd/system/ltecar-mediamtx.service <<EOF
[Unit]
Description=LteCar mediamtx
After=ltecar-onboard.service
Wants=ltecar-onboard.service
# Endless retry: Onboard must always come back, even after a hard crash.
StartLimitIntervalSec=infinity

[Service]
Type=simple
ExecStart=$REPO_DIR/Onboard/Extern/mediamtx
Restart=always
RestartSec=5
User=$RUN_USER
WorkingDirectory=$REPO_DIR/Onboard/Extern
Environment=PATH=$DOTNET_ROOT:$DOTNET_ROOT/tools:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
StandardOutput=append:$LOG_DIR/mediamtx.log
StandardError=append:$LOG_DIR/mediamtx.err

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable ltecar-onboard.service
    systemctl enable ltecar-mediamtx.service

    echo ""
    echo "Service installed and enabled for future boots."
    echo "It was not started automatically."

    echo ""
    echo "============================================"
    echo "  Installation complete!"
    echo "============================================"
    echo "  Start :  sudo systemctl start ltecar-onboard.service"
    echo "  Logs  :  $LOG_DIR/onboard.log"
    echo "  Manage:  sudo systemctl {start|stop|restart|status} ltecar-onboard.service"
    echo "============================================"
    exit 0
fi

# end