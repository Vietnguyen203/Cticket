#!/bin/sh
# Back up the database and the uploaded images (Phase 16).
# Runs INSIDE the `backup` container (postgres image: pg_dump, busybox sh):
#   - every night from its crond:       sh /scripts/backup.sh daily
#   - before every deploy (deploy.sh):  sh /scripts/backup.sh pre-deploy
#   - by hand:  docker compose -f deploy/docker-compose.prod.yml exec backup sh /scripts/backup.sh manual
#
# Files in /backups (= deploy/backups on the server):
#   db-<kind>-<UTC time>.dump          pg_dump custom format (pg_restore; scripts/restore.sh)
#   uploads-<kind>-<UTC time>.tar.gz   the event images
# Kept: the last BACKUP_KEEP_DAILY daily ones, a weekly copy every Sunday
# (the last BACKUP_KEEP_WEEKLY), the last 5 pre-deploy ones, manual ones forever.
set -eu

KIND="${1:-manual}"
DIR=/backups
STAMP="$(date -u +%Y%m%d-%H%M%S)"
KEEP_DAILY="${BACKUP_KEEP_DAILY:-7}"
KEEP_WEEKLY="${BACKUP_KEEP_WEEKLY:-4}"
KEEP_PRE_DEPLOY=5

log() { echo "[backup $(date -u +%H:%M:%S)] $*"; }

# Written under a temporary name and renamed at the end: a half-written file
# (disk full, container stopped) is never mistaken for a good backup.
dump="$DIR/db-$KIND-$STAMP.dump"
pg_dump --format=custom --compress=6 --no-owner --file="$dump.partial"
mv "$dump.partial" "$dump"
log "database → $(basename "$dump") ($(du -h "$dump" | cut -f1))"

uploads="$DIR/uploads-$KIND-$STAMP.tar.gz"
tar -czf "$uploads.partial" -C /uploads .
mv "$uploads.partial" "$uploads"
log "images   → $(basename "$uploads") ($(du -h "$uploads" | cut -f1))"

# Sunday: the daily backup is also kept as a weekly one.
if [ "$KIND" = daily ] && [ "$(date -u +%u)" = 7 ]; then
  cp "$dump" "$DIR/db-weekly-$STAMP.dump"
  cp "$uploads" "$DIR/uploads-weekly-$STAMP.tar.gz"
  log "weekly copy kept"
fi

# Keep the newest N of one kind (names sort by time).
prune() {
  kind="$1" keep="$2"
  for prefix in db uploads; do
    find "$DIR" -maxdepth 1 -name "$prefix-$kind-*" | sort -r | tail -n +"$((keep + 1))" | while read -r old; do
      rm -f "$old"
      log "removed $(basename "$old")"
    done
  done
}
prune daily "$KEEP_DAILY"
prune weekly "$KEEP_WEEKLY"
prune pre-deploy "$KEEP_PRE_DEPLOY"

log "done ($KIND)"
