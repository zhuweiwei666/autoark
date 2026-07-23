#!/usr/bin/env bash
set +x
set -euo pipefail

PROD_HOST="${PROD_HOST:-root@45.33.103.31}"
APP_DIR="${APP_DIR:-/opt/autoark}"
REPO_URL="${REPO_URL:-https://github.com/zhuweiwei666/autoark.git}"
AUTOARK_REF="${AUTOARK_REF:-}"
REMOTE_ENV_BACKUP="${REMOTE_ENV_BACKUP:-/root/prod.env}"
REMOTE_ENV_UPLOAD_STAGE="${REMOTE_ENV_UPLOAD_STAGE:-${REMOTE_ENV_BACKUP}.upload-pending}"
REMOTE_DEPLOY_LOCK_FILE="${REMOTE_DEPLOY_LOCK_FILE:-/tmp/autoark-deploy.lock}"

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

if [[ ! "$AUTOARK_REF" =~ ^[0-9a-f]{40}$ ]]; then
  echo "AUTOARK_REF must be a verified 40-character commit SHA."
  exit 1
fi

GUANGDADA_API_KEY_OVERRIDE_SET='false'
GUANGDADA_API_KEY_OVERRIDE=''
if [ "${GUANGDADA_API_KEY+x}" = 'x' ]; then
  GUANGDADA_API_KEY_OVERRIDE_SET='true'
  GUANGDADA_API_KEY_OVERRIDE="$GUANGDADA_API_KEY"
fi

EXTERNAL_MATERIAL_SYNC_ENABLED_OVERRIDE_SET='false'
EXTERNAL_MATERIAL_SYNC_ENABLED_OVERRIDE=''
if [ "${EXTERNAL_MATERIAL_SYNC_ENABLED+x}" = 'x' ]; then
  EXTERNAL_MATERIAL_SYNC_ENABLED_OVERRIDE_SET='true'
  EXTERNAL_MATERIAL_SYNC_ENABLED_OVERRIDE="$EXTERNAL_MATERIAL_SYNC_ENABLED"
fi

case "$EXTERNAL_MATERIAL_SYNC_ENABLED_OVERRIDE_SET:$EXTERNAL_MATERIAL_SYNC_ENABLED_OVERRIDE" in
  false: | true:true | true:false) ;;
  *)
    echo "EXTERNAL_MATERIAL_SYNC_ENABLED must be true or false."
    exit 1
    ;;
esac

case "$GUANGDADA_API_KEY_OVERRIDE" in
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

REMOTE_ENV_UPLOAD_CANDIDATE=''
if [ -n "${AUTOARK_ENV_FILE:-}" ]; then
  if [ ! -f "$AUTOARK_ENV_FILE" ]; then
    echo "AUTOARK_ENV_FILE does not exist: $AUTOARK_ENV_FILE"
    exit 1
  fi
  require_command scp
  REMOTE_ENV_UPLOAD_CANDIDATE="${REMOTE_ENV_UPLOAD_STAGE}.uploading.$$.${RANDOM}"
  printf -v QUOTED_REMOTE_ENV_UPLOAD_CANDIDATE '%q' "$REMOTE_ENV_UPLOAD_CANDIDATE"
  log "Staging production environment file"
  ssh "$PROD_HOST" \
    "umask 077; : > $QUOTED_REMOTE_ENV_UPLOAD_CANDIDATE; chmod 600 $QUOTED_REMOTE_ENV_UPLOAD_CANDIDATE"
  if ! scp -q "$AUTOARK_ENV_FILE" "$PROD_HOST:$REMOTE_ENV_UPLOAD_CANDIDATE"; then
    ssh "$PROD_HOST" "rm -f -- $QUOTED_REMOTE_ENV_UPLOAD_CANDIDATE" || true
    echo "Production environment staging failed."
    exit 1
  fi
  ssh "$PROD_HOST" "chmod 600 $QUOTED_REMOTE_ENV_UPLOAD_CANDIDATE"
fi

