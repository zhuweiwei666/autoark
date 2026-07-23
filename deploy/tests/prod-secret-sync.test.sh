#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_DIR"' EXIT

FAKE_BIN="$TEST_DIR/bin"
ROOT_ENV="$TEST_DIR/root.env"
APP_DIR="$TEST_DIR/app"
DEPLOY_ENV="$APP_DIR/deploy/.env"
SSH_ARG_LOG="$TEST_DIR/ssh-args.log"
REMOTE_ORDER_LOG="$TEST_DIR/remote-order.log"
mkdir -p "$FAKE_BIN" "$(dirname "$DEPLOY_ENV")" "$APP_DIR/.git"

cat > "$FAKE_BIN/git" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  rev-parse | status)
    exit 0
    ;;
  clone)
    target_path="$3"
    if [ -d "$target_path" ] && [ -n "$(ls -A "$target_path")" ]; then
      echo 'fatal: destination path already exists and is not an empty directory' >&2
      exit 128
    fi
    mkdir -p "$target_path/.git" "$target_path/deploy"
    cat > "$target_path/deploy/server-deploy.sh" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
printf 'server-deploy-executed\n' >> "$REMOTE_ORDER_LOG"
SCRIPT
    chmod +x "$target_path/deploy/server-deploy.sh"
    exit 0
    ;;
  show-ref)
    exit 0
    ;;
esac
exit 0
EOF

cat > "$FAKE_BIN/ssh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$SSH_ARG_LOG"
shift
remote_command="${1:-}"
case "$remote_command" in
  *AUTOARK_PREPARE_DEPLOY_V1*)
    printf 'prepare\n' >> "$REMOTE_ORDER_LOG"
    ;;
  *AUTOARK_SECRET_SYNC_V1*)
    printf 'secret-sync\n' >> "$REMOTE_ORDER_LOG"
    ;;
  *AUTOARK_SERVER_DEPLOY_V1*)
    printf 'server-command\n' >> "$REMOTE_ORDER_LOG"
    ;;
esac
bash -c "$remote_command"
EOF

cat > "$FAKE_BIN/scp" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = '-q' ]; then
  shift
fi
source_path="$1"
remote_path="${2#*:}"
cp "$source_path" "$remote_path"
EOF

chmod +x "$FAKE_BIN/git" "$FAKE_BIN/ssh" "$FAKE_BIN/scp"

cat > "$APP_DIR/deploy/server-deploy.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'server-deploy-executed\n' >> "$REMOTE_ORDER_LOG"
EOF
chmod +x "$APP_DIR/deploy/server-deploy.sh"

cat > "$ROOT_ENV" <<'EOF'
MONGO_URI=mongodb://root-example
GUANGDADA_API_KEY=old-root-value
EXTERNAL_MATERIAL_SYNC_ENABLED=false
GUANGDADA_API_KEY=stale-root-duplicate
ROOT_ONLY=preserved
EOF

cat > "$DEPLOY_ENV" <<'EOF'
MONGO_URI=mongodb://deploy-example
GUANGDADA_API_KEY=old-deploy-value
EXTERNAL_MATERIAL_SYNC_ENABLED=false
EXTERNAL_MATERIAL_SYNC_ENABLED=false
DEPLOY_ONLY=preserved
EOF

run_deploy() {
  env \
    PATH="$FAKE_BIN:$PATH" \
    SSH_ARG_LOG="$SSH_ARG_LOG" \
    REMOTE_ORDER_LOG="$REMOTE_ORDER_LOG" \
    PROD_HOST=unit-test-host \
    APP_DIR="$APP_DIR" \
    REMOTE_ENV_BACKUP="$ROOT_ENV" \
    AUTOARK_ALLOW_DIRTY=true \
    AUTOARK_SKIP_VERIFY=true \
    "$@" \
    bash "$REPO_ROOT/deploy/prod-deploy.sh"
}

SECRET_SENTINEL='SENSITIVE_VALUE_SHOULD_STAY_STDIN_ONLY'
output="$(
  run_deploy \
    GUANGDADA_API_KEY="$SECRET_SENTINEL" \
    EXTERNAL_MATERIAL_SYNC_ENABLED=true
)"

for env_file in "$ROOT_ENV" "$DEPLOY_ENV"; do
  test "$(grep -c '^GUANGDADA_API_KEY=' "$env_file")" -eq 1
  test "$(grep -c '^EXTERNAL_MATERIAL_SYNC_ENABLED=' "$env_file")" -eq 1
  grep -qx "GUANGDADA_API_KEY=$SECRET_SENTINEL" "$env_file"
  grep -qx 'EXTERNAL_MATERIAL_SYNC_ENABLED=true' "$env_file"
  test "$(stat -f '%Lp' "$env_file" 2>/dev/null || stat -c '%a' "$env_file")" = '600'
done

grep -qx 'ROOT_ONLY=preserved' "$ROOT_ENV"
grep -qx 'DEPLOY_ONLY=preserved' "$DEPLOY_ENV"
if grep -Fq "$SECRET_SENTINEL" "$SSH_ARG_LOG"; then
  echo 'provider key reached ssh command-line arguments'
  exit 1
fi
if grep -Fq "$SECRET_SENTINEL" <<<"$output"; then
  echo 'provider key reached deploy logs'
  exit 1
fi
grep -Fq 'GUANGDADA_API_KEY' <<<"$output"
grep -Fq 'EXTERNAL_MATERIAL_SYNC_ENABLED' <<<"$output"

