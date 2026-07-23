#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_DIR"' EXIT
trap 'echo "prod secret sync test failed at line $LINENO" >&2' ERR

FAKE_BIN="$TEST_DIR/bin"
ROOT_ENV="$TEST_DIR/root.env"
APP_DIR="$TEST_DIR/app"
DEPLOY_ENV="$APP_DIR/deploy/.env"
SSH_ARG_LOG="$TEST_DIR/ssh-args.log"
SCP_REMOTE_LOG="$TEST_DIR/scp-remote.log"
REMOTE_ORDER_LOG="$TEST_DIR/remote-order.log"
VERIFIED_SHA='1111111111111111111111111111111111111111'
mkdir -p "$FAKE_BIN"

cat > "$FAKE_BIN/git" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

write_fake_server_deploy() {
  local target_path="$1"
  mkdir -p "$target_path/deploy"
  cat > "$target_path/deploy/server-deploy.sh" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
if [ -n "${FAIL_SERVER_DEPLOY_ONCE_FILE:-}" ] &&
  [ ! -e "$FAIL_SERVER_DEPLOY_ONCE_FILE" ]; then
  : > "$FAIL_SERVER_DEPLOY_ONCE_FILE"
  printf 'server-deploy-failed\n' >> "$REMOTE_ORDER_LOG"
  exit 91
fi
printf 'server-deploy-executed\n' >> "$REMOTE_ORDER_LOG"
SCRIPT
  chmod +x "$target_path/deploy/server-deploy.sh"
}

case "${1:-}" in
  rev-parse)
    if [ "${2:-}" = '--is-inside-work-tree' ]; then
      exit 0
    fi
    printf '%s\n' "${AUTOARK_REF:-1111111111111111111111111111111111111111}"
    exit 0
    ;;
  status)
    exit 0
    ;;
  clone)
    target_path="$3"
    if [ -d "$target_path" ] && [ -n "$(ls -A "$target_path")" ]; then
      echo 'fatal: destination path already exists and is not an empty directory' >&2
      exit 128
    fi
    mkdir -p "$target_path/.git"
    write_fake_server_deploy "$target_path"
    exit 0
    ;;
  fetch)
    if [ -n "${FAIL_PREPARE_ONCE_FILE:-}" ] &&
      [ ! -e "$FAIL_PREPARE_ONCE_FILE" ]; then
      : > "$FAIL_PREPARE_ONCE_FILE"
      printf 'checkout-failed\n' >> "$REMOTE_ORDER_LOG"
      exit 92
    fi
    printf 'checkout\n' >> "$REMOTE_ORDER_LOG"
    exit 0
    ;;
  show-ref | checkout | pull | cat-file | merge-base)
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
  *AUTOARK_PUBLISH_ENV_UPLOAD_V1*)
    bash -c "$remote_command"
    if [ -n "${FAIL_AFTER_UPLOAD_PUBLISH_ONCE_FILE:-}" ] &&
      [ ! -e "$FAIL_AFTER_UPLOAD_PUBLISH_ONCE_FILE" ]; then
      : > "$FAIL_AFTER_UPLOAD_PUBLISH_ONCE_FILE"
      exit 96
    fi
    exit 0
    ;;
  *AUTOARK_DEPLOY_TRANSACTION_V1*)
    printf 'remote-session\n' >> "$REMOTE_ORDER_LOG"
    ;;
  *AUTOARK_PREPARE_DEPLOY_V1*)
    printf 'legacy-prepare-session\n' >> "$REMOTE_ORDER_LOG"
    ;;
  *AUTOARK_SECRET_SYNC_V1*)
    printf 'legacy-secret-session\n' >> "$REMOTE_ORDER_LOG"
    ;;
  *AUTOARK_SERVER_DEPLOY_V1*)
    printf 'legacy-server-session\n' >> "$REMOTE_ORDER_LOG"
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
printf '%s\n' "$remote_path" >> "$SCP_REMOTE_LOG"
if [ -n "${FAIL_SCP_ONCE_FILE:-}" ] && [ ! -e "$FAIL_SCP_ONCE_FILE" ]; then
  : > "$FAIL_SCP_ONCE_FILE"
  printf 'PARTIAL_UPLOAD=must-not-become-canonical\n' > "$remote_path"
  exit 93
