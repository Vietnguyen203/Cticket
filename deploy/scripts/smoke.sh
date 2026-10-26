#!/usr/bin/env bash
# The checks below are called by name from the list in main().
# shellcheck disable=SC2317,SC2329
# Is the site really up? Checks from OUTSIDE, through Caddy → nginx → API
# (Phase 16): after every deploy (GitHub Actions), or by hand.
#
#   bash deploy/scripts/smoke.sh https://ve.example.com
#   bash deploy/scripts/smoke.sh https://etp.localhost -k --resolve etp.localhost:443:127.0.0.1 --resolve etp.localhost:80:127.0.0.1
#
# Extra arguments go to curl (rehearsal: -k for the local certificate,
# --resolve for a name without DNS).
set -euo pipefail

BASE=""
CURL_OPTS=()

get() { curl --silent --show-error --max-time 15 "${CURL_OPTS[@]}" "$@"; }

api_ready() { [[ "$(get "$BASE/health/ready")" == *'"database":"up"'* ]]; }

home_page() {
  local headers
  headers="$(get -o /dev/null -D - "$BASE/")"
  headers="${headers,,}"
  [[ "$headers" == *" 200"* && "$headers" == *"content-security-policy:"* && "$headers" == *"strict-transport-security:"* ]]
}

public_api() { [[ "$(get "$BASE/api/v1/events")" == *'"success":true'* ]]; }

https_redirect() {
  [[ "$(get -o /dev/null -w '%{http_code} %{redirect_url}' "http://${BASE#https://}/")" =~ ^30[178]\ https:// ]]
}

# A WebSocket handshake (HTTP/1.1; the key is the 16-byte sample of RFC 6455)
# answers 101 Switching Protocols. curl then waits for data until --max-time
# and exits with an error, which is expected: only its output counts.
websocket() {
  local response
  response="$(get --http1.1 --max-time 3 -i -N "$BASE/ws" \
    -H "Connection: Upgrade" -H "Upgrade: websocket" -H "Sec-WebSocket-Version: 13" \
    -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" -H "Origin: $BASE" 2>/dev/null | tr -d '\0' || true)"
  [[ "$response" == *"101 Switching Protocols"* ]]
}

main() {
  BASE="${1:?usage: smoke.sh <https://domain> [curl options]}"
  BASE="${BASE%/}"
  shift
  CURL_OPTS=("$@")

  local failures=0 check description
  while IFS='|' read -r check description; do
    if "$check"; then
      echo "ok   $description"
    else
      echo "FAIL $description"
      failures=$((failures + 1))
    fi
  done <<'EOF'
api_ready|API ready (/health/ready, database up)
home_page|home page: 200, CSP and HSTS headers
public_api|API: public event list
https_redirect|http:// redirects to https://
websocket|WebSocket /ws upgrades (101)
EOF

  if ((failures > 0)); then
    echo "$failures check(s) failed on $BASE" >&2
    exit 1
  fi
  echo "all checks passed on $BASE"
}

main "$@"
exit
