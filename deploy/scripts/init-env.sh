#!/usr/bin/env bash
# Create deploy/.env from deploy/.env.example with every secret random, made
# here on the server (they never travel through a chat, a laptop or git).
#
#   bash deploy/scripts/init-env.sh <domain> <email-for-lets-encrypt | internal>
#
# Refuses to overwrite an existing deploy/.env: secrets that change break
# things (sessions, QR codes, two-factor). Edit the SMTP_* lines afterwards.
set -euo pipefail

main() {
  local domain="${1:-}" tls="${2:-}"
  if [[ -z "$domain" || -z "$tls" ]]; then
    echo "Usage: bash deploy/scripts/init-env.sh <domain> <email | internal>" >&2
    exit 2
  fi
  local deploy_dir
  deploy_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  local target="$deploy_dir/.env"
  if [[ -e "$target" ]]; then
    echo "$target already exists; not touching it." >&2
    exit 1
  fi

  # Hex for passwords (safe in URLs: they go into DATABASE_URL / REDIS_URL).
  random_hex() { openssl rand -hex 32; }

  local content
  content="$(cat "$deploy_dir/.env.example")"
  while [[ "$content" == *"__RANDOM__"* ]]; do
    content="${content/__RANDOM__/$(random_hex)}"
  done
  content="${content/__RANDOM_32_BYTES_BASE64__/$(openssl rand -base64 32)}"
  content="${content/DOMAIN=ve.example.com/DOMAIN=$domain}"
  content="${content/CADDY_TLS=you@example.com/CADDY_TLS=$tls}"
  content="${content//no-reply@ve.example.com/no-reply@$domain}"

  (umask 077 && printf '%s\n' "$content" > "$target")
  echo "Created $target (readable by you only). Now set the SMTP_* lines in it."
}

main "$@"