fi
cp "$source_path" "$remote_path"
EOF

cat > "$FAKE_BIN/flock" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'lock-acquired\n' >> "$REMOTE_ORDER_LOG"
exit 0
EOF

cat > "$FAKE_BIN/mv" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
filtered=()
for argument in "$@"; do
  case "$argument" in
    -f | --) ;;
    *) filtered+=("$argument") ;;
  esac
done
destination="${filtered[${#filtered[@]} - 1]}"

if [ -n "${FAIL_MARKER_COMMIT_ONCE_FILE:-}" ] &&
  [[ "$destination" == *.external-sync.pending ]] &&
  [ ! -e "$FAIL_MARKER_COMMIT_ONCE_FILE" ]; then
  : > "$FAIL_MARKER_COMMIT_ONCE_FILE"
  exit 94
fi

if [ "$destination" = "$ROOT_ENV_PATH" ]; then
  printf 'commit-root\n' >> "$REMOTE_ORDER_LOG"
elif [ "$destination" = "$DEPLOY_ENV_PATH" ]; then
  printf 'commit-runtime\n' >> "$REMOTE_ORDER_LOG"
fi

if [ -n "${FAIL_COMMIT_TARGET:-}" ] &&
  [ "$destination" = "$FAIL_COMMIT_TARGET" ] &&
  [ -n "${FAIL_COMMIT_ONCE_FILE:-}" ] &&
  [ ! -e "$FAIL_COMMIT_ONCE_FILE" ]; then
  : > "$FAIL_COMMIT_ONCE_FILE"
  exit 95
fi

exec /bin/mv "$@"
EOF

chmod +x "$FAKE_BIN/git" "$FAKE_BIN/ssh" "$FAKE_BIN/scp" \
  "$FAKE_BIN/flock" "$FAKE_BIN/mv"

write_fake_server_deploy() {
  mkdir -p "$APP_DIR/.git" "$APP_DIR/deploy"
  cat > "$APP_DIR/deploy/server-deploy.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [ -n "${FAIL_SERVER_DEPLOY_ONCE_FILE:-}" ] &&
  [ ! -e "$FAIL_SERVER_DEPLOY_ONCE_FILE" ]; then
  : > "$FAIL_SERVER_DEPLOY_ONCE_FILE"
  printf 'server-deploy-failed\n' >> "$REMOTE_ORDER_LOG"
  exit 91
fi
printf 'server-deploy-executed\n' >> "$REMOTE_ORDER_LOG"
EOF
  chmod +x "$APP_DIR/deploy/server-deploy.sh"
}

seed_pair() {
  local root_marker="$1"
  local runtime_marker="$2"
  write_fake_server_deploy
  cat > "$ROOT_ENV" <<EOF
MONGO_URI=mongodb://canonical-example
$root_marker
GUANGDADA_API_KEY=old-canonical-placeholder
EXTERNAL_MATERIAL_SYNC_ENABLED=false
EOF
  cat > "$DEPLOY_ENV" <<EOF
MONGO_URI=mongodb://runtime-example
$runtime_marker
GUANGDADA_API_KEY=old-runtime-placeholder
EXTERNAL_MATERIAL_SYNC_ENABLED=false
EOF
  chmod 600 "$ROOT_ENV" "$DEPLOY_ENV"
}

file_mode() {
  stat -f '%Lp' "$1" 2>/dev/null || stat -c '%a' "$1"
}

