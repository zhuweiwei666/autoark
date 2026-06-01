#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/autoark}"
REPO_URL="${REPO_URL:-https://github.com/zhuweiwei666/autoark.git}"
REF="${AUTOARK_REF:-main}"
TLS_CERT_NAME="${TLS_CERT_NAME:-autoark.work}"
TLS_DOMAINS="${TLS_DOMAINS:-app.autoark.work api.autoark.work}"
TLS_EMAIL="${TLS_EMAIL:-}"

install_renew_timer() {
  if [ "$(id -u)" -ne 0 ] || ! command -v systemctl >/dev/null 2>&1; then
    return
  fi

  cat > /etc/systemd/system/autoark-cert-renew.service <<EOF_SERVICE
[Unit]
Description=Renew AutoArk TLS certificate
Wants=docker.service
After=docker.service network-online.target

[Service]
Type=oneshot
WorkingDirectory=$APP_DIR
Environment="APP_DIR=$APP_DIR"
Environment="TLS_CERT_NAME=$TLS_CERT_NAME"
ExecStart=/bin/bash $APP_DIR/deploy/server-renew-cert.sh
EOF_SERVICE

  cat > /etc/systemd/system/autoark-cert-renew.timer <<EOF_TIMER
[Unit]
Description=Daily AutoArk TLS certificate renewal

[Timer]
OnCalendar=*-*-* 03:17:00
RandomizedDelaySec=1h
Persistent=true

[Install]
WantedBy=timers.target
EOF_TIMER

  systemctl daemon-reload
  systemctl enable --now autoark-cert-renew.timer >/dev/null
}

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Run deploy/server-bootstrap.sh first."
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose plugin is required. Run deploy/server-bootstrap.sh first."
  exit 1
fi

if [ ! -d "$APP_DIR/.git" ]; then
  mkdir -p "$APP_DIR"
  git clone "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"
git fetch origin
if git show-ref --verify --quiet "refs/remotes/origin/$REF"; then
  git checkout -B "$REF" "origin/$REF"
  git pull --ff-only origin "$REF"
else
  git checkout --detach "$REF"
fi

if [ ! -f deploy/.env ]; then
  echo "Missing deploy/.env on server."
  exit 1
fi

COMPOSE=(docker compose -f deploy/docker-compose.prod.yml)
TLS_DIR="deploy/tls/live"
TLS_FULLCHAIN="$TLS_DIR/fullchain.pem"
TLS_PRIVKEY="$TLS_DIR/privkey.pem"

mkdir -p "$TLS_DIR" deploy/certbot/www deploy/certbot/conf

if [ ! -s "$TLS_FULLCHAIN" ] || [ ! -s "$TLS_PRIVKEY" ]; then
  first_domain="$(printf '%s\n' $TLS_DOMAINS | head -n 1)"
  san_names="$(printf 'DNS:%s,' $TLS_DOMAINS)"
  san_names="${san_names%,}"
  openssl req -x509 -nodes -newkey rsa:2048 -days 3 \
    -subj "/CN=$first_domain" \
    -addext "subjectAltName=$san_names" \
    -keyout "$TLS_PRIVKEY" \
    -out "$TLS_FULLCHAIN"
  chmod 600 "$TLS_PRIVKEY"
fi

"${COMPOSE[@]}" up -d --build

if [ "${AUTOARK_ENABLE_LETSENCRYPT:-true}" = "true" ]; then
  certbot_args=(
    certonly
    --webroot
    -w /var/www/certbot
    --cert-name "$TLS_CERT_NAME"
    --agree-tos
    --non-interactive
    --keep-until-expiring
  )

  if [ -n "$TLS_EMAIL" ]; then
    certbot_args+=(--email "$TLS_EMAIL")
  else
    certbot_args+=(--register-unsafely-without-email)
  fi

  for domain in $TLS_DOMAINS; do
    certbot_args+=(-d "$domain")
  done

  if "${COMPOSE[@]}" run --rm certbot "${certbot_args[@]}"; then
    cp "deploy/certbot/conf/live/$TLS_CERT_NAME/fullchain.pem" "$TLS_FULLCHAIN"
    cp "deploy/certbot/conf/live/$TLS_CERT_NAME/privkey.pem" "$TLS_PRIVKEY"
    chmod 600 "$TLS_PRIVKEY"
    "${COMPOSE[@]}" exec -T gateway nginx -s reload || "${COMPOSE[@]}" restart gateway
  else
    echo "Warning: Let's Encrypt certificate issuance failed; gateway is running with the temporary certificate."
  fi
fi

install_renew_timer

"${COMPOSE[@]}" run --rm backend node ensure-super-admin.js
"${COMPOSE[@]}" ps
