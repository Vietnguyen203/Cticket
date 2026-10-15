#!/usr/bin/env bash
# Copy deploy/backups to storage outside this server (Phase 16, optional):
# if the VPS is lost, the backups are not lost with it. Uses rclone in a
# container; the remote (Cloudflare R2, Backblaze B2, …) is set up once in
# deploy/rclone/rclone.conf (docs/deployment.md, section 7) and named by
# OFFSITE_REMOTE in deploy/.env, e.g. r2:etp-backups.
#
#   bash deploy/scripts/offsite-sync.sh                  copy now
#   bash deploy/scripts/offsite-sync.sh --install-cron   every night at 20:45 UTC (after the backup)
#
# "copy", not "sync": a file deleted here (rotation) stays there; set a
# lifecycle rule on the bucket to expire old files.
set -euo pipefail
# shellcheck source=deploy/scripts/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

RCLONE_IMAGE=rclone/rclone:1.68

main() {
  cd "$REPO_DIR"
  if [[ "${1:-}" == "--install-cron" ]]; then
    local line="45 20 * * * bash $REPO_DIR/deploy/scripts/offsite-sync.sh >> $STATE_DIR/offsite.log 2>&1"
    mkdir -p "$STATE_DIR"
    (crontab -l 2>/dev/null | grep -v 'offsite-sync.sh' || true; echo "$line") | crontab -
    log "cron installed: $line"
    return
  fi

  local remote
  remote="$(grep -E '^OFFSITE_REMOTE=' deploy/.env 2>/dev/null | cut -d= -f2- || true)"
  [[ -n "$remote" ]] || die "OFFSITE_REMOTE is not set in deploy/.env (docs/deployment.md, section 7)"
  [[ -f deploy/rclone/rclone.conf ]] || die "deploy/rclone/rclone.conf is missing (docs/deployment.md, section 7)"

  log "copying deploy/backups → $remote"
  docker run --rm \
    -v "$REPO_DIR/deploy/backups:/data:ro" \
    -v "$REPO_DIR/deploy/rclone:/config/rclone:ro" \
    "$RCLONE_IMAGE" copy /data "$remote" --immutable --stats-one-line --stats 0
  log "done"
}

main "$@"
exit
