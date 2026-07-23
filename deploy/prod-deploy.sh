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

REMOTE_ENV_ROTATION_MODE='preserve'
if [ -n "${AUTOARK_ENV_FILE:-}" ]; then
  REMOTE_ENV_ROTATION_MODE='full'
fi

read -r -d '' REMOTE_PREPARE_DEPLOY_SCRIPT <<'REMOTE_SCRIPT' || true
# AUTOARK_PREPARE_DEPLOY_V1
set -euo pipefail

app_dir="$1"
repo_url="$2"
autoark_ref="$3"
backup_env_path="$4"
env_rotation_mode="$5"
deploy_env_path="$app_dir/deploy/.env"

mkdir -p -- "$(dirname -- "$app_dir")"
if [ ! -d "$app_dir/.git" ]; then
  git clone "$repo_url" "$app_dir"
fi

cd "$app_dir"
git fetch origin
if git show-ref --verify --quiet "refs/remotes/origin/$autoark_ref"; then
  git checkout -B "$autoark_ref" "origin/$autoark_ref"
  git pull --ff-only origin "$autoark_ref"
else
  git checkout --detach "$autoark_ref"
fi

mkdir -p -- "$app_dir/deploy"
if [ "$env_rotation_mode" = 'full' ]; then
  if [ ! -f "$backup_env_path" ]; then
    echo "Missing uploaded production env at $backup_env_path"
    exit 1
  fi
  deploy_env_temp="$(mktemp "$app_dir/deploy/.env.tmp.XXXXXX")"
  trap 'rm -f -- "$deploy_env_temp"' EXIT
  cp -- "$backup_env_path" "$deploy_env_temp"
  chmod 600 "$deploy_env_temp"
  mv -f -- "$deploy_env_temp" "$deploy_env_path"
  trap - EXIT
elif [ ! -f "$deploy_env_path" ]; then
  if [ ! -f "$backup_env_path" ]; then
    echo "Missing deploy/.env and no remote env backup found at $backup_env_path"
    exit 1
  fi
  cp -- "$backup_env_path" "$deploy_env_path"
fi

if [ ! -f "$backup_env_path" ]; then
  cp -- "$deploy_env_path" "$backup_env_path"
fi
chmod 600 "$backup_env_path" "$deploy_env_path"
REMOTE_SCRIPT

printf -v QUOTED_REMOTE_PREPARE_DEPLOY_SCRIPT '%q' "$REMOTE_PREPARE_DEPLOY_SCRIPT"
printf -v QUOTED_APP_DIR '%q' "$APP_DIR"
printf -v QUOTED_REPO_URL '%q' "$REPO_URL"
printf -v QUOTED_AUTOARK_REF '%q' "$AUTOARK_REF"
printf -v QUOTED_REMOTE_ENV_BACKUP '%q' "$REMOTE_ENV_BACKUP"
printf -v QUOTED_REMOTE_ENV_ROTATION_MODE '%q' "$REMOTE_ENV_ROTATION_MODE"
REMOTE_PREPARE_DEPLOY_COMMAND="bash -c $QUOTED_REMOTE_PREPARE_DEPLOY_SCRIPT -- $QUOTED_APP_DIR $QUOTED_REPO_URL $QUOTED_AUTOARK_REF $QUOTED_REMOTE_ENV_BACKUP $QUOTED_REMOTE_ENV_ROTATION_MODE"

log "Preparing ref=$AUTOARK_REF at $PROD_HOST:$APP_DIR"
ssh "$PROD_HOST" "$REMOTE_PREPARE_DEPLOY_COMMAND"

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

for env_path in "$backup_env_path" "$deploy_env_path"; do
  if [ ! -f "$env_path" ]; then
    echo "Missing prepared production environment file: $env_path"
    exit 1
  fi
done

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
printf -v QUOTED_REMOTE_DEPLOY_ENV '%q' "$APP_DIR/deploy/.env"
REMOTE_SECRET_SYNC_COMMAND="bash -c $QUOTED_REMOTE_SECRET_SYNC_SCRIPT -- $QUOTED_REMOTE_ENV_BACKUP $QUOTED_REMOTE_DEPLOY_ENV"

log "Synchronizing GUANGDADA_API_KEY and EXTERNAL_MATERIAL_SYNC_ENABLED"
printf '%s\0%s\0' "$GUANGDADA_API_KEY" "$EXTERNAL_MATERIAL_SYNC_ENABLED" |
  ssh "$PROD_HOST" "$REMOTE_SECRET_SYNC_COMMAND"

read -r -d '' REMOTE_SERVER_DEPLOY_SCRIPT <<'REMOTE_SCRIPT' || true
# AUTOARK_SERVER_DEPLOY_V1
set -euo pipefail

app_dir="$1"
repo_url="$2"
autoark_ref="$3"
cd "$app_dir"
APP_DIR="$app_dir" REPO_URL="$repo_url" AUTOARK_REF="$autoark_ref" \
  bash deploy/server-deploy.sh
REMOTE_SCRIPT

printf -v QUOTED_REMOTE_SERVER_DEPLOY_SCRIPT '%q' "$REMOTE_SERVER_DEPLOY_SCRIPT"
REMOTE_SERVER_DEPLOY_COMMAND="bash -c $QUOTED_REMOTE_SERVER_DEPLOY_SCRIPT -- $QUOTED_APP_DIR $QUOTED_REPO_URL $QUOTED_AUTOARK_REF"

log "Deploying ref=$AUTOARK_REF to $PROD_HOST:$APP_DIR"
ssh "$PROD_HOST" "$REMOTE_SERVER_DEPLOY_COMMAND"

if [ "${AUTOARK_SKIP_VERIFY:-false}" != "true" ]; then
  log "Running production verification"
  "$(dirname "$0")/verify-production.sh"
fi

log "Deployment complete"