read -r -d '' REMOTE_DEPLOY_TRANSACTION_SCRIPT <<'REMOTE_SCRIPT' || true
# AUTOARK_DEPLOY_TRANSACTION_V1
set +x
set -Eeuo pipefail

app_dir="$1"
repo_url="$2"
autoark_ref="$3"
backup_env_path="$4"
deploy_env_path="$app_dir/deploy/.env"
upload_env_path="$5"
upload_candidate_path="$6"
deploy_lock_file="$7"

key_override_set=''
key_override=''
flag_override_set=''
flag_override=''
IFS= read -r -d '' key_override_set
IFS= read -r -d '' key_override
IFS= read -r -d '' flag_override_set
IFS= read -r -d '' flag_override

case "$key_override_set" in
  true | false) ;;
  *)
    echo 'Invalid GUANGDADA_API_KEY override state.'
    exit 1
    ;;
esac
case "$flag_override_set:$flag_override" in
  false: | true:true | true:false) ;;
  *)
    echo 'EXTERNAL_MATERIAL_SYNC_ENABLED must be true or false.'
    exit 1
    ;;
esac
case "$key_override" in
  *$'\n'* | *$'\r'*)
    echo 'GUANGDADA_API_KEY must be a single line.'
    exit 1
    ;;
esac

if ! command -v flock >/dev/null 2>&1; then
  echo 'flock is required for production deployment.'
  exit 1
fi
mkdir -p -- "$(dirname -- "$deploy_lock_file")"
exec 8>"$deploy_lock_file"
flock -x 8

transaction_prefix="${backup_env_path}.external-sync"
transaction_marker="${transaction_prefix}.pending"
payload_path="${transaction_prefix}.payload"
root_before_path="${transaction_prefix}.root.before"
runtime_before_path="${transaction_prefix}.runtime.before"
root_existed_marker="${transaction_prefix}.root.existed"
runtime_existed_marker="${transaction_prefix}.runtime.existed"
root_stage_path="${backup_env_path}.external-sync.next"
runtime_stage_path="${deploy_env_path}.external-sync.next"
transaction_active='false'
base_payload_temp=''
payload_temp=''
marker_temp=''

atomic_restore() {
  local before_path="$1"
  local target_path="$2"
  local target_temp

  mkdir -p -- "$(dirname -- "$target_path")"
  target_temp="$(mktemp "${target_path}.restore.XXXXXX")"
  cp -- "$before_path" "$target_temp"
  chmod 600 "$target_temp"
  mv -f -- "$target_temp" "$target_path"
  chmod 600 "$target_path"
}

rollback_pair() {
  if [ -f "$root_existed_marker" ]; then
    if [ ! -f "$root_before_path" ]; then
      echo 'Cannot recover canonical production environment.'
      return 1
    fi
    atomic_restore "$root_before_path" "$backup_env_path"
  else
    rm -f -- "$backup_env_path"
  fi

  if [ -f "$runtime_existed_marker" ]; then
    if [ ! -f "$runtime_before_path" ]; then
      echo 'Cannot recover runtime production environment.'
      return 1
    fi
    atomic_restore "$runtime_before_path" "$deploy_env_path"
  else
    rm -f -- "$deploy_env_path"
  fi

  rm -f -- \
    "$transaction_marker" \
    "$payload_path" \
    "$root_before_path" \
    "$runtime_before_path" \
    "$root_existed_marker" \
    "$runtime_existed_marker" \
    "$root_stage_path" \
    "$runtime_stage_path"
}

rollback_on_error() {
  local status="$?"
  trap - ERR
  rm -f -- \
    ${base_payload_temp:+"$base_payload_temp"} \
    ${payload_temp:+"$payload_temp"} \
    ${marker_temp:+"$marker_temp"}
  if [ "$transaction_active" = 'true' ]; then
    rollback_pair || true
  elif [ ! -f "$transaction_marker" ]; then
    rm -f -- \
      "$payload_path" \
      "$root_before_path" \
      "$runtime_before_path" \
      "$root_existed_marker" \
      "$runtime_existed_marker" \
      "$root_stage_path" \
      "$runtime_stage_path"
  fi
  exit "$status"
}
trap rollback_on_error ERR

