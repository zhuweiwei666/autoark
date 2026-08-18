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

FACEBOOK_SYNC_ENABLED_OVERRIDE_SET='false'
FACEBOOK_SYNC_ENABLED_OVERRIDE=''
if [ "${FACEBOOK_SYNC_ENABLED+x}" = 'x' ]; then
  FACEBOOK_SYNC_ENABLED_OVERRIDE_SET='true'
  FACEBOOK_SYNC_ENABLED_OVERRIDE="$FACEBOOK_SYNC_ENABLED"
fi

FACEBOOK_AGGREGATION_ENABLED_OVERRIDE_SET='false'
FACEBOOK_AGGREGATION_ENABLED_OVERRIDE=''
if [ "${FACEBOOK_AGGREGATION_ENABLED+x}" = 'x' ]; then
  FACEBOOK_AGGREGATION_ENABLED_OVERRIDE_SET='true'
  FACEBOOK_AGGREGATION_ENABLED_OVERRIDE="$FACEBOOK_AGGREGATION_ENABLED"
fi

FACEBOOK_AGGREGATION_CONCURRENCY_OVERRIDE_SET='false'
FACEBOOK_AGGREGATION_CONCURRENCY_OVERRIDE=''
if [ "${FACEBOOK_AGGREGATION_CONCURRENCY+x}" = 'x' ]; then
  FACEBOOK_AGGREGATION_CONCURRENCY_OVERRIDE_SET='true'
  FACEBOOK_AGGREGATION_CONCURRENCY_OVERRIDE="$FACEBOOK_AGGREGATION_CONCURRENCY"
fi

META_CREDENTIAL_ENCRYPTION_KEY_OVERRIDE_SET='false'
META_CREDENTIAL_ENCRYPTION_KEY_OVERRIDE=''
if [ "${META_CREDENTIAL_ENCRYPTION_KEY+x}" = 'x' ]; then
  META_CREDENTIAL_ENCRYPTION_KEY_OVERRIDE_SET='true'
  META_CREDENTIAL_ENCRYPTION_KEY_OVERRIDE="$META_CREDENTIAL_ENCRYPTION_KEY"
fi

AI_ADS_INTEGRATION_API_KEY_OVERRIDE_SET='false'
AI_ADS_INTEGRATION_API_KEY_OVERRIDE=''
if [ "${AI_ADS_INTEGRATION_API_KEY+x}" = 'x' ]; then
  AI_ADS_INTEGRATION_API_KEY_OVERRIDE_SET='true'
  AI_ADS_INTEGRATION_API_KEY_OVERRIDE="$AI_ADS_INTEGRATION_API_KEY"
fi

AI_ADS_INTEGRATION_ORGANIZATION_ID_OVERRIDE_SET='false'
AI_ADS_INTEGRATION_ORGANIZATION_ID_OVERRIDE=''
if [ "${AI_ADS_INTEGRATION_ORGANIZATION_ID+x}" = 'x' ]; then
  AI_ADS_INTEGRATION_ORGANIZATION_ID_OVERRIDE_SET='true'
  AI_ADS_INTEGRATION_ORGANIZATION_ID_OVERRIDE="$AI_ADS_INTEGRATION_ORGANIZATION_ID"
fi

AI_HOST_CREATIVE_FACTORY_URL_OVERRIDE_SET='false'
AI_HOST_CREATIVE_FACTORY_URL_OVERRIDE=''
if [ "${AI_HOST_CREATIVE_FACTORY_URL+x}" = 'x' ]; then
  AI_HOST_CREATIVE_FACTORY_URL_OVERRIDE_SET='true'
  AI_HOST_CREATIVE_FACTORY_URL_OVERRIDE="$AI_HOST_CREATIVE_FACTORY_URL"
fi

AI_HOST_INTERNAL_API_SECRET_OVERRIDE_SET='false'
AI_HOST_INTERNAL_API_SECRET_OVERRIDE=''
if [ "${AI_HOST_INTERNAL_API_SECRET+x}" = 'x' ]; then
  AI_HOST_INTERNAL_API_SECRET_OVERRIDE_SET='true'
  AI_HOST_INTERNAL_API_SECRET_OVERRIDE="$AI_HOST_INTERNAL_API_SECRET"
fi

