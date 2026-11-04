#!/bin/bash
# Tests für scripts/onboard-prestart.sh in einem temporären Verzeichnis.
# Aufruf: scripts/test-onboard-prestart.sh
set -u

SCRIPT="$(cd "$(dirname "$0")" && pwd)/onboard-prestart.sh"
FAILED=0
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*"; FAILED=1; }
pass() { echo "ok:   $*"; }

setup() {
    rm -rf "$TMP/Onboard"
    mkdir -p "$TMP/Onboard/releases/.state" "$TMP/Onboard/releases/old111111111" "$TMP/Onboard/releases/new222222222"
    touch "$TMP/Onboard/releases/old111111111/SignalRC.Onboard.dll" "$TMP/Onboard/releases/new222222222/SignalRC.Onboard.dll"
    ln -sfn releases/new222222222 "$TMP/Onboard/current"
}

write_pending() {
    printf 'commit=%s\nprevious=%s\nattempts=%s\n' "$1" "$2" "$3" > "$TMP/Onboard/releases/.state/pending"
}

run() {
    bash "$SCRIPT" "$TMP/Onboard" > /dev/null
    echo $?
}

current() { readlink "$TMP/Onboard/current"; }

# Ohne pending passiert nichts.
setup
[ "$(run)" = 0 ] && [ "$(current)" = releases/new222222222 ] && pass "ohne pending unverändert" || fail "ohne pending"

# Starts 1 bis 3 zählen hoch, ohne zurückzurollen.
setup
write_pending new222222222 old111111111 0
for i in 1 2 3; do
    code="$(run)"
    grep -q "attempts=$i" "$TMP/Onboard/releases/.state/pending" && [ "$code" = 0 ] && [ "$(current)" = releases/new222222222 ] \
        && pass "Start $i gezählt" || fail "Start $i"
done

# Der 4. Start rollt zurück und sperrt.
code="$(run)"
[ "$code" = 0 ] && [ "$(current)" = releases/old111111111 ] && pass "4. Start rollt zurück" || fail "Rollback ($(current))"
[ ! -f "$TMP/Onboard/releases/.state/pending" ] && pass "pending entfernt" || fail "pending noch da"
grep -qx new222222222 "$TMP/Onboard/releases/.state/blocked" && pass "Commit gesperrt" || fail "blocked"
grep -qx new222222222 "$TMP/Onboard/releases/.state/last-rollback" && pass "last-rollback geschrieben" || fail "last-rollback"
[ -L "$TMP/Onboard/current" ] && pass "current bleibt ein Symlink" || fail "current kein Symlink"

# Ohne vorheriges Release kein Rollback, aber auch keine Endlosschleife.
setup
write_pending new222222222 "" 3
[ "$(run)" = 0 ] && [ "$(current)" = releases/new222222222 ] && [ ! -f "$TMP/Onboard/releases/.state/pending" ] \
    && pass "ohne previous kein Rollback, pending entfernt" || fail "ohne previous"

# Kaputte Datei und fehlendes Verzeichnis enden mit 0.
setup
echo "unsinn" > "$TMP/Onboard/releases/.state/pending"
[ "$(run)" = 0 ] && [ ! -f "$TMP/Onboard/releases/.state/pending" ] && pass "kaputtes pending verworfen" || fail "kaputtes pending"
bash "$SCRIPT" "$TMP/gibtesnicht" > /dev/null; [ $? = 0 ] && pass "fehlendes Verzeichnis Exit 0" || fail "fehlendes Verzeichnis"

exit $FAILED
