#!/usr/bin/env bash
# Restore a backup made by backup.sh (Phase 16). See docs/deployment.md, section 8.
#
#   bash deploy/scripts/restore.sh check <db-….dump>
#       Restore into a scratch database, compare its row counts with the live
#       one, drop it. Changes nothing: run it now and then to know the
#       backups are good.
#
#   bash deploy/scripts/restore.sh apply <db-….dump> [<uploads-….tar.gz>]
#       Replace the live data. Asks you to type the domain first. A backup of
#       the current data is made, the API is stopped, the live database is
#       RENAMED (kept, not dropped), the dump goes into a new one, the API
#       starts again.
set -euo pipefail
# shellcheck source=deploy/scripts/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

# psql / pg_restore inside the postgres container, as its own user (from its
# env). `docker compose exec` reads stdin: only pg_stdin (a dump) may use it,
# everything else gets /dev/null (it would swallow the typed confirmation).
pg() { compose exec -T postgres sh -c "$1" </dev/null; }
pg_stdin() { compose exec -T postgres sh -c "$1"; }

row_counts() {
  pg "psql -U \"\$POSTGRES_USER\" -d $1 -At -F ' ' -c \"
    SELECT 'users', count(*) FROM users UNION ALL
    SELECT 'events', count(*) FROM events UNION ALL
    SELECT 'orders', count(*) FROM orders UNION ALL
    SELECT 'tickets', count(*) FROM tickets UNION ALL
    SELECT 'check_ins', count(*) FROM check_ins\""
}

# Single quotes on purpose: $POSTGRES_DB is the container's variable.
# shellcheck disable=SC2016
live_db() { pg 'printf %s "$POSTGRES_DB"'; }

restore_into() {
  local database="$1" dump="$2"
  pg "psql -U \"\$POSTGRES_USER\" -d postgres -q -c 'CREATE DATABASE $database'"
  pg_stdin "pg_restore -U \"\$POSTGRES_USER\" -d $database --no-owner --exit-on-error" <"$dump"
}

check() {
  local dump="$1" scratch="etp_restore_check"
  pg "psql -U \"\$POSTGRES_USER\" -d postgres -q -c 'DROP DATABASE IF EXISTS $scratch'"
  log "restoring $(basename "$dump") into $scratch"
  restore_into "$scratch" "$dump"
  log "rows: backup | live"
  join <(row_counts "$scratch" | sort) <(row_counts "$(live_db)" | sort) | awk '{ printf "  %-10s %8s %8s\n", $1, $2, $3 }'
  pg "psql -U \"\$POSTGRES_USER\" -d postgres -q -c 'DROP DATABASE $scratch'"
  log "the backup restores fine (scratch database dropped)"
}

apply() {
  local dump="$1" uploads="${2:-}" live stamp kept domain answer=""
  domain="$(grep -E '^DOMAIN=' "$REPO_DIR/deploy/.env" | cut -d= -f2-)"
  read -r -p "This replaces the data of $domain with $(basename "$dump"). Type the domain to go on: " answer || true
  [[ -n "$domain" && "$answer" == "$domain" ]] || die "cancelled"
  live="$(live_db)"
  stamp="$(date -u +%Y%m%d%H%M%S)"
  kept="${live}_before_restore_$stamp"

  log "backup of the current data first"
  compose exec -T backup sh /scripts/backup.sh manual </dev/null
  log "stopping the API, the worker and the web"
  compose stop api worker web
  pg "psql -U \"\$POSTGRES_USER\" -d postgres -q -c \"
    SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$live' AND pid <> pg_backend_pid();
    ALTER DATABASE $live RENAME TO $kept\""
  log "restoring into a new $live (the old data stays as $kept)"
  restore_into "$live" "$dump"
  if [[ -n "$uploads" ]]; then
    log "restoring the images from $(basename "$uploads")"
    compose run --rm --no-deps -T --entrypoint sh -v "$(host_path "$(cd "$(dirname "$uploads")" && pwd)"):/in:ro" \
      api -c "rm -rf /app/uploads/* && tar -xzf /in/$(basename "$uploads") -C /app/uploads" </dev/null
  fi
  compose start web worker api
  wait_healthy || die "the API is not healthy after the restore: compose logs api"
  log "restored. When everything looks right: DROP DATABASE $kept (docs/deployment.md, section 8)"
}

main() {
  cd "$REPO_DIR"
  local action="${1:-}" dump="${2:-}"
  [[ -f "$dump" ]] || die "usage: restore.sh check|apply <db-….dump> [<uploads-….tar.gz>]"
  export IMAGE_TAG="${IMAGE_TAG:-$(current_tag)}"
  [[ -n "$IMAGE_TAG" ]] || die "nothing deployed yet (deploy/.state/history is empty)"
  case "$action" in
    check) check "$dump" ;;
    apply) apply "$dump" "${3:-}" ;;
    *) die "usage: restore.sh check|apply <db-….dump> [<uploads-….tar.gz>]" ;;
  esac
}

main "$@"
exit
