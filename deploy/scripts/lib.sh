#!/usr/bin/env bash
# Shared by the deploy scripts (Phase 16). Sourced, never run on its own.
#
# Every script keeps its body in a main() function called on the last line:
# bash reads a whole function before running it, so a `git checkout` that
# rewrites the script file while it runs cannot change what runs.

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# Rehearsal on Windows (Git Bash): docker.exe wants C:/… paths, and must get
# "/scripts/backup.sh" (a path inside a container) unchanged. Nothing to do on Linux.
if command -v cygpath >/dev/null 2>&1; then
  REPO_DIR="$(cygpath -m "$REPO_DIR")"
  export MSYS_NO_PATHCONV=1
fi
STATE_DIR="$REPO_DIR/deploy/.state" # history: one deployed commit per line, newest last
COMPOSE_FILE="$REPO_DIR/deploy/docker-compose.prod.yml"

# A host path as docker.exe wants it on Windows (C:/…); unchanged on Linux.
host_path() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }

log() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
die() {
  log "ERROR: $*" >&2
  exit 1
}

# docker compose on the production file; IMAGE_TAG must be exported by the caller.
compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

current_tag() { tail -n 1 "$STATE_DIR/history" 2>/dev/null || true; }

# The deployed commit before <tag> (the newest line that differs from it).
previous_tag() {
  grep -vx "$1" "$STATE_DIR/history" 2>/dev/null | tail -n 1 || true
}

record_tag() {
  mkdir -p "$STATE_DIR"
  echo "$1" >>"$STATE_DIR/history"
}

container_health() {
  local id
  id="$(compose ps -q "$1" 2>/dev/null)"
  [[ -n "$id" ]] || return 0
  docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id"
}

# The API reports ready (its healthcheck) AND answers through nginx.
wait_healthy() {
  local i
  for ((i = 1; i <= 40; i++)); do
    if [[ "$(container_health api)" == healthy ]] &&
      compose exec -T web wget -q -O /dev/null http://127.0.0.1:8080/health/ready </dev/null 2>/dev/null; then
      return 0
    fi
    sleep 3
  done
  return 1
}

# Keep the images of the last 3 deployed commits (instant rollback), drop the rest.
prune_images() {
  local keep repo tag
  keep="$(tail -n 3 "$STATE_DIR/history" 2>/dev/null | sort -u)"
  for repo in etp-prod-backend etp-prod-web; do
    while read -r tag; do
      [[ -z "$tag" ]] && continue
      grep -qx "$tag" <<<"$keep" || docker image rm "$repo:$tag" >/dev/null 2>&1 || true
    done < <(docker image ls "$repo" --format '{{.Tag}}')
  done
  docker image prune -f >/dev/null
  docker builder prune -f --filter until=168h >/dev/null 2>&1 || true
}
