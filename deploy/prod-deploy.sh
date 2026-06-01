#!/usr/bin/env bash
set -euo pipefail

PROD_HOST="${PROD_HOST:-root@45.33.103.31}"
APP_DIR="${APP_DIR:-/opt/autoark}"
REPO_URL="${REPO_URL:-https://github.com/zhuweiwei666/autoark.git}"
AUTOARK_REF="${AUTOARK_REF:-main}"
REMOTE_ENV_BACKUP="${REMOTE_ENV_BACKUP:-/root/prod.env}"

log() {
  printf '[autoark-prod] %s\n' "$*"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "$1 is required."
    exit 1
  fi
}

require_command ssh
require_command git

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Run this script from the AutoArk git checkout."
  exit 1
fi

if [ -n "$(git status --porcelain)" ] && [ "${AUTOARK_ALLOW_DIRTY:-false}" != "true" ]; then
  echo "Working tree is dirty. Commit or stash local changes first, or set AUTOARK_ALLOW_DIRTY=true."
  exit 1
fi

if [ -n "${AUTOARK_ENV_FILE:-}" ]; then
  if [ ! -f "$AUTOARK_ENV_FILE" ]; then
    echo "AUTOARK_ENV_FILE does not exist: $AUTOARK_ENV_FILE"
    exit 1
  fi
  require_command scp
  log "Uploading production env file to $PROD_HOST:$REMOTE_ENV_BACKUP"
  scp -q "$AUTOARK_ENV_FILE" "$PROD_HOST:$REMOTE_ENV_BACKUP"
  ssh "$PROD_HOST" "chmod 600 '$REMOTE_ENV_BACKUP'"
fi

log "Deploying ref=$AUTOARK_REF to $PROD_HOST:$APP_DIR"
ssh "$PROD_HOST" "set -euo pipefail
  if [ ! -d '$APP_DIR/.git' ]; then
    mkdir -p '$APP_DIR'
    git clone '$REPO_URL' '$APP_DIR'
  fi
  cd '$APP_DIR'
  if [ ! -f deploy/.env ]; then
    if [ -f '$REMOTE_ENV_BACKUP' ]; then
      cp '$REMOTE_ENV_BACKUP' deploy/.env
      chmod 600 deploy/.env
    else
      echo 'Missing deploy/.env and no remote env backup found at $REMOTE_ENV_BACKUP'
      exit 1
    fi
  fi
  APP_DIR='$APP_DIR' REPO_URL='$REPO_URL' AUTOARK_REF='$AUTOARK_REF' bash deploy/server-deploy.sh
"

if [ "${AUTOARK_SKIP_VERIFY:-false}" != "true" ]; then
  log "Running production verification"
  "$(dirname "$0")/verify-production.sh"
fi

log "Deployment complete"
