#!/bin/bash
set -euo pipefail

# SignalRC Onboard: schreibt /etc/logrotate.d/signalrc für die Logs der
# systemd-Units (StandardOutput=append:...). Benutzt von install.sh und
# update.sh, als root.
#
# copytruncate, weil systemd die Datei offen hält und kein Signal zum
# Neu-Öffnen kennt; dank O_APPEND schreibt der Dienst nach dem Kürzen sauber
# am neuen Dateianfang weiter.
#
# Aufruf: onboard-write-logrotate.sh LOG_DIR

LOG_DIR="$1"

cat > /etc/logrotate.d/signalrc <<EOF2
$LOG_DIR/*.log $LOG_DIR/*.err {
    su root root
    daily
    maxsize 50M
    rotate 5
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
}
EOF2

echo "/etc/logrotate.d/signalrc geschrieben ($LOG_DIR, max. 50 MB je Datei, 5 Generationen)."