CREATIVE_FACTORY_CODEX_SECRET_OVERRIDE_SET='false'
CREATIVE_FACTORY_CODEX_SECRET_OVERRIDE=''
if [ "${CREATIVE_FACTORY_CODEX_SECRET+x}" = 'x' ]; then
  CREATIVE_FACTORY_CODEX_SECRET_OVERRIDE_SET='true'
  CREATIVE_FACTORY_CODEX_SECRET_OVERRIDE="$CREATIVE_FACTORY_CODEX_SECRET"
fi

CREATIVE_FACTORY_DUAL_SCENE_AUDIO_URL_OVERRIDE_SET='false'
CREATIVE_FACTORY_DUAL_SCENE_AUDIO_URL_OVERRIDE=''
if [ "${CREATIVE_FACTORY_DUAL_SCENE_AUDIO_URL+x}" = 'x' ]; then
  CREATIVE_FACTORY_DUAL_SCENE_AUDIO_URL_OVERRIDE_SET='true'
  CREATIVE_FACTORY_DUAL_SCENE_AUDIO_URL_OVERRIDE="$CREATIVE_FACTORY_DUAL_SCENE_AUDIO_URL"
fi

case "$EXTERNAL_MATERIAL_SYNC_ENABLED_OVERRIDE_SET:$EXTERNAL_MATERIAL_SYNC_ENABLED_OVERRIDE" in
  false: | true:true | true:false) ;;
  *)
    echo "EXTERNAL_MATERIAL_SYNC_ENABLED must be true or false."
    exit 1
    ;;
esac

for facebook_boolean_override in \
  "$FACEBOOK_SYNC_ENABLED_OVERRIDE_SET:$FACEBOOK_SYNC_ENABLED_OVERRIDE" \
  "$FACEBOOK_AGGREGATION_ENABLED_OVERRIDE_SET:$FACEBOOK_AGGREGATION_ENABLED_OVERRIDE"; do
  case "$facebook_boolean_override" in
    false: | true:true | true:false) ;;
    *)
      echo "Facebook collection flags must be true or false."
      exit 1
      ;;
  esac
done
case "$FACEBOOK_AGGREGATION_CONCURRENCY_OVERRIDE_SET:$FACEBOOK_AGGREGATION_CONCURRENCY_OVERRIDE" in
  false: | true:[1-5]) ;;
  *)
    echo "FACEBOOK_AGGREGATION_CONCURRENCY must be an integer from 1 to 5."
    exit 1
    ;;
esac

case "$GUANGDADA_API_KEY_OVERRIDE" in
  *$'\n'* | *$'\r'*)
    echo "GUANGDADA_API_KEY must be a single line."
    exit 1
    ;;
esac

case "$META_CREDENTIAL_ENCRYPTION_KEY_OVERRIDE" in
  *$'\n'* | *$'\r'*)
    echo "META_CREDENTIAL_ENCRYPTION_KEY must be a single line."
    exit 1
    ;;
esac
if [ "$META_CREDENTIAL_ENCRYPTION_KEY_OVERRIDE_SET" = 'true' ] &&
  [[ ! "$META_CREDENTIAL_ENCRYPTION_KEY_OVERRIDE" =~ [^[:space:]] ]]; then
  echo "META_CREDENTIAL_ENCRYPTION_KEY must be non-empty when supplied."
  exit 1
fi
for integration_value in \
  "$AI_ADS_INTEGRATION_API_KEY_OVERRIDE" \
  "$AI_ADS_INTEGRATION_ORGANIZATION_ID_OVERRIDE"; do
  case "$integration_value" in
    *$'\n'* | *$'\r'*)
      echo "AI ads integration values must be single-line."
      exit 1
      ;;
  esac
done
if [ "$AI_ADS_INTEGRATION_API_KEY_OVERRIDE_SET" = 'true' ] &&
  [[ ! "$AI_ADS_INTEGRATION_API_KEY_OVERRIDE" =~ [^[:space:]] ]]; then
  echo "AI_ADS_INTEGRATION_API_KEY must be non-empty when supplied."
  exit 1
fi
if [ "$AI_ADS_INTEGRATION_ORGANIZATION_ID_OVERRIDE_SET" = 'true' ] &&
  [[ ! "$AI_ADS_INTEGRATION_ORGANIZATION_ID_OVERRIDE" =~ [^[:space:]] ]]; then
  echo "AI_ADS_INTEGRATION_ORGANIZATION_ID must be non-empty when supplied."
  exit 1
fi
case "$AI_HOST_CREATIVE_FACTORY_URL_OVERRIDE" in
  *$'\n'* | *$'\r'*)
    echo "AI_HOST_CREATIVE_FACTORY_URL must be a single line."
    exit 1
    ;;