assert_consistent_pair() {
  cmp -s "$ROOT_ENV" "$DEPLOY_ENV"
  test "$(file_mode "$ROOT_ENV")" = '600'
  test "$(file_mode "$DEPLOY_ENV")" = '600'
  test "$(grep -c '^GUANGDADA_API_KEY=' "$ROOT_ENV")" -eq 1
  test "$(grep -c '^EXTERNAL_MATERIAL_SYNC_ENABLED=' "$ROOT_ENV")" -eq 1
}

run_deploy() {
  env \
    -u GUANGDADA_API_KEY \
    -u EXTERNAL_MATERIAL_SYNC_ENABLED \
    PATH="$FAKE_BIN:$PATH" \
    SSH_ARG_LOG="$SSH_ARG_LOG" \
    SCP_REMOTE_LOG="$SCP_REMOTE_LOG" \
    REMOTE_ORDER_LOG="$REMOTE_ORDER_LOG" \
    ROOT_ENV_PATH="$ROOT_ENV" \
    DEPLOY_ENV_PATH="$DEPLOY_ENV" \
    PROD_HOST=unit-test-host \
    APP_DIR="$APP_DIR" \
    REMOTE_ENV_BACKUP="$ROOT_ENV" \
    AUTOARK_REF="$VERIFIED_SHA" \
    AUTOARK_ALLOW_DIRTY=true \
    AUTOARK_SKIP_VERIFY=true \
    "$@" \
    bash "$REPO_ROOT/deploy/prod-deploy.sh"
}

reset_observation_logs() {
  : > "$SSH_ARG_LOG"
  : > "$SCP_REMOTE_LOG"
  : > "$REMOTE_ORDER_LOG"
}

make_full_env() {
  local target_path="$1"
  local marker="$2"
  cat > "$target_path" <<EOF
MONGO_URI=mongodb://uploaded-example
$marker
GUANGDADA_API_KEY=file-owned-placeholder
EXTERNAL_MATERIAL_SYNC_ENABLED=true
EOF
}

# One locked remote transaction must select the canonical backup as source,
# rewrite both named entries together, converge both files, then deploy.
seed_pair 'CANONICAL_ONLY=preserved' 'STALE_RUNTIME_ONLY=must-disappear'
reset_observation_logs
SECRET_SENTINEL='SENSITIVE_VALUE_SHOULD_STAY_STDIN_ONLY'
output="$(
  run_deploy \
    GUANGDADA_API_KEY="$SECRET_SENTINEL" \
    EXTERNAL_MATERIAL_SYNC_ENABLED=true
)"
assert_consistent_pair
grep -qx 'CANONICAL_ONLY=preserved' "$ROOT_ENV"
if grep -Fq 'STALE_RUNTIME_ONLY' "$ROOT_ENV"; then
  echo 'runtime drift survived canonical reconciliation'
  exit 1
fi
grep -qx "GUANGDADA_API_KEY=$SECRET_SENTINEL" "$ROOT_ENV"
grep -qx 'EXTERNAL_MATERIAL_SYNC_ENABLED=true' "$ROOT_ENV"
test "$(grep -c '^commit-root$' "$REMOTE_ORDER_LOG")" -eq 1
test "$(grep -c '^commit-runtime$' "$REMOTE_ORDER_LOG")" -eq 1
expected_order=$'remote-session\nlock-acquired\ncheckout\ncommit-root\ncommit-runtime\nserver-deploy-executed'
test "$(cat "$REMOTE_ORDER_LOG")" = "$expected_order"
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

# Local validation remains strict and must not leak under tracing.
if run_deploy \
  GUANGDADA_API_KEY='' \
  EXTERNAL_MATERIAL_SYNC_ENABLED=true >"$TEST_DIR/missing-key.log" 2>&1; then
  echo 'enabled external sync accepted an empty provider key'
  exit 1
fi
if run_deploy \
  GUANGDADA_API_KEY='invalid-flag-placeholder' \
  EXTERNAL_MATERIAL_SYNC_ENABLED=yes >"$TEST_DIR/invalid-flag.log" 2>&1; then
  echo 'external sync accepted a non-boolean feature flag'
  exit 1
