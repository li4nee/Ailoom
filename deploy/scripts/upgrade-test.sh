#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Upgrade drill (M7 Task 7.7). Run from the repo root:
#
#   bash deploy/scripts/upgrade-test.sh m6-done HEAD
#
# Builds images from FROM_TAG and TO_REF, starts FROM_TAG on a throwaway compose project,
# creates data through the public API, swaps to TO_REF, runs migrations, and verifies that
# login, existing data and a new widget answer still work. Always tears the project down.
set -euo pipefail

FROM_TAG="${1:?usage: upgrade-test.sh FROM_TAG [TO_REF]}"
TO_REF="${2:-HEAD}"

cd "$(dirname "$0")/../.."
repo_root="$(pwd)"

port="${UPGRADE_PORT:-18082}"
project="ailoom-upgrade-$$"
workdir="$(mktemp -d)"
env_file="$workdir/upgrade.env"
cookies="$workdir/cookies.txt"
old_dir="$workdir/old"
new_dir="$repo_root"

hex() { od -An -tx1 -N"$1" /dev/urandom | tr -d ' \n'; }
compose=()

cleanup() {
  status=$?
  if [ "${#compose[@]}" -gt 0 ]; then
    if [ "$status" -ne 0 ]; then
      "${compose[@]}" logs --no-color --tail 80 >&2 || true
    fi
    "${compose[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  fi
  git worktree remove --force "$old_dir" >/dev/null 2>&1 || true
  if [ "$new_dir" != "$repo_root" ]; then
    git worktree remove --force "$new_dir" >/dev/null 2>&1 || true
  fi
  rm -rf "$workdir"
  if [ "$status" -eq 0 ]; then echo "upgrade-test: ok"; fi
}
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

cat >"$env_file" <<EOF
PUBLIC_URL=http://localhost:$port
HTTP_PORT=$port
HTTPS_PORT=$((port + 1))
POSTGRES_USER=ailoom
POSTGRES_PASSWORD=$(hex 16)
POSTGRES_DB=ailoom
AUTH_SECRET=$(hex 32)
WIDGET_SECRET=$(hex 32)
ENCRYPTION_KEYS=v1:$(hex 32)
IMAGE_OWNER=local
VERSION=upgrade-old
EOF
export AILOOM_ENV_FILE="$env_file"

# The upgrade drill needs the mock provider, which production mode blocks on the old image.
cat >"$workdir/override.yml" <<'EOF'
services:
  api:
    environment:
      NODE_ENV: development
  worker:
    environment:
      NODE_ENV: development
  migrate:
    environment:
      NODE_ENV: development
EOF

git worktree add --detach "$old_dir" "$FROM_TAG" >/dev/null
if [ "$TO_REF" != "HEAD" ]; then
  new_dir="$workdir/new"
  git worktree add --detach "$new_dir" "$TO_REF" >/dev/null
fi

compose=(docker compose -p "$project" -f "$old_dir/deploy/docker-compose.yml" -f "$workdir/override.yml" --env-file "$env_file")

echo "==> Building $FROM_TAG images"
docker build -q -t "ghcr.io/local/ailoom-api:upgrade-old" -f "$old_dir/apps/api/Dockerfile" "$old_dir" >/dev/null
docker build -q -t "ghcr.io/local/ailoom-web:upgrade-old" -f "$old_dir/deploy/web.Dockerfile" "$old_dir" >/dev/null

echo "==> Starting $FROM_TAG"
"${compose[@]}" up -d --no-build --wait --wait-timeout 300

api="http://localhost:$port"
origin="$api"
json=(-H 'Content-Type: application/json' -H 'X-Requested-With: fetch' -H "Origin: $origin")

echo "==> Creating data through the $FROM_TAG API"
signup_body="$(curl -sS "${json[@]}" -X POST "$api/api/v1/auth/signup" \
  -d '{"email":"upgrade@example.com","password":"correct-horse-battery-staple-42","name":"Upgrade"}')"
[ "$(jq -r .id <<<"$signup_body")" != "null" ] || fail "signup: $signup_body"
login_body="$(curl -sS "${json[@]}" -D "$workdir/login.headers" -c "$cookies" \
  -X POST "$api/api/v1/auth/login" \
  -d '{"email":"upgrade@example.com","password":"correct-horse-battery-staple-42"}')"
[ "$(jq -r .id <<<"$login_body")" != "null" ] || fail "login: $login_body"
access_cookie="$(grep -i '^set-cookie: __Host-at=' "$workdir/login.headers" | sed 's/^[Ss]et-[Cc]ookie: //' | cut -d';' -f1 | tr -d '\r')"
[ -n "$access_cookie" ] || fail "login returned no __Host-at cookie"
auth=(-H "Cookie: $access_cookie")

workspace_body="$(curl -sS "${json[@]}" "${auth[@]}" -X POST "$api/api/v1/workspaces" \
  -d '{"name":"Upgrade workspace"}')"
[ "$(jq -r .id <<<"$workspace_body")" != "null" ] || fail "workspace: $workspace_body"
workspace="$(jq -r .id <<<"$workspace_body")"
credential_body="$(curl -sS "${json[@]}" "${auth[@]}" -X POST \
  "$api/api/v1/workspaces/$workspace/credentials" \
  -d '{"provider":"mock","label":"Upgrade mock"}')"
