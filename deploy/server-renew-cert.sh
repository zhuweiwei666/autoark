#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/autoark}"
TLS_CERT_NAME="${TLS_CERT_NAME:-autoark.work}"

cd "$APP_DIR"

COMPOSE=(docker compose -f deploy/docker-compose.prod.yml)
TLS_DIR="deploy/tls/live"
TLS_FULLCHAIN="$TLS_DIR/fullchain.pem"
TLS_PRIVKEY="$TLS_DIR/privkey.pem"
LE_FULLCHAIN="deploy/certbot/conf/live/$TLS_CERT_NAME/fullchain.pem"
LE_PRIVKEY="deploy/certbot/conf/live/$TLS_CERT_NAME/privkey.pem"

"${COMPOSE[@]}" run --rm certbot renew --webroot -w /var/www/certbot --quiet

if [ -s "$LE_FULLCHAIN" ] && [ -s "$LE_PRIVKEY" ]; then
  mkdir -p "$TLS_DIR"
  cp "$LE_FULLCHAIN" "$TLS_FULLCHAIN"
  cp "$LE_PRIVKEY" "$TLS_PRIVKEY"
  chmod 600 "$TLS_PRIVKEY"
  "${COMPOSE[@]}" exec -T gateway nginx -s reload || "${COMPOSE[@]}" restart gateway
fi
