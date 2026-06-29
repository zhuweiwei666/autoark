#!/usr/bin/env bash
set -euo pipefail

APP_URL="${APP_URL:-https://app.autoark.work}"
API_URL="${API_URL:-https://api.autoark.work}"
AGENT_URL="${AGENT_URL:-${APP_URL%/}/agent}"
CREDENTIALS_FILE="${AUTOARK_ADMIN_CREDENTIALS:-$HOME/.config/autoark/admin-credentials.txt}"
CURL_RETRIES="${CURL_RETRIES:-3}"
CURL_RETRY_DELAY="${CURL_RETRY_DELAY:-2}"
CURL_CONNECT_TIMEOUT="${CURL_CONNECT_TIMEOUT:-8}"
CURL_MAX_TIME="${CURL_MAX_TIME:-25}"
NODE_REQUEST_TIMEOUT_MS="${NODE_REQUEST_TIMEOUT_MS:-25000}"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
CURL_COMMON_ARGS=(
  -sS
  -L
  --connect-timeout "$CURL_CONNECT_TIMEOUT"
  --max-time "$CURL_MAX_TIME"
  --retry "$CURL_RETRIES"
  --retry-delay "$CURL_RETRY_DELAY"
)

if curl --help all 2>/dev/null | grep -q -- '--retry-all-errors'; then
  CURL_COMMON_ARGS+=(--retry-all-errors)
fi

if curl --help all 2>/dev/null | grep -q -- '--retry-connrefused'; then
  CURL_COMMON_ARGS+=(--retry-connrefused)
fi

log() {
  printf '[autoark-verify] %s\n' "$*"
}

fail() {
  printf '[autoark-verify] ERROR: %s\n' "$*" >&2
  exit 1
}

normalize_url() {
  printf '%s' "${1%/}"
}

check_get() {
  local label="$1"
  local url="$2"
  local body="$TMP_DIR/${label}.body"
  local status

  if ! status="$(
    curl \
      "${CURL_COMMON_ARGS[@]}" \
      -o "$body" \
      -w '%{http_code}' \
      "$url"
  )"; then
    fail "$label request failed for $url"
  fi

  if [ "$status" != "200" ]; then
    fail "$label returned HTTP $status for $url"
  fi

  log "$label OK ($status)"
}

read_credential() {
  local key="$1"
  local file="$2"
  awk -v wanted="$key" '
    BEGIN { IGNORECASE = 1 }
    index(tolower($0), tolower(wanted) ":") == 1 {
      sub(/^[^:]*:[ \t]*/, "", $0)
      sub(/[ \t\r]+$/, "", $0)
      print $0
      exit
    }
  ' "$file"
}

check_login_with_node() {
  local label="$1"
  local url="$2"
  local username="$3"
  local password="$4"

  AUTOARK_VERIFY_LABEL="$label" \
    AUTOARK_VERIFY_URL="$url" \
    AUTOARK_VERIFY_USERNAME="$username" \
    AUTOARK_VERIFY_PASSWORD="$password" \
    AUTOARK_VERIFY_TIMEOUT_MS="$NODE_REQUEST_TIMEOUT_MS" \
    node <<'NODE'
const label = process.env.AUTOARK_VERIFY_LABEL;
const url = process.env.AUTOARK_VERIFY_URL;
const username = process.env.AUTOARK_VERIFY_USERNAME;
const password = process.env.AUTOARK_VERIFY_PASSWORD;
const timeoutMs = Number(process.env.AUTOARK_VERIFY_TIMEOUT_MS || '25000');

async function main() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  let payload = {};
  try {
    payload = await response.json();
  } catch {}

  const hasToken = Boolean(payload?.data?.token || payload?.token);
  if (response.status !== 200 || !hasToken) {
    console.error(`${label} login failed: status=${response.status} token=${hasToken}`);
    process.exit(1);
  }

  console.log(`[autoark-verify] ${label} login OK (${response.status}, token=true)`);
}

main().catch((error) => {
  const suffix = error?.name === 'AbortError' ? `timed out after ${timeoutMs}ms` : error.message;
  console.error(`${label} login failed: ${suffix}`);
  process.exit(1);
});
NODE
}

APP_URL="$(normalize_url "$APP_URL")"
API_URL="$(normalize_url "$API_URL")"
AGENT_URL="$(normalize_url "$AGENT_URL")"

check_get "app_root" "$APP_URL/"
check_get "app_login" "$APP_URL/login"
check_get "app_dashboard" "$APP_URL/dashboard"
check_get "agent_root" "$AGENT_URL/"
check_get "agent_login" "$AGENT_URL/login"
check_get "api_health" "$API_URL/healthz"

if [ "${AUTOARK_VERIFY_LOGIN:-true}" = "true" ]; then
  if ! command -v node >/dev/null 2>&1; then
    log "node not found; skipping login verification"
  elif [ -f "$CREDENTIALS_FILE" ]; then
    username="$(read_credential username "$CREDENTIALS_FILE")"
    password="$(read_credential password "$CREDENTIALS_FILE")"
    if [ -n "$username" ] && [ -n "$password" ]; then
      check_login_with_node "main" "$API_URL/api/auth/login" "$username" "$password"
      check_login_with_node "agent" "$APP_URL/agent/api/auth/login" "$username" "$password"
    else
      log "credentials file is present but incomplete; skipping login verification"
    fi
  else
    log "credentials file not found; skipping login verification"
  fi
fi

log "Production verification complete"