if [ -f "$transaction_marker" ]; then
  transaction_active='true'
  rollback_pair
  transaction_active='false'
fi

if [ -n "$upload_candidate_path" ]; then
  if [ ! -f "$upload_candidate_path" ]; then
    echo 'Missing staged production environment upload.'
    exit 1
  fi
  mv -f -- "$upload_candidate_path" "$upload_env_path"
  chmod 600 "$upload_env_path"
fi

mkdir -p -- "$(dirname -- "$app_dir")"
if [ ! -d "$app_dir/.git" ]; then
  git clone "$repo_url" "$app_dir"
fi
cd "$app_dir"
git fetch --no-tags origin main
git cat-file -e "${autoark_ref}^{commit}"
if ! git merge-base --is-ancestor "$autoark_ref" origin/main; then
  echo 'Verified deployment commit is no longer contained in origin/main.'
  exit 1
fi
git checkout --detach "$autoark_ref"
mkdir -p -- "$app_dir/deploy" "$(dirname -- "$backup_env_path")"

if [ -f "$upload_env_path" ]; then
  source_env_path="$upload_env_path"
elif [ -f "$backup_env_path" ]; then
  source_env_path="$backup_env_path"
elif [ -f "$deploy_env_path" ]; then
  source_env_path="$deploy_env_path"
else
  echo 'Missing production environment source.'
  exit 1
fi

base_payload_temp="$(mktemp "${transaction_prefix}.base.XXXXXX")"
payload_temp="$(mktemp "${transaction_prefix}.payload.XXXXXX")"
chmod 600 "$base_payload_temp" "$payload_temp"
source_key=''
source_flag='false'
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    GUANGDADA_API_KEY=*)
      source_key="${line#GUANGDADA_API_KEY=}"
      ;;
    EXTERNAL_MATERIAL_SYNC_ENABLED=*)
      source_flag="${line#EXTERNAL_MATERIAL_SYNC_ENABLED=}"
      ;;
    *)
      printf '%s\n' "$line"
      ;;
  esac
done < "$source_env_path" > "$base_payload_temp"

resolved_key="$source_key"
resolved_flag="$source_flag"
if [ "$key_override_set" = 'true' ]; then
  resolved_key="$key_override"
fi
if [ "$flag_override_set" = 'true' ]; then
  resolved_flag="$flag_override"
fi

case "$resolved_flag" in
  true | false) ;;
  *)
    echo 'EXTERNAL_MATERIAL_SYNC_ENABLED must resolve to true or false.'
    exit 1
    ;;
esac
if [ "$resolved_flag" = 'true' ] && [[ ! "$resolved_key" =~ [^[:space:]] ]]; then
  echo 'GUANGDADA_API_KEY must be non-empty when external material sync is enabled.'
  exit 1
fi
case "$resolved_key" in
  *$'\n'* | *$'\r'*)
    echo 'GUANGDADA_API_KEY must resolve to one line.'
    exit 1
    ;;
esac

cat "$base_payload_temp" > "$payload_temp"
printf 'GUANGDADA_API_KEY=%s\n' "$resolved_key" >> "$payload_temp"
printf 'EXTERNAL_MATERIAL_SYNC_ENABLED=%s\n' "$resolved_flag" >> "$payload_temp"
chmod 600 "$payload_temp"
mv -f -- "$payload_temp" "$payload_path"
payload_temp=''
rm -f -- "$base_payload_temp"
base_payload_temp=''

rm -f -- \
  "$root_before_path" \
  "$runtime_before_path" \
  "$root_existed_marker" \
  "$runtime_existed_marker"
if [ -f "$backup_env_path" ]; then
  cp -- "$backup_env_path" "$root_before_path"
  chmod 600 "$root_before_path"
  : > "$root_existed_marker"
  chmod 600 "$root_existed_marker"
