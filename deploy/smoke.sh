#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Smoke test for the AiLoom production stack.
# Usage: PUBLIC_URL=http://localhost:8080 HTTP_PORT=8080 bash deploy/smoke.sh
set -euo pipefail

PUBLIC_URL="${PUBLIC_URL:-http://localhost:80}"
HTTP_PORT="${HTTP_PORT:-80}"

echo "==> Bringing up the stack"
docker compose -f deploy/docker-compose.yml up -d --build --wait

echo "==> Waiting for API to be ready"
for i in $(seq 1 30); do
  if curl -fsS "${PUBLIC_URL}/api/health/live" >/dev/null 2>&1; then
    break
  fi
  echo "   attempt $i/30: API not ready yet, retrying in 2s..."
  sleep 2
done

echo "==> Asserting liveness endpoint"
LIVE_BODY=$(curl -fsS "${PUBLIC_URL}/api/health/live")
if [ "$LIVE_BODY" != '{"status":"ok"}' ]; then
  echo "FAIL: /api/health/live returned: $LIVE_BODY"
  docker compose -f deploy/docker-compose.yml logs api
  exit 1
fi
echo "   ok: /api/health/live = $LIVE_BODY"

echo "==> Asserting readiness endpoint"
READY_STATUS=$(curl -fsS -o /dev/null -w "%{http_code}" "${PUBLIC_URL}/api/health/ready")
if [ "$READY_STATUS" != "200" ]; then
  echo "FAIL: /api/health/ready returned HTTP $READY_STATUS"
  docker compose -f deploy/docker-compose.yml logs api
  exit 1
fi
echo "   ok: /api/health/ready = HTTP $READY_STATUS"

echo "==> Asserting web root serves the admin app"
ROOT_BODY=$(curl -fsS "${PUBLIC_URL}/")
if ! echo "$ROOT_BODY" | grep -q '<div id="root">'; then
  echo "FAIL: / does not contain <div id=\"root\">"
  exit 1
fi
echo "   ok: / serves the admin app"

echo "==> Asserting API container runs as non-root"
API_UID=$(docker compose -f deploy/docker-compose.yml exec -T api id -u)
if [ "$API_UID" = "0" ]; then
  echo "FAIL: API container runs as root (uid=0)"
  exit 1
fi
echo "   ok: API container uid = $API_UID"

echo "==> Asserting Content-Security-Policy header"
CSP=$(curl -fsS -D - "${PUBLIC_URL}/" 2>/dev/null | grep -i 'content-security-policy' || true)
if [ -z "$CSP" ]; then
  echo "FAIL: no Content-Security-Policy header on /"
  exit 1
fi
echo "   ok: CSP header present"

echo "==> Tearing down the stack"
docker compose -f deploy/docker-compose.yml down -v

echo "smoke: ok"
