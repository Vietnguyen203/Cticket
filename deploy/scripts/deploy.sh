#!/usr/bin/env bash
# Deploy one commit on this server (Phase 16). See docs/deployment.md.
#
#   bash deploy/scripts/deploy.sh [<git ref>]     default origin/main
#   bash deploy/scripts/deploy.sh --checked-out   the commit already checked out
#
# 1. fetch + check out the commit, then run THAT commit's version of this script
# 2. build the images (tagged with the commit); the running version keeps serving
# 3. back up the database (pre-deploy), 4. migrate (forward only)
# 5. replace the containers, 6. wait until healthy, else go back to the previous
#    images, 7. keep the images of the last 3 commits.
set -euo pipefail
# shellcheck source=deploy/scripts/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

main() {
  cd "$REPO_DIR"
  if [[ "${1:-}" != "--checked-out" ]]; then
    local ref="${1:-origin/main}"
    log "fetching $ref"
    git fetch --prune --quiet origin
    git checkout --quiet --detach "$ref"
    exec bash "$REPO_DIR/deploy/scripts/deploy.sh" --checked-out
  fi

  [[ -f deploy/.env ]] || die "deploy/.env is missing: bash deploy/scripts/init-env.sh <domain> <email>"
  local tag previous
  tag="$(git rev-parse --short=12 HEAD)"
  previous="$(current_tag)"
  log "deploying $tag ($(git log -1 --format=%s)); running now: ${previous:-nothing}"

  export IMAGE_TAG="$tag"
  compose build api web

  if [[ -n "$previous" ]] && compose ps --status running --services | grep -qx backup; then
    log "backup before the migrations"
    compose exec -T backup sh /scripts/backup.sh pre-deploy </dev/null
  fi

  log "migrations"
  compose run --rm migrate </dev/null

  log "starting $tag"
  compose up -d --remove-orphans
  if ! wait_healthy; then
    if [[ -n "$previous" && "$previous" != "$tag" ]]; then
      log "not healthy: going back to $previous"
      # Its code too (compose file, scripts), so they match the images that run.
      git checkout --quiet --detach "$previous"
      IMAGE_TAG="$previous" compose up -d --remove-orphans
      log "if $tag changed the database, see docs/deployment.md, section 8 (restore the pre-deploy backup)"
    fi
    compose logs --tail 50 api web >&2 || true
    die "deploy of $tag failed"
  fi

  [[ "$tag" == "$previous" ]] || record_tag "$tag"
  prune_images
  log "deployed $tag"
}

main "$@"
exit