fi
if grep -Fq 'invalid-flag-placeholder' "$TEST_DIR/invalid-flag.log"; then
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
if grep -Fq 'must-not-appear' "$TEST_DIR/multiline-key.log"; then
  echo 'multiline-key failure leaked the provider key'
  exit 1
fi
TRACE_SENTINEL='TRACE_MODE_MUST_NOT_PRINT_THIS_VALUE'
env \
  -u GUANGDADA_API_KEY \
  -u EXTERNAL_MATERIAL_SYNC_ENABLED \
  PATH="$FAKE_BIN:$PATH" \
  SSH_ARG_LOG="$SSH_ARG_LOG" \
  SCP_REMOTE_LOG="$SCP_REMOTE_LOG" \
  REMOTE_ORDER_LOG="$REMOTE_ORDER_LOG" \
  ROOT_ENV_PATH="$ROOT_ENV" \
  DEPLOY_ENV_PATH="$DEPLOY_ENV" \
  PROD_HOST=unit-test-host \
  APP_DIR="$APP_DIR" \
  REMOTE_ENV_BACKUP="$ROOT_ENV" \
  AUTOARK_REF="$VERIFIED_SHA" \
  AUTOARK_ALLOW_DIRTY=true \
  AUTOARK_SKIP_VERIFY=true \
  GUANGDADA_API_KEY="$TRACE_SENTINEL" \
  EXTERNAL_MATERIAL_SYNC_ENABLED=true \
  bash -x "$REPO_ROOT/deploy/prod-deploy.sh" >"$TEST_DIR/trace.log" 2>&1
if grep -Fq "$TRACE_SENTINEL" "$TEST_DIR/trace.log"; then
  echo 'provider key leaked when shell tracing was requested'
  exit 1
fi

# A full env file is staged away from the canonical path. With no explicit
# external overrides, its valid key and flag remain authoritative.
seed_pair 'OLD_CANONICAL=must-disappear' 'OLD_RUNTIME=must-disappear'
reset_observation_logs
FULL_ENV="$TEST_DIR/full-upload.env"
make_full_env "$FULL_ENV" 'UPLOAD_ONLY=preserved'
run_deploy AUTOARK_ENV_FILE="$FULL_ENV" >"$TEST_DIR/full-upload.log"
assert_consistent_pair
grep -qx 'UPLOAD_ONLY=preserved' "$ROOT_ENV"
grep -qx 'GUANGDADA_API_KEY=file-owned-placeholder' "$ROOT_ENV"
grep -qx 'EXTERNAL_MATERIAL_SYNC_ENABLED=true' "$ROOT_ENV"
if grep -Eq 'OLD_CANONICAL|OLD_RUNTIME' "$ROOT_ENV"; then
  echo 'full environment rotation retained stale configuration'
  exit 1
fi
if grep -qx "$ROOT_ENV" "$SCP_REMOTE_LOG"; then
  echo 'full environment file overwrote the canonical path directly'
  exit 1
fi

# An interrupted scp may corrupt only its disposable upload temp, never the
# canonical pair. An ordinary retry converges from the old canonical source.
seed_pair 'SCP_OLD=preserved' 'SCP_RUNTIME_OLD=must-disappear'
cp "$ROOT_ENV" "$DEPLOY_ENV"
chmod 600 "$DEPLOY_ENV"
reset_observation_logs
make_full_env "$FULL_ENV" 'SCP_NEW=must-not-commit'
SCP_FAILURE="$TEST_DIR/scp-failed"
if run_deploy \
  AUTOARK_ENV_FILE="$FULL_ENV" \
  FAIL_SCP_ONCE_FILE="$SCP_FAILURE" >"$TEST_DIR/scp-failure.log" 2>&1; then
  echo 'injected scp interruption unexpectedly succeeded'
  exit 1
fi
grep -qx 'SCP_OLD=preserved' "$ROOT_ENV"
assert_consistent_pair
if grep -Fq 'PARTIAL_UPLOAD' "$ROOT_ENV"; then
  echo 'partial upload replaced the canonical environment'
  exit 1
