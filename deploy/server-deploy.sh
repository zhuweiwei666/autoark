#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/autoark}"
REPO_URL="${REPO_URL:-https://github.com/zhuweiwei666/autoark.git}"
REF="${AUTOARK_REF:-main}"

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

docker compose -f deploy/docker-compose.prod.yml up -d --build
docker compose -f deploy/docker-compose.prod.yml run --rm backend node ensure-super-admin.js
docker compose -f deploy/docker-compose.prod.yml ps