esac
if [ "$AI_HOST_CREATIVE_FACTORY_URL_OVERRIDE_SET" = 'true' ] &&
  [[ ! "$AI_HOST_CREATIVE_FACTORY_URL_OVERRIDE" =~ ^https:// ]]; then
  echo "AI_HOST_CREATIVE_FACTORY_URL must be an HTTPS URL when supplied."
  exit 1
fi
for creative_factory_secret in \
  "$AI_HOST_INTERNAL_API_SECRET_OVERRIDE" \
  "$CREATIVE_FACTORY_CODEX_SECRET_OVERRIDE"; do
  case "$creative_factory_secret" in
    *$'\n'* | *$'\r'*)
      echo "Creative Factory secrets must be single-line."
      exit 1
      ;;
  esac
done
if [ "$AI_HOST_INTERNAL_API_SECRET_OVERRIDE_SET" = 'true' ] &&
  [[ ! "$AI_HOST_INTERNAL_API_SECRET_OVERRIDE" =~ [^[:space:]] ]]; then
  echo "AI_HOST_INTERNAL_API_SECRET must be non-empty when supplied."
  exit 1
fi
if [ "$CREATIVE_FACTORY_CODEX_SECRET_OVERRIDE_SET" = 'true' ] &&
  [[ ! "$CREATIVE_FACTORY_CODEX_SECRET_OVERRIDE" =~ [^[:space:]] ]]; then
  echo "CREATIVE_FACTORY_CODEX_SECRET must be non-empty when supplied."
  exit 1
fi
case "$CREATIVE_FACTORY_DUAL_SCENE_AUDIO_URL_OVERRIDE" in
  *$'\n'* | *$'\r'*)
    echo "CREATIVE_FACTORY_DUAL_SCENE_AUDIO_URL must be a single line."
    exit 1
    ;;
esac
if [ "$CREATIVE_FACTORY_DUAL_SCENE_AUDIO_URL_OVERRIDE_SET" = 'true' ] &&
  [[ ! "$CREATIVE_FACTORY_DUAL_SCENE_AUDIO_URL_OVERRIDE" =~ ^https:// ]]; then
  echo "CREATIVE_FACTORY_DUAL_SCENE_AUDIO_URL must be an HTTPS URL when supplied."
  exit 1
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Run this script from the AutoArk git checkout."
  exit 1
fi

if [ -n "$(git status --porcelain)" ] && [ "${AUTOARK_ALLOW_DIRTY:-false}" != "true" ]; then
  echo "Working tree is dirty. Commit or stash local changes first, or set AUTOARK_ALLOW_DIRTY=true."
  exit 1
fi

REMOTE_ENV_UPLOAD_CANDIDATE=''
REMOTE_ENV_UPLOAD_EXPECTED_GENERATION=''
if [ -n "${AUTOARK_ENV_FILE:-}" ]; then
  if [ ! -f "$AUTOARK_ENV_FILE" ]; then
    echo "AUTOARK_ENV_FILE does not exist: $AUTOARK_ENV_FILE"
    exit 1
  fi
  require_command scp
  require_command openssl
  REMOTE_ENV_UPLOAD_EXPECTED_GENERATION="$(openssl rand -hex 32)"
  if [[ ! "$REMOTE_ENV_UPLOAD_EXPECTED_GENERATION" =~ ^[0-9a-f]{64}$ ]]; then
    echo "Failed to generate production environment ownership token."
    exit 1
  fi
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

  read -r -d '' REMOTE_PUBLISH_ENV_UPLOAD_SCRIPT <<'REMOTE_SCRIPT' || true
# AUTOARK_PUBLISH_ENV_UPLOAD_V1
set +x
set -euo pipefail

upload_candidate_path="$1"
upload_pending_path="$2"
deploy_lock_file="$3"
upload_generation="$4"
if [[ ! "$upload_generation" =~ ^[0-9a-f]{64}$ ]]; then
  echo 'Invalid production environment ownership token.'
  exit 1
fi
if ! command -v flock >/dev/null 2>&1; then
  echo 'flock is required for production deployment.'
  exit 1
fi
exec 9>"$deploy_lock_file"
flock -x 9
if [ ! -f "$upload_candidate_path" ]; then
  echo 'Missing staged production environment upload.'
  exit 1
fi
tagged_candidate="$(mktemp "${upload_candidate_path}.tagged.XXXXXX")"
chmod 600 "$tagged_candidate"
printf 'AUTOARK_DEPLOY_UPLOAD_GENERATION=%s\n' "$upload_generation" > "$tagged_candidate"
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    AUTOARK_DEPLOY_UPLOAD_GENERATION=*) ;;
    *) printf '%s\n' "$line" ;;
  esac