[ "$(jq -r .id <<<"$credential_body")" != "null" ] || fail "credential: $credential_body"
credential="$(jq -r .id <<<"$credential_body")"
bot="$(curl -sS "${json[@]}" "${auth[@]}" -X POST "$api/api/v1/workspaces/$workspace/bots" \
  -d "{\"name\":\"Upgrade bot\",\"chatCredentialId\":\"$credential\",\"chatModel\":\"mock-chat\",\"embeddingCredentialId\":\"$credential\",\"embeddingModel\":\"mock-embed\",\"allowedOrigins\":[\"$origin\"]}")"
public_key="$(jq -r .publicKey <<<"$bot")"
bot_id="$(jq -r .id <<<"$bot")"
[ "$public_key" != "null" ] || fail "bot creation returned no public key"
[ "$bot_id" != "null" ] || fail "bot creation returned no id"

session="$(curl -sS -H 'Content-Type: application/json' -H "Origin: $origin" \
  -X POST "$api/api/widget/v1/sessions" -d "{\"publicKey\":\"$public_key\"}")"
[ "$(jq -r .token <<<"$session")" != "null" ] || fail "session: $session"
token="$(jq -r .token <<<"$session")"
conversation_body="$(curl -sS -H 'Content-Type: application/json' -H "Origin: $origin" \
  -H "Authorization: Bearer $token" -X POST "$api/api/widget/v1/conversations" -d '{}')"
[ "$(jq -r .id <<<"$conversation_body")" != "null" ] || fail "conversation: $conversation_body"
conversation="$(jq -r .id <<<"$conversation_body")"

stream="$(curl -fsS -N --max-time 30 -H 'Content-Type: application/json' -H "Origin: $origin" \
  -H 'Accept: text/event-stream' -H "Authorization: Bearer $token" \
  -X POST "$api/api/widget/v1/conversations/$conversation/messages" \
  -d '{"content":"What is your refund policy?"}')"
grep -q 'event: answer.delta\|event: escalated' <<<"$stream" || fail "old image did not answer"

psql() {
  "${compose[@]}" exec -T postgres psql -U ailoom -d ailoom -Atc "$1" | tr -d '\r'
}
counts_before="$(psql "select json_build_object(
  'users', (select count(*) from users),
  'workspaces', (select count(*) from workspaces),
  'bots', (select count(*) from bots),
  'conversations', (select count(*) from conversations),
  'messages', (select count(*) from messages))")"

echo "==> Building $TO_REF images"
docker build -q -t "ghcr.io/local/ailoom-api:upgrade-new" -f "$new_dir/apps/api/Dockerfile" "$new_dir" >/dev/null
docker build -q -t "ghcr.io/local/ailoom-web:upgrade-new" -f "$new_dir/deploy/web.Dockerfile" "$new_dir" >/dev/null

echo "==> Swapping to $TO_REF and running migrations"
sed -i 's/^VERSION=upgrade-old$/VERSION=upgrade-new/' "$env_file"
compose=(docker compose -p "$project" -f "$new_dir/deploy/docker-compose.yml" -f "$workdir/override.yml" --env-file "$env_file")
"${compose[@]}" up -d --no-build --wait --wait-timeout 300

echo "==> Verifying login and existing data"
curl -fsS "${json[@]}" -c "$cookies" -X POST "$api/api/v1/auth/login" \
  -d '{"email":"upgrade@example.com","password":"correct-horse-battery-staple-42"}' >/dev/null
curl -fsS "${json[@]}" "${auth[@]}" "$api/api/v1/workspaces/$workspace" >/dev/null
[ "$(psql "select count(*) from bots where id = '$bot_id'")" = "1" ] || fail "bot row missing after upgrade"

echo "==> Asking a question on the upgraded stack"
stream="$(curl -fsS -N --max-time 30 -H 'Content-Type: application/json' -H "Origin: $origin" \
  -H 'Accept: text/event-stream' -H "Authorization: Bearer $token" \
  -X POST "$api/api/widget/v1/conversations/$conversation/messages" \
  -d '{"content":"Can I return an item after 30 days?"}')"
grep -q 'event: answer.delta\|event: escalated' <<<"$stream" || fail "upgraded image did not answer"

counts_after="$(psql "select json_build_object(
  'users', (select count(*) from users),
  'workspaces', (select count(*) from workspaces),
  'bots', (select count(*) from bots),
  'conversations', (select count(*) from conversations),
  'messages', (select count(*) from messages))")"
echo "   before: $counts_before"
echo "   after:  $counts_after"
for table in users workspaces bots conversations; do
  before="$(jq -r ".$table" <<<"$counts_before")"
  after="$(jq -r ".$table" <<<"$counts_after")"
  [ "$after" -ge "$before" ] || fail "$table count shrank ($before -> $after)"
done
[ "$(jq -r .messages <<<"$counts_after")" -gt "$(jq -r .messages <<<"$counts_before")" ] ||
  fail "upgrade did not add messages"
