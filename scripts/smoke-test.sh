#!/usr/bin/env bash
#
# smoke-test.sh — verification-only image checks for the Control-iD Facial
# Emulator (tasks 17.2; Req 10.2, 10.3).
#
# It:
#   1. Builds the image (controlid-emulator:smoke).
#   2. Asserts the final image size is < 200 MB (Req 10.2).
#   3. Runs the container in ephemeral mode and waits up to ~10 s for the API
#      to accept a request (Req 10.3): POST /login.fcgi with admin/admin must
#      return HTTP 200 and a non-empty "session".
#   4. Tears everything down.
#
# Exits non-zero on any failure. Dependencies: bash, docker, curl.
set -euo pipefail

IMAGE="controlid-emulator:smoke"
CONTAINER="controlid-emulator-smoke"
HOST_PORT="${SMOKE_HOST_PORT:-18080}"
MAX_SIZE_BYTES=$((200 * 1000 * 1000)) # 200 MB (decimal, matching docker's reported size)
READY_TIMEOUT_SECS=10

# Resolve repo root (parent of this scripts/ dir) so the build context is correct.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

log()  { printf '\033[1;34m[smoke]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m[smoke:ok]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[smoke:fail]\033[0m %s\n' "$*" >&2; }

cleanup() {
  docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# --- 1. Build ---------------------------------------------------------------
log "Building image ${IMAGE} from ${REPO_ROOT} ..."
docker build -t "${IMAGE}" "${REPO_ROOT}"

# --- 2. Image size assertion (Req 10.2) -------------------------------------
SIZE_BYTES="$(docker image inspect -f '{{.Size}}' "${IMAGE}")"
SIZE_MB=$(( SIZE_BYTES / 1000 / 1000 ))
log "Image size: ${SIZE_BYTES} bytes (~${SIZE_MB} MB); limit $((MAX_SIZE_BYTES / 1000 / 1000)) MB."
if [ "${SIZE_BYTES}" -ge "${MAX_SIZE_BYTES}" ]; then
  fail "Image size ${SIZE_MB} MB exceeds the 200 MB budget (Req 10.2)."
  exit 1
fi
ok "Image size within budget."

# --- 3. Run container (ephemeral) & wait for readiness (Req 10.3) -----------
cleanup
log "Starting container in ephemeral mode on host port ${HOST_PORT} ..."
docker run -d --name "${CONTAINER}" \
  -p "${HOST_PORT}:8080" \
  -e EMULATOR_STATE_MODE=ephemeral \
  "${IMAGE}" >/dev/null

BASE_URL="http://127.0.0.1:${HOST_PORT}"
log "Waiting up to ${READY_TIMEOUT_SECS}s for the API to accept a request ..."

served=0
start_ts=$(date +%s)
while :; do
  # Login endpoint: expect HTTP 200 with a non-empty session token.
  body="$(curl -sS -m 2 -o - -w '\n%{http_code}' \
    -H 'content-type: application/json' \
    -d '{"login":"admin","password":"admin"}' \
    "${BASE_URL}/login.fcgi" 2>/dev/null || true)"
  http_code="$(printf '%s' "${body}" | tail -n1)"
  payload="$(printf '%s' "${body}" | sed '$d')"

  if [ "${http_code}" = "200" ] && printf '%s' "${payload}" | grep -q '"session"'; then
    served=1
    break
  fi

  now_ts=$(date +%s)
  if [ $(( now_ts - start_ts )) -ge "${READY_TIMEOUT_SECS}" ]; then
    break
  fi
  sleep 0.5
done

elapsed=$(( $(date +%s) - start_ts ))

if [ "${served}" -ne 1 ]; then
  fail "API did not serve a valid /login.fcgi response within ${READY_TIMEOUT_SECS}s."
  log "Recent container logs:"
  docker logs "${CONTAINER}" 2>&1 | tail -n 40 >&2 || true
  exit 1
fi
ok "API served a valid login response in ~${elapsed}s (Req 10.3)."

# --- Secondary check: control panel is served at /admin (Req 10.1) ----------
admin_code="$(curl -sS -m 3 -o /dev/null -w '%{http_code}' "${BASE_URL}/admin" || echo 000)"
if [ "${admin_code}" = "200" ]; then
  ok "Control panel served at /admin (HTTP 200)."
else
  fail "Control panel /admin returned HTTP ${admin_code} (expected 200)."
  exit 1
fi

ok "Smoke test PASSED (size ~${SIZE_MB} MB, ready in ~${elapsed}s)."
