#!/usr/bin/env bash
set +x
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

EXTERNAL_MATERIAL_SYNC_ENABLED="${EXTERNAL_MATERIAL_SYNC_ENABLED:-false}"
GUANGDADA_API_KEY="${GUANGDADA_API_KEY:-}"

case "$EXTERNAL_MATERIAL_SYNC_ENABLED" in
  true | false) ;;
  *)
    echo "EXTERNAL_MATERIAL_SYNC_ENABLED must be true or false."
    exit 1
    ;;
esac

if [ "$EXTERNAL_MATERIAL_SYNC_ENABLED" = "true" ] &&
  [[ ! "$GUANGDADA_API_KEY" =~ [^[:space:]] ]]; then
  echo "GUANGDADA_API_KEY must be non-empty when external material sync is enabled."
  exit 1
fi
case "$GUANGDADA_API_KEY" in
  *$'\n'* | *$'\r'*)
    echo "GUANGDADA_API_KEY must be a single line."
    exit 1
    ;;
esac

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

read -r -d '' REMOTE_SECRET_SYNC_SCRIPT <<'REMOTE_SCRIPT' || true
# AUTOARK_SECRET_SYNC_V1
set +x
set -euo pipefail

backup_env_path="$1"
deploy_env_path="$2"
provider_key=''
sync_enabled=''
IFS= read -r -d '' provider_key
IFS= read -r -d '' sync_enabled

case "$sync_enabled" in
  true | false) ;;
  *)
    echo 'EXTERNAL_MATERIAL_SYNC_ENABLED must be true or false.'
    exit 1
    ;;
esac

if [ "$sync_enabled" = 'true' ] && [[ ! "$provider_key" =~ [^[:space:]] ]]; then
  echo 'GUANGDADA_API_KEY must be non-empty when external material sync is enabled.'
  exit 1
fi
case "$provider_key" in
  *$'\n'* | *$'\r'*)
    echo 'GUANGDADA_API_KEY must be a single line.'
    exit 1
    ;;
esac

umask 077
mkdir -p -- "$(dirname -- "$backup_env_path")" "$(dirname -- "$deploy_env_path")"
if [ ! -e "$backup_env_path" ] && [ -e "$deploy_env_path" ]; then
  cp -- "$deploy_env_path" "$backup_env_path"
elif [ ! -e "$deploy_env_path" ] && [ -e "$backup_env_path" ]; then
  cp -- "$backup_env_path" "$deploy_env_path"
fi
[ -e "$backup_env_path" ] || : > "$backup_env_path"
[ -e "$deploy_env_path" ] || : > "$deploy_env_path"

update_named_env_entry() {
  local env_path="$1"
  local entry_name="$2"
  local entry_value="$3"
  local temp_path
  local found='false'
  local line

  temp_path="$(mktemp "${env_path}.tmp.XXXXXX")"
  chmod 600 "$temp_path"
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      "$entry_name="*)
        if [ "$found" = 'false' ]; then
          printf '%s=%s\n' "$entry_name" "$entry_value"
          found='true'
        fi
        ;;
      *)
        printf '%s\n' "$line"
        ;;
    esac
  done < "$env_path" > "$temp_path"

  if [ "$found" = 'false' ]; then
    printf '%s=%s\n' "$entry_name" "$entry_value" >> "$temp_path"
  fi

  chmod 600 "$temp_path"
  mv -f -- "$temp_path" "$env_path"
  chmod 600 "$env_path"
}

for env_path in "$backup_env_path" "$deploy_env_path"; do
  update_named_env_entry "$env_path" 'GUANGDADA_API_KEY' "$provider_key"
  update_named_env_entry \
    "$env_path" \
    'EXTERNAL_MATERIAL_SYNC_ENABLED' \
    "$sync_enabled"
done
REMOTE_SCRIPT

printf -v QUOTED_REMOTE_SECRET_SYNC_SCRIPT '%q' "$REMOTE_SECRET_SYNC_SCRIPT"
printf -v QUOTED_REMOTE_ENV_BACKUP '%q' "$REMOTE_ENV_BACKUP"
printf -v QUOTED_REMOTE_DEPLOY_ENV '%q' "$APP_DIR/deploy/.env"
REMOTE_SECRET_SYNC_COMMAND="bash -c $QUOTED_REMOTE_SECRET_SYNC_SCRIPT -- $QUOTED_REMOTE_ENV_BACKUP $QUOTED_REMOTE_DEPLOY_ENV"

log "Synchronizing GUANGDADA_API_KEY and EXTERNAL_MATERIAL_SYNC_ENABLED"
printf '%s\0%s\0' "$GUANGDADA_API_KEY" "$EXTERNAL_MATERIAL_SYNC_ENABLED" |
  ssh "$PROD_HOST" "$REMOTE_SECRET_SYNC_COMMAND"

log "Deploying ref=$AUTOARK_REF to $PROD_HOST:$APP_DIR"
ssh "$PROD_HOST" "set -euo pipefail
  if [ ! -d '$APP_DIR/.git' ]; then
    mkdir -p '$APP_DIR'
    git clone '$REPO_URL' '$APP_DIR'
  fi
  cd '$APP_DIR'
  git fetch origin
  if git show-ref --verify --quiet 'refs/remotes/origin/$AUTOARK_REF'; then
    git checkout -B '$AUTOARK_REF' 'origin/$AUTOARK_REF'
    git pull --ff-only origin '$AUTOARK_REF'
  else
    git checkout --detach '$AUTOARK_REF'
  fi
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
