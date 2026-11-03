#!/bin/bash
set -euo pipefail

# SignalRC Onboard: schreibt signalrc-onboard.service für das Release-Layout
# (ExecStart über Onboard/current, Rollback-Wächter als ExecStartPre, siehe
# Docs/OnboardAutoUpdate.md). Benutzt von install.sh und update.sh, als root.
#
# Aufruf: onboard-write-service.sh REPO_DIR DOTNET_ROOT RUN_USER LOG_DIR

REPO_DIR="$1"
DOTNET_ROOT="$2"
RUN_USER="$3"
LOG_DIR="$4"

cat > /etc/systemd/system/signalrc-onboard.service <<EOF
[Unit]
Description=SignalRC Onboard Client
After=network-online.target
Wants=network-online.target
# Endless retry: Onboard must always come back, even after a hard crash.
StartLimitIntervalSec=infinity

[Service]
Type=simple
# Counts starts of an unconfirmed self-update and rolls back after 3; always exits 0.
ExecStartPre=/bin/bash $REPO_DIR/scripts/onboard-prestart.sh $REPO_DIR/Onboard
ExecStart=$DOTNET_ROOT/dotnet $REPO_DIR/Onboard/current/SignalRC.Onboard.dll
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

echo "signalrc-onboard.service geschrieben (Release-Layout)."