fi
if [ -f "$deploy_env_path" ]; then
  cp -- "$deploy_env_path" "$runtime_before_path"
  chmod 600 "$runtime_before_path"
  : > "$runtime_existed_marker"
  chmod 600 "$runtime_existed_marker"
fi

cp -- "$payload_path" "$root_stage_path"
cp -- "$payload_path" "$runtime_stage_path"
chmod 600 "$root_stage_path" "$runtime_stage_path"
marker_temp="$(mktemp "${transaction_marker}.XXXXXX")"
printf 'pending\n' > "$marker_temp"
chmod 600 "$marker_temp"
mv -f -- "$marker_temp" "$transaction_marker"
marker_temp=''
transaction_active='true'

mv -f -- "$root_stage_path" "$backup_env_path"
chmod 600 "$backup_env_path"
mv -f -- "$runtime_stage_path" "$deploy_env_path"
chmod 600 "$deploy_env_path"

inner_lock_file="${transaction_prefix}.server-deploy.lock"
AUTOARK_DEPLOY_LOCK_FILE="$inner_lock_file" \
  APP_DIR="$app_dir" \
  REPO_URL="$repo_url" \
  AUTOARK_REF="$autoark_ref" \
  bash deploy/server-deploy.sh

transaction_active='false'
rm -f -- \
  "$transaction_marker" \
  "$payload_path" \
  "$root_before_path" \
  "$runtime_before_path" \
  "$root_existed_marker" \
  "$runtime_existed_marker" \
  "$upload_env_path"
chmod 600 "$backup_env_path" "$deploy_env_path"
REMOTE_SCRIPT

printf -v QUOTED_REMOTE_DEPLOY_TRANSACTION_SCRIPT '%q' "$REMOTE_DEPLOY_TRANSACTION_SCRIPT"
printf -v QUOTED_APP_DIR '%q' "$APP_DIR"
printf -v QUOTED_REPO_URL '%q' "$REPO_URL"
printf -v QUOTED_AUTOARK_REF '%q' "$AUTOARK_REF"
printf -v QUOTED_REMOTE_ENV_BACKUP '%q' "$REMOTE_ENV_BACKUP"
printf -v QUOTED_REMOTE_ENV_UPLOAD_STAGE '%q' "$REMOTE_ENV_UPLOAD_STAGE"
printf -v QUOTED_REMOTE_ENV_UPLOAD_CANDIDATE '%q' "$REMOTE_ENV_UPLOAD_CANDIDATE"
printf -v QUOTED_REMOTE_DEPLOY_LOCK_FILE '%q' "$REMOTE_DEPLOY_LOCK_FILE"
REMOTE_DEPLOY_TRANSACTION_COMMAND="bash -c $QUOTED_REMOTE_DEPLOY_TRANSACTION_SCRIPT -- $QUOTED_APP_DIR $QUOTED_REPO_URL $QUOTED_AUTOARK_REF $QUOTED_REMOTE_ENV_BACKUP $QUOTED_REMOTE_ENV_UPLOAD_STAGE $QUOTED_REMOTE_ENV_UPLOAD_CANDIDATE $QUOTED_REMOTE_DEPLOY_LOCK_FILE"

log "Deploying verified commit=$AUTOARK_REF"
log "Synchronizing GUANGDADA_API_KEY and EXTERNAL_MATERIAL_SYNC_ENABLED"
printf '%s\0%s\0%s\0%s\0' \
  "$GUANGDADA_API_KEY_OVERRIDE_SET" \
  "$GUANGDADA_API_KEY_OVERRIDE" \
  "$EXTERNAL_MATERIAL_SYNC_ENABLED_OVERRIDE_SET" \
  "$EXTERNAL_MATERIAL_SYNC_ENABLED_OVERRIDE" |
  ssh "$PROD_HOST" "$REMOTE_DEPLOY_TRANSACTION_COMMAND"

if [ "${AUTOARK_SKIP_VERIFY:-false}" != "true" ]; then
  log "Running production verification"
  "$(dirname "$0")/verify-production.sh"
fi

log "Deployment complete"