done < "$upload_candidate_path" >> "$tagged_candidate"
mv -f -- "$tagged_candidate" "$upload_candidate_path"
mv -f -- "$upload_candidate_path" "$upload_pending_path"
chmod 600 "$upload_pending_path"
REMOTE_SCRIPT

  printf -v QUOTED_REMOTE_PUBLISH_ENV_UPLOAD_SCRIPT '%q' "$REMOTE_PUBLISH_ENV_UPLOAD_SCRIPT"
  printf -v QUOTED_REMOTE_ENV_UPLOAD_STAGE '%q' "$REMOTE_ENV_UPLOAD_STAGE"
  printf -v QUOTED_REMOTE_DEPLOY_LOCK_FILE '%q' "$REMOTE_DEPLOY_LOCK_FILE"
  printf -v QUOTED_REMOTE_ENV_UPLOAD_EXPECTED_GENERATION '%q' "$REMOTE_ENV_UPLOAD_EXPECTED_GENERATION"
  REMOTE_PUBLISH_ENV_UPLOAD_COMMAND="bash -c $QUOTED_REMOTE_PUBLISH_ENV_UPLOAD_SCRIPT -- $QUOTED_REMOTE_ENV_UPLOAD_CANDIDATE $QUOTED_REMOTE_ENV_UPLOAD_STAGE $QUOTED_REMOTE_DEPLOY_LOCK_FILE $QUOTED_REMOTE_ENV_UPLOAD_EXPECTED_GENERATION"
  ssh "$PROD_HOST" "$REMOTE_PUBLISH_ENV_UPLOAD_COMMAND"
  REMOTE_ENV_UPLOAD_CANDIDATE=''
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
expected_upload_generation="$7"
deploy_lock_file="$8"

key_override_set=''
key_override=''
flag_override_set=''
flag_override=''
facebook_sync_override_set=''
facebook_sync_override=''
facebook_aggregation_override_set=''
facebook_aggregation_override=''
facebook_concurrency_override_set=''
facebook_concurrency_override=''
meta_key_override_set=''
meta_key_override=''
ai_ads_key_override_set=''
ai_ads_key_override=''
ai_ads_organization_override_set=''
ai_ads_organization_override=''
ai_host_url_override_set=''
ai_host_url_override=''
ai_host_secret_override_set=''
ai_host_secret_override=''
codex_secret_override_set=''
codex_secret_override=''
dual_scene_audio_url_override_set=''
dual_scene_audio_url_override=''
IFS= read -r -d '' key_override_set
IFS= read -r -d '' key_override
IFS= read -r -d '' flag_override_set
IFS= read -r -d '' flag_override
IFS= read -r -d '' facebook_sync_override_set
IFS= read -r -d '' facebook_sync_override
IFS= read -r -d '' facebook_aggregation_override_set
IFS= read -r -d '' facebook_aggregation_override
IFS= read -r -d '' facebook_concurrency_override_set
IFS= read -r -d '' facebook_concurrency_override
IFS= read -r -d '' meta_key_override_set
IFS= read -r -d '' meta_key_override
IFS= read -r -d '' ai_ads_key_override_set
IFS= read -r -d '' ai_ads_key_override
IFS= read -r -d '' ai_ads_organization_override_set
IFS= read -r -d '' ai_ads_organization_override
IFS= read -r -d '' ai_host_url_override_set
IFS= read -r -d '' ai_host_url_override
IFS= read -r -d '' ai_host_secret_override_set
IFS= read -r -d '' ai_host_secret_override
IFS= read -r -d '' codex_secret_override_set
IFS= read -r -d '' codex_secret_override
IFS= read -r -d '' dual_scene_audio_url_override_set
IFS= read -r -d '' dual_scene_audio_url_override

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
for facebook_boolean_override in \
  "$facebook_sync_override_set:$facebook_sync_override" \
  "$facebook_aggregation_override_set:$facebook_aggregation_override"; do
  case "$facebook_boolean_override" in
    false: | true:true | true:false) ;;
    *)
      echo 'Facebook collection flags must be true or false.'
      exit 1
      ;;
  esac