fi
run_deploy >"$TEST_DIR/scp-retry.log"
assert_consistent_pair
grep -qx 'SCP_OLD=preserved' "$ROOT_ENV"

# An interruption after upload validation but before the deployment transaction
# must leave a stable pending file, not an undiscoverable unique candidate.
seed_pair 'PUBLISH_OLD=preserved' 'PUBLISH_OLD=preserved'
cp "$ROOT_ENV" "$DEPLOY_ENV"
chmod 600 "$DEPLOY_ENV"
reset_observation_logs
make_full_env "$FULL_ENV" 'PUBLISH_NEW=preserved'
PUBLISH_FAILURE="$TEST_DIR/publish-failed"
if run_deploy \
  AUTOARK_ENV_FILE="$FULL_ENV" \
  FAIL_AFTER_UPLOAD_PUBLISH_ONCE_FILE="$PUBLISH_FAILURE" >"$TEST_DIR/publish-failure.log" 2>&1; then
  echo 'injected post-publish interruption unexpectedly succeeded'
  exit 1
fi
PENDING_ENV="${ROOT_ENV}.upload-pending"
test -f "$PENDING_ENV"
if compgen -G "${PENDING_ENV}.uploading.*" >/dev/null; then
  echo 'post-publish interruption left an orphan upload candidate'
  exit 1
fi
assert_consistent_pair
grep -qx 'PUBLISH_OLD=preserved' "$ROOT_ENV"
run_deploy >"$TEST_DIR/publish-retry.log"
assert_consistent_pair
grep -qx 'PUBLISH_NEW=preserved' "$ROOT_ENV"
test ! -e "$PENDING_ENV"

# Prepare failure after a successful upload leaves the old pair untouched.
# A plain retry consumes the pending upload and converges both files.
seed_pair 'PREPARE_OLD=preserved' 'PREPARE_RUNTIME_OLD=must-disappear'
cp "$ROOT_ENV" "$DEPLOY_ENV"
chmod 600 "$DEPLOY_ENV"
reset_observation_logs
make_full_env "$FULL_ENV" 'PREPARE_NEW=preserved'
PREPARE_FAILURE="$TEST_DIR/prepare-failed"
if run_deploy \
  AUTOARK_ENV_FILE="$FULL_ENV" \
  FAIL_PREPARE_ONCE_FILE="$PREPARE_FAILURE" >"$TEST_DIR/prepare-failure.log" 2>&1; then
  echo 'injected prepare interruption unexpectedly succeeded'
  exit 1
fi
assert_consistent_pair
grep -qx 'PREPARE_OLD=preserved' "$ROOT_ENV"
run_deploy >"$TEST_DIR/prepare-retry.log"
assert_consistent_pair
grep -qx 'PREPARE_NEW=preserved' "$ROOT_ENV"

# Secret-sync interruption before the pair commit and a failure between the two
# commits must both roll back or leave a recoverable marker. Plain retry applies
# the staged full env and restores a consistent pair.
seed_pair 'SYNC_OLD=preserved' 'SYNC_RUNTIME_OLD=must-disappear'
cp "$ROOT_ENV" "$DEPLOY_ENV"
chmod 600 "$DEPLOY_ENV"
reset_observation_logs
make_full_env "$FULL_ENV" 'SYNC_NEW=preserved'
MARKER_FAILURE="$TEST_DIR/marker-failed"
if run_deploy \
  AUTOARK_ENV_FILE="$FULL_ENV" \
  FAIL_MARKER_COMMIT_ONCE_FILE="$MARKER_FAILURE" >"$TEST_DIR/marker-failure.log" 2>&1; then
  echo 'injected secret-sync interruption unexpectedly succeeded'
  exit 1
fi
grep -qx 'SYNC_OLD=preserved' "$ROOT_ENV"
assert_consistent_pair
run_deploy >"$TEST_DIR/marker-retry.log"
assert_consistent_pair
grep -qx 'SYNC_NEW=preserved' "$ROOT_ENV"

