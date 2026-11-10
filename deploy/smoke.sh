#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Smoke test for the production stack (deploy/docker-compose.yml). Run from the repo root:
#
#   PUBLIC_URL=http://localhost:8080 HTTP_PORT=8080 bash deploy/smoke.sh
#
# It writes a throwaway env file with fresh secrets, starts the stack under its own compose
# project (ailoom-smoke, so a real stack is never touched), checks it, and always tears it
# down with its volumes on exit.
#
#   SMOKE_BUILD=0   use already-built images (ghcr.io/$IMAGE_OWNER/ailoom-{api,web}:$VERSION)
#                   instead of building them (CI builds them in earlier steps).
#   HTTPS_PORT      host port for Caddy's 443 (default 8443; unused for an http:// PUBLIC_URL).
set -euo pipefail

export PUBLIC_URL="${PUBLIC_URL:-http://localhost:8080}"
export HTTP_PORT="${HTTP_PORT:-8080}"
export HTTPS_PORT="${HTTPS_PORT:-8443}"
SMOKE_BUILD="${SMOKE_BUILD:-1}"

cd "$(dirname "$0")/.."

workdir="$(mktemp -d)"
env_file="$workdir/smoke.env"
export AILOOM_ENV_FILE="$env_file"
compose=(docker compose -p ailoom-smoke -f deploy/docker-compose.yml --env-file "$env_file")

hex() { od -An -tx1 -N"$1" /dev/urandom | tr -d ' \n'; }

cat >"$env_file" <<EOF
PUBLIC_URL=$PUBLIC_URL
HTTP_PORT=$HTTP_PORT
HTTPS_PORT=$HTTPS_PORT
POSTGRES_USER=ailoom
POSTGRES_PASSWORD=$(hex 16)
POSTGRES_DB=ailoom
AUTH_SECRET=$(hex 32)
WIDGET_SECRET=$(hex 32)
ENCRYPTION_KEYS=v1:$(hex 32)
EOF

status=1
cleanup() {
  if [ "$status" -ne 0 ]; then
    echo "==> Failure: service status and logs" >&2
    "${compose[@]}" ps -a >&2 || true
    "${compose[@]}" logs --no-color --tail 100 >&2 || true
  fi
  echo "==> Tearing down the stack"
  "${compose[@]}" down -v --remove-orphans || true
  rm -rf "$workdir"
  if [ "$status" -eq 0 ]; then echo "smoke: ok"; fi
}
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

echo "==> Bringing up the stack"
if [ "$SMOKE_BUILD" = "0" ]; then
  "${compose[@]}" up -d --no-build --wait --wait-timeout 300
else
  "${compose[@]}" up -d --build --wait --wait-timeout 300
fi

echo "==> Waiting for Caddy to answer"
for _ in $(seq 1 30); do
  curl -fsS -o /dev/null "$PUBLIC_URL/api/health/live" && break
  sleep 2
done

echo "==> Asserting /api/health/live"
live="$(curl -fsS "$PUBLIC_URL/api/health/live")"
[ "$live" = '{"status":"ok"}' ] || fail "/api/health/live returned: $live"
echo "   ok: $live"

echo "==> Asserting /api/health/ready"
ready_code="$(curl -sS -o "$workdir/ready.json" -w '%{http_code}' "$PUBLIC_URL/api/health/ready")"
[ "$ready_code" = "200" ] || fail "/api/health/ready returned HTTP $ready_code: $(cat "$workdir/ready.json")"
echo "   ok: HTTP $ready_code $(cat "$workdir/ready.json")"

echo "==> Asserting / serves the admin SPA"
curl -fsS -D "$workdir/root.headers" -o "$workdir/root.html" "$PUBLIC_URL/"
grep -q '<div id="root">' "$workdir/root.html" || fail '/ does not contain <div id="root">'
echo '   ok: <div id="root"> present'

echo "==> Asserting the Content-Security-Policy header on /"
grep -qi '^content-security-policy:' "$workdir/root.headers" || fail "no Content-Security-Policy header on /"
echo "   ok: $(grep -i '^content-security-policy:' "$workdir/root.headers" | tr -d '\r')"

echo "==> Asserting the api container is not root"
api_uid="$("${compose[@]}" exec -T api id -u | tr -d '\r')"
[ -n "$api_uid" ] && [ "$api_uid" != "0" ] || fail "api runs as uid '$api_uid'"
echo "   ok: api uid $api_uid"

status=0