done
case "$facebook_concurrency_override_set:$facebook_concurrency_override" in
  false: | true:[1-5]) ;;
  *)
    echo 'FACEBOOK_AGGREGATION_CONCURRENCY must be an integer from 1 to 5.'
    exit 1
    ;;
esac
case "$meta_key_override_set" in
  true | false) ;;
  *)
    echo 'Invalid META_CREDENTIAL_ENCRYPTION_KEY override state.'
    exit 1
    ;;
esac
case "$ai_ads_key_override_set:$ai_ads_organization_override_set" in
  false:false | true:true) ;;
  *)
    echo 'AI ads integration key and organization overrides must be supplied together.'
    exit 1
    ;;
esac
case "$key_override" in
  *$'\n'* | *$'\r'*)
    echo 'GUANGDADA_API_KEY must be a single line.'
    exit 1
    ;;
esac
case "$meta_key_override" in
  *$'\n'* | *$'\r'*)
    echo 'META_CREDENTIAL_ENCRYPTION_KEY must be a single line.'
    exit 1
    ;;
esac
if [ "$meta_key_override_set" = 'true' ] &&
  [[ ! "$meta_key_override" =~ [^[:space:]] ]]; then
  echo 'META_CREDENTIAL_ENCRYPTION_KEY must be non-empty when supplied.'
  exit 1
fi
for integration_value in "$ai_ads_key_override" "$ai_ads_organization_override"; do
  case "$integration_value" in
    *$'\n'* | *$'\r'*)
      echo 'AI ads integration values must be single-line.'
      exit 1
      ;;
  esac
done
if [ "$ai_ads_key_override_set" = 'true' ] &&
  { [[ ! "$ai_ads_key_override" =~ [^[:space:]] ]] ||
    [[ ! "$ai_ads_organization_override" =~ [^[:space:]] ]]; }; then
  echo 'AI ads integration key and organization must be non-empty when supplied.'
  exit 1
fi
for override_state in \
  "$ai_host_url_override_set" \
  "$ai_host_secret_override_set" \
  "$codex_secret_override_set" \
  "$dual_scene_audio_url_override_set"; do
  case "$override_state" in
    true | false) ;;
    *)
      echo 'Invalid Creative Factory override state.'
      exit 1
      ;;
  esac
done
case "$ai_host_url_override" in
  *$'\n'* | *$'\r'*)
    echo 'AI_HOST_CREATIVE_FACTORY_URL must be a single line.'
    exit 1
    ;;
esac
if [ "$ai_host_url_override_set" = 'true' ] &&
  [[ ! "$ai_host_url_override" =~ ^https:// ]]; then
  echo 'AI_HOST_CREATIVE_FACTORY_URL must be an HTTPS URL when supplied.'
  exit 1
fi
for secret_override in "$ai_host_secret_override" "$codex_secret_override"; do
  case "$secret_override" in
    *$'\n'* | *$'\r'*)
      echo 'Creative Factory secrets must be single-line.'
      exit 1
      ;;
  esac
done
if [ "$ai_host_secret_override_set" = 'true' ] &&
  [[ ! "$ai_host_secret_override" =~ [^[:space:]] ]]; then
  echo 'AI_HOST_INTERNAL_API_SECRET must be non-empty when supplied.'
  exit 1
fi
if [ "$codex_secret_override_set" = 'true' ] &&
  [[ ! "$codex_secret_override" =~ [^[:space:]] ]]; then
  echo 'CREATIVE_FACTORY_CODEX_SECRET must be non-empty when supplied.'
  exit 1
fi
case "$dual_scene_audio_url_override" in
  *$'\n'* | *$'\r'*)
    echo 'CREATIVE_FACTORY_DUAL_SCENE_AUDIO_URL must be a single line.'
    exit 1
    ;;
