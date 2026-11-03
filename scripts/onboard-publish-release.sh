#!/bin/bash
set -euo pipefail

# SignalRC Onboard: baut den aktuellen Checkout als Release nach
# Onboard/releases/<commit12>/ und setzt Onboard/current darauf
# (siehe Docs/OnboardAutoUpdate.md). Benutzt von install.sh und update.sh,
# läuft als Service-User, nicht als root.
#
# Aufruf: onboard-publish-release.sh REPO_DIR DOTNET_BIN
#
# Ein manueller Rollout gilt sofort als bestätigt: Ein noch offenes pending
# eines Auto-Updates wird verworfen, sonst würde der Rollback-Wächter die
# Starts des falschen Releases zählen.

REPO_DIR="$1"
DOTNET_BIN="$2"
KEEP_PREVIOUS=3

ONBOARD_DIR="$REPO_DIR/Onboard"
RELEASES_DIR="$ONBOARD_DIR/releases"
ENTRY_ASSEMBLY="SignalRC.Onboard.dll"

GIT_COMMIT="$(git -C "$REPO_DIR" rev-parse HEAD)"
GIT_BRANCH="$(git -C "$REPO_DIR" branch --show-current)"
# Wie scripts/build-images.sh, damit Server und Onboard denselben Namen melden.
[ -n "$GIT_BRANCH" ] || GIT_BRANCH="detached"
RELEASE="${GIT_COMMIT:0:12}"
TARGET="$RELEASES_DIR/$RELEASE"

mkdir -p "$RELEASES_DIR/.state"

current_release() {
    local target
    target="$(readlink "$ONBOARD_DIR/current" 2>/dev/null || true)"
    [ -n "$target" ] && basename "$target"
}

if [ -f "$TARGET/$ENTRY_ASSEMBLY" ]; then
    # Nie in ein bestehendes Release schreiben: Es kann das laufende sein.
    echo "Release $RELEASE ist bereits installiert, wird nicht neu gebaut."
else
    echo "Baue Onboard-Release $RELEASE ($GIT_BRANCH) ..."
    rm -rf "$TARGET.tmp"
    # --use-current-runtime: nur die nativen Bibliotheken dieser Architektur
    # (sonst ~30 MB für alle Plattformen pro Release auf der SD-Karte).
    "$DOTNET_BIN" publish "$ONBOARD_DIR/SignalRC.Onboard.csproj" -c Release \
        -o "$TARGET.tmp" \
        --use-current-runtime --self-contained false \
        -p:UseAppHost=false \
        -p:BuildInfoBranch="$GIT_BRANCH" \
        -p:BuildInfoCommit="$GIT_COMMIT"
    if [ ! -f "$TARGET.tmp/$ENTRY_ASSEMBLY" ]; then
        echo "Fehler: $ENTRY_ASSEMBLY fehlt im Build-Ergebnis."
        rm -rf "$TARGET.tmp"
        exit 1
    fi
    mv "$TARGET.tmp" "$TARGET"
    touch "$TARGET"
fi

rm -f "$RELEASES_DIR/.state/pending"

# Atomar umschalten: current ist nie weg, auch wenn der Dienst gerade läuft.
ln -sfn "releases/$RELEASE" "$ONBOARD_DIR/current.new"
mv -Tf "$ONBOARD_DIR/current.new" "$ONBOARD_DIR/current"
echo "Onboard/current -> releases/$RELEASE"

# Aufräumen: aktuelles + KEEP_PREVIOUS vorherige (nach Installationszeit).
kept=0
while IFS= read -r dir; do
    name="$(basename "$dir")"
    [ "$name" = "$RELEASE" ] && continue
    if [ "$kept" -lt "$KEEP_PREVIOUS" ]; then
        kept=$((kept + 1))
        continue
    fi
    echo "Entferne altes Release $name"
    rm -rf "$dir"
done < <(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d ! -name '.*' ! -name '*.tmp' -printf '%T@ %p\n' | sort -rn | cut -d' ' -f2-)
