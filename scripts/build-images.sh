#!/bin/bash
set -euo pipefail

# SignalRC: baut die Docker-Images für Server und Web-Client mit dem echten
# Commit und Branch und pusht sie in die Registry.
#
# Aufruf:
#   scripts/build-images.sh [server|client|all] [--load]
#     server|client|all  welches Image (Standard: all)
#     --load             nur lokal bauen (docker load), nicht pushen
#
# Konfiguration (Umgebung oder scripts/build-images.env, gitignored):
#   REGISTRY  Pflicht, z. B. host/pfad. Steht bewusst nirgends im Repo.
#   TAG       optional, Standard: latest
#
# Der Commit ist die Versions-ID für das Onboard-Auto-Update
# (Docs/OnboardAutoUpdate.md). Uncommittete Änderungen werden mitgebaut,
# aber gemeldet, weil das Image dann mehr enthält, als sein Commit sagt.

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$REPO_DIR/scripts/build-images.env"
cd "$REPO_DIR"

TARGET="all"
OUTPUT="--push"
for arg in "$@"; do
    case "$arg" in
        server|client|all) TARGET="$arg" ;;
        --load) OUTPUT="--load" ;;
        -h|--help) sed -n '4,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "Unbekanntes Argument: $arg"; exit 1 ;;
    esac
done

if [ -f "$ENV_FILE" ]; then
    # shellcheck disable=SC1090
    source "$ENV_FILE"
fi
if [ -z "${REGISTRY:-}" ]; then
    echo "Fehler: REGISTRY ist nicht gesetzt."
    echo "Lege $ENV_FILE an (wird nicht committet):"
    echo "  REGISTRY=<host>/<pfad>"
    echo "oder setze REGISTRY in der Umgebung."
    exit 1
fi
REGISTRY="${REGISTRY%/}"
TAG="${TAG:-latest}"

GIT_COMMIT="$(git rev-parse HEAD)"
GIT_BRANCH="$(git branch --show-current)"
if [ -z "$GIT_BRANCH" ]; then
    # Gleicher Name wie in scripts/onboard-publish-release.sh.
    GIT_BRANCH="detached"
    echo "WARNUNG: Kein Branch ausgecheckt (detached HEAD); Branch-Name ist \"$GIT_BRANCH\"."
fi
SHORT="${GIT_COMMIT:0:12}"

# Warnt, wenn Pfade, die in das Image eingehen, uncommittete Änderungen haben.
warn_dirty() {
    local image="$1" impact="$2"
    shift 2
    local changes
    changes="$(git status --porcelain -- "$@")"
    [ -z "$changes" ] && return 0
    echo ""
    echo "WARNUNG: Uncommittete Änderungen im $image-Image (Commit $SHORT):"
    echo "$changes" | sed 's/^/   /'
    echo "Auswirkung: $impact"
    echo ""
}

build() {
    local name="$1" dockerfile="$2" context="$3"
    local image="$REGISTRY/$name:$TAG"
    echo "── $image  ($GIT_BRANCH @ $SHORT) ──"
    docker buildx build "$OUTPUT" \
        -f "$dockerfile" \
        -t "$image" \
        --build-arg GIT_BRANCH="$GIT_BRANCH" \
        --build-arg GIT_COMMIT="$GIT_COMMIT" \
        --label org.opencontainers.image.revision="$GIT_COMMIT" \
        --label signalrc.branch="$GIT_BRANCH" \
        "$context"
}

if [ "$TARGET" = "server" ] || [ "$TARGET" = "all" ]; then
    warn_dirty "Server" \
        "Server und Onboard-Pakete tragen Commit $SHORT, enthalten aber diese Änderungen. Onboard Units auf $SHORT erkennen den Unterschied nicht und aktualisieren sich nicht. Ein Rollback-Sperreintrag für $SHORT gilt auch für diesen Stand." \
        Server Shared Onboard VehicleTemplates install.sh
    build signalrc-web Server/Dockerfile .
fi

if [ "$TARGET" = "client" ] || [ "$TARGET" = "all" ]; then
    warn_dirty "Client" \
        "Das Image ist nicht reproduzierbar, und sein Label nennt Commit $SHORT, der diese Änderungen nicht enthält." \
        Client
    build signalrc-client Client/Dockerfile Client
fi