esac
if [ "$dual_scene_audio_url_override_set" = 'true' ] &&
  [[ ! "$dual_scene_audio_url_override" =~ ^https:// ]]; then
  echo 'CREATIVE_FACTORY_DUAL_SCENE_AUDIO_URL must be an HTTPS URL when supplied.'
  exit 1
fi

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

if [ -n "$expected_upload_generation" ]; then
  if [[ ! "$expected_upload_generation" =~ ^[0-9a-f]{64}$ ]]; then
    echo 'Invalid expected production environment ownership token.'
    exit 1
  fi
  if [ ! -f "$upload_env_path" ]; then
    echo 'Expected production environment generation is unavailable.'
    exit 1
  fi
  observed_upload_generation=''
  observed_upload_generation_count=0
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      AUTOARK_DEPLOY_UPLOAD_GENERATION=*)
        observed_upload_generation="${line#AUTOARK_DEPLOY_UPLOAD_GENERATION=}"
        observed_upload_generation_count=$((observed_upload_generation_count + 1))
        ;;
    esac
  done < "$upload_env_path"
  if [ "$observed_upload_generation_count" -ne 1 ] ||
    [ "$observed_upload_generation" != "$expected_upload_generation" ]; then
    echo 'Production environment generation ownership changed; refusing deployment.'
    exit 1
  fi
fi

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
source_facebook_sync='false'
source_facebook_aggregation='false'
source_facebook_concurrency='2'
source_meta_key=''
source_ai_ads_key=''
source_ai_ads_organization=''
source_ai_host_url=''
source_ai_host_secret=''
source_codex_secret=''
source_dual_scene_audio_url=''
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    GUANGDADA_API_KEY=*)
      source_key="${line#GUANGDADA_API_KEY=}"
      ;;
    EXTERNAL_MATERIAL_SYNC_ENABLED=*)
      source_flag="${line#EXTERNAL_MATERIAL_SYNC_ENABLED=}"
      ;;
    FACEBOOK_SYNC_ENABLED=*)
      source_facebook_sync="${line#FACEBOOK_SYNC_ENABLED=}"
      ;;
    FACEBOOK_AGGREGATION_ENABLED=*)
      source_facebook_aggregation="${line#FACEBOOK_AGGREGATION_ENABLED=}"
      ;;
    FACEBOOK_AGGREGATION_CONCURRENCY=*)
      source_facebook_concurrency="${line#FACEBOOK_AGGREGATION_CONCURRENCY=}"
      ;;
    META_CREDENTIAL_ENCRYPTION_KEY=*)
      source_meta_key="${line#META_CREDENTIAL_ENCRYPTION_KEY=}"
      ;;
    AI_ADS_INTEGRATION_API_KEY=*)
      source_ai_ads_key="${line#AI_ADS_INTEGRATION_API_KEY=}"
      ;;
    AI_ADS_INTEGRATION_ORGANIZATION_ID=*)
      source_ai_ads_organization="${line#AI_ADS_INTEGRATION_ORGANIZATION_ID=}"
      ;;
    AI_HOST_CREATIVE_FACTORY_URL=*)
      source_ai_host_url="${line#AI_HOST_CREATIVE_FACTORY_URL=}"
      ;;
    AI_HOST_INTERNAL_API_SECRET=*)
      source_ai_host_secret="${line#AI_HOST_INTERNAL_API_SECRET=}"
      ;;
    CREATIVE_FACTORY_CODEX_SECRET=*)
      source_codex_secret="${line#CREATIVE_FACTORY_CODEX_SECRET=}"
      ;;
    CREATIVE_FACTORY_DUAL_SCENE_AUDIO_URL=*)
      source_dual_scene_audio_url="${line#CREATIVE_FACTORY_DUAL_SCENE_AUDIO_URL=}"
      ;;
    AUTOARK_DEPLOY_UPLOAD_GENERATION=*) ;;
    *)
      printf '%s\n' "$line"
      ;;
  esac
done < "$source_env_path" > "$base_payload_temp"

resolved_key="$source_key"
resolved_flag="$source_flag"
resolved_facebook_sync="$source_facebook_sync"
resolved_facebook_aggregation="$source_facebook_aggregation"
resolved_facebook_concurrency="$source_facebook_concurrency"
resolved_meta_key="$source_meta_key"
resolved_ai_ads_key="$source_ai_ads_key"
resolved_ai_ads_organization="$source_ai_ads_organization"
resolved_ai_host_url="$source_ai_host_url"
resolved_ai_host_secret="$source_ai_host_secret"
resolved_codex_secret="$source_codex_secret"
resolved_dual_scene_audio_url="$source_dual_scene_audio_url"
if [ "$key_override_set" = 'true' ]; then
  resolved_key="$key_override"
fi
if [ "$flag_override_set" = 'true' ]; then
  resolved_flag="$flag_override"
fi
if [ "$facebook_sync_override_set" = 'true' ]; then
  resolved_facebook_sync="$facebook_sync_override"
fi
if [ "$facebook_aggregation_override_set" = 'true' ]; then
  resolved_facebook_aggregation="$facebook_aggregation_override"
fi
if [ "$facebook_concurrency_override_set" = 'true' ]; then
  resolved_facebook_concurrency="$facebook_concurrency_override"
