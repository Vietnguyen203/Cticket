#!/usr/bin/env bash
# Go back to the previously deployed commit (Phase 16): its images are still
# on the server (deploy.sh keeps the last 3), so nothing is built.
#
#   bash deploy/scripts/rollback.sh            the commit before the current one
#   bash deploy/scripts/rollback.sh <tag>      a given one (deploy/.state/history)
#
# The database is NOT rolled back: migrations only go forward. If the newer
# version changed it in a way the older one cannot read, restore the
# pre-deploy backup (docs/deployment.md, section 8).
set -euo pipefail
# shellcheck source=deploy/scripts/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

main() {
  cd "$REPO_DIR"
  local current target
  current="$(current_tag)"
  target="${1:-$(previous_tag "$current")}"
  [[ -n "$target" ]] || die "no earlier deploy recorded in $STATE_DIR/history"
  docker image inspect "etp-prod-backend:$target" "etp-prod-web:$target" >/dev/null 2>&1 ||
    die "the images of $target are gone; deploy it instead: bash deploy/scripts/deploy.sh $target"

  log "rolling back $current → $target"
  # The compose file and scripts of that commit go with its images.
  git checkout --quiet --detach "$target"
  export IMAGE_TAG="$target"
  compose up -d --remove-orphans
  wait_healthy || die "$target is not healthy either: compose logs api web"
  record_tag "$target"
  log "running $target"
}

main "$@"
exit
