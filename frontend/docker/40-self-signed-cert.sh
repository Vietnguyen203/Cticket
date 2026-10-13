#!/bin/sh
# Development HTTPS: browsers open the camera only on HTTPS (or localhost), so
# a phone on the same Wi-Fi needs https://<this-computer-ip>:8443. The
# certificate is self-signed (the phone shows a warning once) and kept in a
# volume so it does not change on every restart. Never use it in production.
set -e
dir=/etc/nginx/certs
if [ ! -f "$dir/web.crt" ]; then
  mkdir -p "$dir"
  openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
    -keyout "$dir/web.key" -out "$dir/web.crt" \
    -subj "/CN=etp-dev" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" >/dev/null 2>&1
  chmod 600 "$dir/web.key"
  echo "Created a self-signed development certificate"
fi
