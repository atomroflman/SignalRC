#!/bin/bash
# SignalRC Onboard: Rollback-Wächter, läuft als ExecStartPre vor jedem Start von
# signalrc-onboard.service (siehe Docs/OnboardAutoUpdate.md).
#
# Steht in Onboard/releases/.state/pending ein unbestätigtes Release, zählt das
# Skript die Starts mit. Bestätigt das Onboard das Release nicht (erster
# erfolgreicher Server-Handshake), schaltet es nach MAX_ATTEMPTS Starts
# Onboard/current auf das vorherige Release zurück, sperrt den Commit und
# hinterlegt ihn in last-rollback, damit das Onboard den Rollback meldet.
#
# Aufruf: onboard-prestart.sh [ONBOARD_DIR]
#   ONBOARD_DIR  Standard: ../Onboard relativ zu diesem Skript
#
# Beendet sich immer mit 0: Ein Fehler in ExecStartPre würde den Start verhindern.

MAX_ATTEMPTS="${SIGNALRC_MAX_START_ATTEMPTS:-3}"
ENTRY_ASSEMBLY="SignalRC.Onboard.dll"

log() {
    echo "[onboard-prestart] $*"
}

main() {
    local onboard_dir="$1"
    local state_dir="$onboard_dir/releases/.state"
    local pending="$state_dir/pending"

    [ -f "$pending" ] || return 0

    local key value commit="" previous="" attempts=0
    while IFS='=' read -r key value; do
        case "$key" in
            commit)   commit="$value" ;;
            previous) previous="$value" ;;
            attempts) attempts="$value" ;;
        esac
    done < "$pending"

    if [ -z "$commit" ]; then
        log "pending ohne Commit, wird verworfen."
        rm -f "$pending"
        return 0
    fi
    [[ "$attempts" =~ ^[0-9]+$ ]] || attempts=0
    attempts=$((attempts + 1))

    if [ "$attempts" -le "$MAX_ATTEMPTS" ]; then
        printf 'commit=%s\nprevious=%s\nattempts=%s\n' "$commit" "$previous" "$attempts" > "$pending.new" \
            && mv -f "$pending.new" "$pending"
        log "Start $attempts/$MAX_ATTEMPTS des unbestätigten Releases $commit."
        return 0
    fi

    if [ -z "$previous" ] || [ ! -f "$onboard_dir/releases/$previous/$ENTRY_ASSEMBLY" ]; then
        log "Release $commit kam nach $MAX_ATTEMPTS Starts nicht hoch, aber kein vorheriges Release ist vorhanden (previous='$previous'). Es läuft weiter."
        rm -f "$pending"
        return 0
    fi

    ln -sfn "releases/$previous" "$onboard_dir/current.new" \
        && mv -Tf "$onboard_dir/current.new" "$onboard_dir/current" \
        || { log "Rollback auf $previous fehlgeschlagen."; return 0; }
    echo "$commit" >> "$state_dir/blocked"
    echo "$commit" > "$state_dir/last-rollback"
    rm -f "$pending"
    log "Release $commit kam nach $MAX_ATTEMPTS Starts nicht hoch: zurück auf $previous, $commit gesperrt."
}

ONBOARD_DIR="${1:-$(cd "$(dirname "$0")/../Onboard" 2>/dev/null && pwd)}"
if [ -z "$ONBOARD_DIR" ] || [ ! -d "$ONBOARD_DIR" ]; then
    log "Onboard-Verzeichnis nicht gefunden ('$ONBOARD_DIR')."
    exit 0
fi
main "$ONBOARD_DIR" || true
exit 0