seed_pair 'COMMIT_OLD=preserved' 'COMMIT_OLD=preserved'
cp "$ROOT_ENV" "$DEPLOY_ENV"
chmod 600 "$DEPLOY_ENV"
reset_observation_logs
make_full_env "$FULL_ENV" 'COMMIT_NEW=preserved'
COMMIT_FAILURE="$TEST_DIR/commit-failed"
if run_deploy \
  AUTOARK_ENV_FILE="$FULL_ENV" \
  FAIL_COMMIT_TARGET="$DEPLOY_ENV" \
  FAIL_COMMIT_ONCE_FILE="$COMMIT_FAILURE" >"$TEST_DIR/commit-failure.log" 2>&1; then
  echo 'injected runtime commit interruption unexpectedly succeeded'
  exit 1
fi
if ! cmp -s "$ROOT_ENV" "$DEPLOY_ENV"; then
  echo 'commit rollback left pair inconsistent' >&2
  sed 's/^/root: /' "$ROOT_ENV" >&2
  sed 's/^/runtime: /' "$DEPLOY_ENV" >&2
  sed 's/^/log: /' "$TEST_DIR/commit-failure.log" >&2
  exit 1
fi
assert_consistent_pair
grep -qx 'COMMIT_OLD=preserved' "$ROOT_ENV"
run_deploy >"$TEST_DIR/commit-retry.log"
assert_consistent_pair
grep -qx 'COMMIT_NEW=preserved' "$ROOT_ENV"

# A deployment failure after pair commit rolls the old pair back. The pending
# upload remains recoverable and a normal retry converges before redeploying.
seed_pair 'DEPLOY_OLD=preserved' 'DEPLOY_OLD=preserved'
cp "$ROOT_ENV" "$DEPLOY_ENV"
chmod 600 "$DEPLOY_ENV"
reset_observation_logs
make_full_env "$FULL_ENV" 'DEPLOY_NEW=preserved'
DEPLOY_FAILURE="$TEST_DIR/server-deploy-failed"
if run_deploy \
  AUTOARK_ENV_FILE="$FULL_ENV" \
  FAIL_SERVER_DEPLOY_ONCE_FILE="$DEPLOY_FAILURE" >"$TEST_DIR/deploy-failure.log" 2>&1; then
  echo 'injected server deployment failure unexpectedly succeeded'
  exit 1
fi
assert_consistent_pair
grep -qx 'DEPLOY_OLD=preserved' "$ROOT_ENV"
run_deploy >"$TEST_DIR/deploy-retry.log"
assert_consistent_pair
grep -qx 'DEPLOY_NEW=preserved' "$ROOT_ENV"

# Cold start clones before any runtime env mutation and still runs inside the
# same lock/session through secret synchronization and server deployment.
rm -rf "$APP_DIR"
cat > "$ROOT_ENV" <<'EOF'
MONGO_URI=mongodb://cold-start-example
COLD_START_ONLY=preserved
GUANGDADA_API_KEY=cold-file-placeholder
EXTERNAL_MATERIAL_SYNC_ENABLED=false
EOF
chmod 600 "$ROOT_ENV"
reset_observation_logs
run_deploy \
  GUANGDADA_API_KEY='cold-override-placeholder' \
  EXTERNAL_MATERIAL_SYNC_ENABLED=true >"$TEST_DIR/cold-start.log"
test -d "$APP_DIR/.git"
assert_consistent_pair
grep -qx 'COLD_START_ONLY=preserved' "$ROOT_ENV"
grep -qx 'GUANGDADA_API_KEY=cold-override-placeholder' "$ROOT_ENV"
expected_order=$'remote-session\nlock-acquired\ncheckout\ncommit-root\ncommit-runtime\nserver-deploy-executed'
test "$(cat "$REMOTE_ORDER_LOG")" = "$expected_order"

echo 'prod secret sync tests passed'