fi
if [ "$meta_key_override_set" = 'true' ]; then
  resolved_meta_key="$meta_key_override"
fi
if [ "$ai_ads_key_override_set" = 'true' ]; then
  resolved_ai_ads_key="$ai_ads_key_override"
  resolved_ai_ads_organization="$ai_ads_organization_override"
fi
if [ "$ai_host_url_override_set" = 'true' ]; then
  resolved_ai_host_url="$ai_host_url_override"
fi
if [ "$ai_host_secret_override_set" = 'true' ]; then
  resolved_ai_host_secret="$ai_host_secret_override"
fi
if [ "$codex_secret_override_set" = 'true' ]; then
  resolved_codex_secret="$codex_secret_override"
fi
if [ "$dual_scene_audio_url_override_set" = 'true' ]; then
  resolved_dual_scene_audio_url="$dual_scene_audio_url_override"
fi

case "$resolved_flag" in
  true | false) ;;
  *)
    echo 'EXTERNAL_MATERIAL_SYNC_ENABLED must resolve to true or false.'
    exit 1
    ;;
esac
for resolved_facebook_boolean in \
  "$resolved_facebook_sync" \
  "$resolved_facebook_aggregation"; do
  case "$resolved_facebook_boolean" in
    true | false) ;;
    *)
      echo 'Facebook collection flags must resolve to true or false.'
      exit 1
      ;;
  esac
done
case "$resolved_facebook_concurrency" in
  [1-5]) ;;
  *)
    echo 'FACEBOOK_AGGREGATION_CONCURRENCY must resolve to an integer from 1 to 5.'
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
case "$resolved_meta_key" in
  *$'\n'* | *$'\r'*)
    echo 'META_CREDENTIAL_ENCRYPTION_KEY must resolve to one line.'
    exit 1
    ;;
esac
for integration_value in "$resolved_ai_ads_key" "$resolved_ai_ads_organization"; do
  case "$integration_value" in
    *$'\n'* | *$'\r'*)
      echo 'AI ads integration values must resolve to one line.'
      exit 1
      ;;
  esac
done
if { [[ -n "$resolved_ai_ads_key" ]] || [[ -n "$resolved_ai_ads_organization" ]]; } &&
  { [[ ! "$resolved_ai_ads_key" =~ [^[:space:]] ]] ||
    [[ ! "$resolved_ai_ads_organization" =~ [^[:space:]] ]]; }; then
  echo 'AI ads integration key and organization must both resolve non-empty.'
  exit 1