TRACE_SENTINEL='TRACE_MODE_MUST_NOT_PRINT_THIS_VALUE'
env \
  PATH="$FAKE_BIN:$PATH" \
  SSH_ARG_LOG="$SSH_ARG_LOG" \
  REMOTE_ORDER_LOG="$REMOTE_ORDER_LOG" \
  PROD_HOST=unit-test-host \
  APP_DIR="$APP_DIR" \
  REMOTE_ENV_BACKUP="$ROOT_ENV" \
  AUTOARK_ALLOW_DIRTY=true \
  AUTOARK_SKIP_VERIFY=true \
  GUANGDADA_API_KEY="$TRACE_SENTINEL" \
  EXTERNAL_MATERIAL_SYNC_ENABLED=true \
  bash -x "$REPO_ROOT/deploy/prod-deploy.sh" >"$TEST_DIR/trace.log" 2>&1
if grep -Fq "$TRACE_SENTINEL" "$TEST_DIR/trace.log"; then
  echo 'provider key leaked when shell tracing was requested'
  exit 1
fi

if run_deploy \
  GUANGDADA_API_KEY='' \
  EXTERNAL_MATERIAL_SYNC_ENABLED=true >"$TEST_DIR/missing-key.log" 2>&1; then
  echo 'enabled external sync accepted an empty provider key'
  exit 1
fi
if grep -Eq 'SENSITIVE|old-root|old-deploy' "$TEST_DIR/missing-key.log"; then
  echo 'missing-key failure leaked a value'
  exit 1
fi

if run_deploy \
  GUANGDADA_API_KEY='another-placeholder' \
  EXTERNAL_MATERIAL_SYNC_ENABLED=yes >"$TEST_DIR/invalid-flag.log" 2>&1; then
  echo 'external sync accepted a non-boolean feature flag'
  exit 1
fi
if grep -Fq 'another-placeholder' "$TEST_DIR/invalid-flag.log"; then
  echo 'invalid-flag failure leaked the provider key'
  exit 1
fi

MULTILINE_PLACEHOLDER=$'placeholder-line\nINJECTED_ENTRY=must-not-appear'
if run_deploy \
  GUANGDADA_API_KEY="$MULTILINE_PLACEHOLDER" \
  EXTERNAL_MATERIAL_SYNC_ENABLED=true >"$TEST_DIR/multiline-key.log" 2>&1; then
  echo 'external sync accepted a multiline provider key'
  exit 1
fi
if grep -Fq 'INJECTED_ENTRY' "$ROOT_ENV" "$DEPLOY_ENV"; then
  echo 'multiline provider key injected an environment entry'
  exit 1
fi
if grep -Fq 'must-not-appear' "$TEST_DIR/multiline-key.log"; then
  echo 'multiline-key failure leaked the provider key'
  exit 1
fi

run_deploy \
  GUANGDADA_API_KEY='' \
  EXTERNAL_MATERIAL_SYNC_ENABLED=false >"$TEST_DIR/disabled.log"

FULL_ENV="$TEST_DIR/full-upload.env"
cat > "$FULL_ENV" <<'EOF'
MONGO_URI=mongodb://uploaded-example
UPLOAD_ONLY=preserved
GUANGDADA_API_KEY=old-uploaded-placeholder
EXTERNAL_MATERIAL_SYNC_ENABLED=false
EOF
run_deploy \
  AUTOARK_ENV_FILE="$FULL_ENV" \
  GUANGDADA_API_KEY='rotated-placeholder' \
  EXTERNAL_MATERIAL_SYNC_ENABLED=true >"$TEST_DIR/full-upload.log"
grep -qx 'UPLOAD_ONLY=preserved' "$ROOT_ENV"
grep -qx 'GUANGDADA_API_KEY=rotated-placeholder' "$ROOT_ENV"
grep -qx 'EXTERNAL_MATERIAL_SYNC_ENABLED=true' "$ROOT_ENV"
test "$(stat -f '%Lp' "$ROOT_ENV" 2>/dev/null || stat -c '%a' "$ROOT_ENV")" = '600'
grep -qx 'UPLOAD_ONLY=preserved' "$DEPLOY_ENV"
grep -qx 'GUANGDADA_API_KEY=rotated-placeholder' "$DEPLOY_ENV"
grep -qx 'EXTERNAL_MATERIAL_SYNC_ENABLED=true' "$DEPLOY_ENV"
if grep -Fq 'DEPLOY_ONLY=preserved' "$DEPLOY_ENV"; then
  echo 'full environment rotation preserved a stale runtime-only entry'
  exit 1
fi
test "$(stat -f '%Lp' "$DEPLOY_ENV" 2>/dev/null || stat -c '%a' "$DEPLOY_ENV")" = '600'

rm -rf "$APP_DIR"
: > "$REMOTE_ORDER_LOG"
cat > "$ROOT_ENV" <<'EOF'
MONGO_URI=mongodb://cold-start-example
COLD_START_ONLY=preserved
GUANGDADA_API_KEY=old-cold-start-placeholder
EXTERNAL_MATERIAL_SYNC_ENABLED=false
EOF
run_deploy \
  GUANGDADA_API_KEY='cold-start-placeholder' \
  EXTERNAL_MATERIAL_SYNC_ENABLED=true >"$TEST_DIR/cold-start.log"
test -d "$APP_DIR/.git"
grep -qx 'COLD_START_ONLY=preserved' "$DEPLOY_ENV"
grep -qx 'GUANGDADA_API_KEY=cold-start-placeholder' "$DEPLOY_ENV"
test "$(stat -f '%Lp' "$DEPLOY_ENV" 2>/dev/null || stat -c '%a' "$DEPLOY_ENV")" = '600'
expected_order=$'prepare\nsecret-sync\nserver-command\nserver-deploy-executed'
test "$(cat "$REMOTE_ORDER_LOG")" = "$expected_order"

echo 'prod secret sync tests passed'