fi
if [ -n "$resolved_ai_host_url" ] && [[ ! "$resolved_ai_host_url" =~ ^https:// ]]; then
  echo 'AI_HOST_CREATIVE_FACTORY_URL must resolve to an HTTPS URL.'
  exit 1
fi
if [ -n "$resolved_dual_scene_audio_url" ] &&
  [[ ! "$resolved_dual_scene_audio_url" =~ ^https:// ]]; then
  echo 'CREATIVE_FACTORY_DUAL_SCENE_AUDIO_URL must resolve to an HTTPS URL.'
  exit 1
fi
for resolved_secret in "$resolved_ai_host_secret" "$resolved_codex_secret"; do
  case "$resolved_secret" in
    *$'\n'* | *$'\r'*)
      echo 'Creative Factory secrets must resolve to one line.'
      exit 1
      ;;
  esac
done

cat "$base_payload_temp" > "$payload_temp"
printf 'GUANGDADA_API_KEY=%s\n' "$resolved_key" >> "$payload_temp"
printf 'EXTERNAL_MATERIAL_SYNC_ENABLED=%s\n' "$resolved_flag" >> "$payload_temp"
printf 'FACEBOOK_SYNC_ENABLED=%s\n' "$resolved_facebook_sync" >> "$payload_temp"
printf 'FACEBOOK_AGGREGATION_ENABLED=%s\n' "$resolved_facebook_aggregation" >> "$payload_temp"
printf 'FACEBOOK_AGGREGATION_CONCURRENCY=%s\n' "$resolved_facebook_concurrency" >> "$payload_temp"
printf 'META_CREDENTIAL_ENCRYPTION_KEY=%s\n' "$resolved_meta_key" >> "$payload_temp"
printf 'AI_ADS_INTEGRATION_API_KEY=%s\n' "$resolved_ai_ads_key" >> "$payload_temp"
printf 'AI_ADS_INTEGRATION_ORGANIZATION_ID=%s\n' "$resolved_ai_ads_organization" >> "$payload_temp"
printf 'AI_HOST_CREATIVE_FACTORY_URL=%s\n' "$resolved_ai_host_url" >> "$payload_temp"
printf 'AI_HOST_INTERNAL_API_SECRET=%s\n' "$resolved_ai_host_secret" >> "$payload_temp"
printf 'CREATIVE_FACTORY_CODEX_SECRET=%s\n' "$resolved_codex_secret" >> "$payload_temp"
printf 'CREATIVE_FACTORY_DUAL_SCENE_AUDIO_URL=%s\n' "$resolved_dual_scene_audio_url" >> "$payload_temp"
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
printf -v QUOTED_REMOTE_ENV_UPLOAD_EXPECTED_GENERATION '%q' "$REMOTE_ENV_UPLOAD_EXPECTED_GENERATION"
printf -v QUOTED_REMOTE_DEPLOY_LOCK_FILE '%q' "$REMOTE_DEPLOY_LOCK_FILE"
REMOTE_DEPLOY_TRANSACTION_COMMAND="bash -c $QUOTED_REMOTE_DEPLOY_TRANSACTION_SCRIPT -- $QUOTED_APP_DIR $QUOTED_REPO_URL $QUOTED_AUTOARK_REF $QUOTED_REMOTE_ENV_BACKUP $QUOTED_REMOTE_ENV_UPLOAD_STAGE $QUOTED_REMOTE_ENV_UPLOAD_CANDIDATE $QUOTED_REMOTE_ENV_UPLOAD_EXPECTED_GENERATION $QUOTED_REMOTE_DEPLOY_LOCK_FILE"

log "Deploying verified commit=$AUTOARK_REF"
log "Synchronizing GUANGDADA_API_KEY, EXTERNAL_MATERIAL_SYNC_ENABLED, Facebook collection controls, META_CREDENTIAL_ENCRYPTION_KEY, AI ads integration, and Creative Factory values"
printf '%s\0' \
  "$GUANGDADA_API_KEY_OVERRIDE_SET" \
  "$GUANGDADA_API_KEY_OVERRIDE" \
  "$EXTERNAL_MATERIAL_SYNC_ENABLED_OVERRIDE_SET" \
  "$EXTERNAL_MATERIAL_SYNC_ENABLED_OVERRIDE" \
  "$FACEBOOK_SYNC_ENABLED_OVERRIDE_SET" \
  "$FACEBOOK_SYNC_ENABLED_OVERRIDE" \
  "$FACEBOOK_AGGREGATION_ENABLED_OVERRIDE_SET" \
  "$FACEBOOK_AGGREGATION_ENABLED_OVERRIDE" \
  "$FACEBOOK_AGGREGATION_CONCURRENCY_OVERRIDE_SET" \
  "$FACEBOOK_AGGREGATION_CONCURRENCY_OVERRIDE" \
  "$META_CREDENTIAL_ENCRYPTION_KEY_OVERRIDE_SET" \
  "$META_CREDENTIAL_ENCRYPTION_KEY_OVERRIDE" \
  "$AI_ADS_INTEGRATION_API_KEY_OVERRIDE_SET" \
  "$AI_ADS_INTEGRATION_API_KEY_OVERRIDE" \
  "$AI_ADS_INTEGRATION_ORGANIZATION_ID_OVERRIDE_SET" \
  "$AI_ADS_INTEGRATION_ORGANIZATION_ID_OVERRIDE" \
  "$AI_HOST_CREATIVE_FACTORY_URL_OVERRIDE_SET" \
  "$AI_HOST_CREATIVE_FACTORY_URL_OVERRIDE" \
  "$AI_HOST_INTERNAL_API_SECRET_OVERRIDE_SET" \
  "$AI_HOST_INTERNAL_API_SECRET_OVERRIDE" \
  "$CREATIVE_FACTORY_CODEX_SECRET_OVERRIDE_SET" \
  "$CREATIVE_FACTORY_CODEX_SECRET_OVERRIDE" \
  "$CREATIVE_FACTORY_DUAL_SCENE_AUDIO_URL_OVERRIDE_SET" \
  "$CREATIVE_FACTORY_DUAL_SCENE_AUDIO_URL_OVERRIDE" |
  ssh "$PROD_HOST" "$REMOTE_DEPLOY_TRANSACTION_COMMAND"

if [ "${AUTOARK_SKIP_VERIFY:-false}" != "true" ]; then
  log "Running production verification"
  "$(dirname "$0")/verify-production.sh"
fi

log "Deployment complete"
