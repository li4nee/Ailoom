#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# End-to-end backup/restore drill. Builds the production stack once, seeds it, uploads a file,
# backs it up, restores into a second empty project, and checks deliberately unsafe restores.
# Run from the repository root: bash deploy/scripts/backup-restore.test.sh
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$repo_root"
compose_file="deploy/docker-compose.yml"
work="$(mktemp -d)"
project_a="ailoom-backup-a"
project_b="ailoom-backup-b"
port_a=18091
port_b=18092
https_port_a=19443
https_port_b=19444
public_a="http://localhost:$port_a"
public_b="http://localhost:$port_b"

compose_a=(docker compose --project-name "$project_a" -f "$compose_file" --env-file "$work/a.env")
compose_b=(docker compose --project-name "$project_b" -f "$compose_file" --env-file "$work/b.env")

hex() { od -An -tx1 -N"$1" /dev/urandom | tr -d ' \n'; }

write_env() {
  local file="$1" port="$2" https_port="$3" public="$4"
  cat >"$file" <<EOF
PUBLIC_URL=$public
HTTP_PORT=$port
HTTPS_PORT=$https_port
POSTGRES_USER=ailoom
POSTGRES_PASSWORD=$(hex 16)
POSTGRES_DB=ailoom
AUTH_SECRET=$(hex 32)
WIDGET_SECRET=$(hex 32)
ENCRYPTION_KEYS=v1:$(hex 32)
DEMO_MODE=true
VERSION=local
EOF
}

write_env "$work/a.env" "$port_a" "$https_port_a" "$public_a"
# A restored database keeps the same app secrets, so use the same values in both stacks.
cp "$work/a.env" "$work/b.env"
sed -i "s#^PUBLIC_URL=.*#PUBLIC_URL=$public_b#; s#^HTTP_PORT=.*#HTTP_PORT=$port_b#; s#^HTTPS_PORT=.*#HTTPS_PORT=$https_port_b#" "$work/b.env"

cleanup() {
  local status=$?
  if [ "$status" -ne 0 ]; then
    echo "==> Failure: stack A status and logs" >&2
    "${compose_a[@]}" ps -a >&2 || true
    "${compose_a[@]}" logs --no-color --tail 80 >&2 || true
    echo "==> Failure: stack B status and logs" >&2
    "${compose_b[@]}" ps -a >&2 || true
    "${compose_b[@]}" logs --no-color --tail 80 >&2 || true
  fi
  "${compose_a[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  "${compose_b[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$work"
  exit "$status"
}
trap cleanup EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

sql() {
  local project="$1" query="$2"
  if [ "$project" = "a" ]; then
    "${compose_a[@]}" exec -T postgres psql -U ailoom -d ailoom -Atc "$query"
  else
    "${compose_b[@]}" exec -T postgres psql -U ailoom -d ailoom -Atc "$query"
  fi
}

login() {
  local public="$1" jar="$2"
  curl -fsS -c "$jar" -H "Origin: $public" -H 'X-Requested-With: fetch' \
    -H 'Content-Type: application/json' \
    -d '{"email":"dev@example.com","password":"devpassword"}' \
    "$public/api/v1/auth/login" >/dev/null
}

echo "==> Bringing up stack A (build)"
"${compose_a[@]}" up -d --build --wait --wait-timeout 420

echo "==> Seeding demo data"
"${compose_a[@]}" exec -T api node dist/cli/seed.js --force-demo

workspace_id="$(sql a "SELECT id FROM workspaces WHERE slug = 'northwind-outfitters'")"
bot_id="$(sql a "SELECT id FROM bots WHERE public_key = 'pk_live_northwind_demo'")"
if [ -z "$workspace_id" ] || [ -z "$bot_id" ]; then
  fail 'seed did not create the demo workspace'
fi

echo "==> Uploading a file source"
cat >"$work/field-notes.md" <<'EOF'
# Field notes

The Northwind Trail loop is four miles long and gains 600 feet of elevation.
EOF
jar_a="$work/a.cookies"
login "$public_a" "$jar_a"
upload="$(curl -fsS -b "$jar_a" -H "Origin: $public_a" -H 'X-Requested-With: fetch' \
  -F "file=@$work/field-notes.md;type=text/markdown" -F 'title=Field notes' \
  "$public_a/api/v1/workspaces/$workspace_id/bots/$bot_id/sources/upload")"
source_id="$(printf '%s' "$upload" | jq -r '.id')"
if [ -z "$source_id" ] || [ "$source_id" = "null" ]; then
  fail 'file upload returned no source'
fi

for _ in $(seq 1 60); do
  status="$(curl -fsS -b "$jar_a" -H "Origin: $public_a" -H 'X-Requested-With: fetch' \
    "$public_a/api/v1/workspaces/$workspace_id/bots/$bot_id/sources/$source_id" | jq -r '.status')"
  [ "$status" = "ready" ] && break
  [ "$status" = "failed" ] && fail "file ingestion failed: $(curl -fsS -b "$jar_a" -H "Origin: $public_a" -H 'X-Requested-With: fetch' "$public_a/api/v1/workspaces/$workspace_id/bots/$bot_id/sources/$source_id")"
  sleep 2
done
[ "$status" = "ready" ] || fail "file source stayed $status"

document_id="$(curl -fsS -b "$jar_a" -H "Origin: $public_a" -H 'X-Requested-With: fetch' \
  "$public_a/api/v1/workspaces/$workspace_id/bots/$bot_id/sources/$source_id" | jq -r '.documents[0].id')"
document_title="$(curl -fsS -b "$jar_a" -H "Origin: $public_a" -H 'X-Requested-With: fetch' \
  "$public_a/api/v1/workspaces/$workspace_id/bots/$bot_id/documents/$document_id" | jq -r '.document.title // empty')"
[ -n "$document_title" ] || fail 'uploaded document did not open'

echo "==> Creating a backup"
COMPOSE_PROJECT_NAME="$project_a" COMPOSE_FILE="$compose_file" AILOOM_ENV_FILE="$work/a.env" \
  bash deploy/scripts/backup.sh --out "$work/backups" >/dev/null
backup_dir="$(find "$work/backups" -mindepth 1 -maxdepth 1 -type d | head -1)"
[ -n "$backup_dir" ] || fail 'backup.sh created no backup directory'
[ -f "$backup_dir/manifest.json" ] || fail 'backup has no manifest'
[ -s "$backup_dir/files.tar.gz" ] || fail 'backup has no files archive'
[ -s "$backup_dir/db.dump" ] || fail 'backup has no database dump'

echo "==> Bringing up empty stack B"
"${compose_b[@]}" up -d --no-build --wait --wait-timeout 420

echo "==> Restoring stack B"
COMPOSE_PROJECT_NAME="$project_b" COMPOSE_FILE="$compose_file" AILOOM_ENV_FILE="$work/b.env" \
  bash deploy/scripts/restore.sh "$backup_dir" >/dev/null

echo "==> Checking the restored login, document and chat"
jar_b="$work/b.cookies"
login "$public_b" "$jar_b"
restored_doc="$(curl -fsS -b "$jar_b" -H "Origin: $public_b" -H 'X-Requested-With: fetch' \
  "$public_b/api/v1/workspaces/$workspace_id/bots/$bot_id/documents/$document_id" | jq -r '.document.title // empty')"
[ "$restored_doc" = "$document_title" ] || fail "restored document title changed: '$restored_doc'"

session="$(curl -fsS -H 'Origin: http://localhost:8090' -H 'Content-Type: application/json' \
  -d '{"publicKey":"pk_live_northwind_demo"}' "$public_b/api/widget/v1/sessions")"
token="$(printf '%s' "$session" | jq -r '.token')"
conversation="$(curl -fsS -H 'Origin: http://localhost:8090' -H 'Authorization: Bearer '"$token" \
  -H 'Content-Type: application/json' -d '{}' "$public_b/api/widget/v1/conversations" | jq -r '.id')"
answer="$(curl -fsS -N --max-time 60 -H 'Origin: http://localhost:8090' \
  -H 'Authorization: Bearer '"$token" -H 'Content-Type: application/json' \
  -H 'Accept: text/event-stream' -d '{"content":"What is the refund window?"}' \
  "$public_b/api/widget/v1/conversations/$conversation/messages")"
printf '%s' "$answer" | grep -q 'event: answer.completed' || fail 'restored stack did not answer'

echo "==> Checking the non-empty refusal (exit 2)"
set +e
COMPOSE_PROJECT_NAME="$project_b" COMPOSE_FILE="$compose_file" AILOOM_ENV_FILE="$work/b.env" \
  bash deploy/scripts/restore.sh "$backup_dir" >/dev/null 2>&1
refusal=$?
set -e
[ "$refusal" -eq 2 ] || fail "second restore exited $refusal, expected 2"

echo "==> Checking checksum tampering (exit 3)"
tampered="$work/tampered"
cp -a "$backup_dir" "$tampered"
printf 'x' >>"$tampered/db.dump"
set +e
COMPOSE_PROJECT_NAME="$project_b" COMPOSE_FILE="$compose_file" AILOOM_ENV_FILE="$work/b.env" \
  bash deploy/scripts/restore.sh "$tampered" >/dev/null 2>&1
bad_sum=$?
set -e
[ "$bad_sum" -eq 3 ] || fail "tampered restore exited $bad_sum, expected 3"

if command -v age >/dev/null 2>&1 && command -v age-keygen >/dev/null 2>&1; then
  echo "==> Checking an encrypted backup round-trip"
  age-keygen -o "$work/age.key" >/dev/null 2>&1
  recipient="$(age-keygen -y "$work/age.key")"
  COMPOSE_PROJECT_NAME="$project_a" COMPOSE_FILE="$compose_file" AILOOM_ENV_FILE="$work/a.env" \
    bash deploy/scripts/backup.sh --out "$work/encrypted" --age-recipient "$recipient" >/dev/null
  encrypted_dir="$(find "$work/encrypted" -mindepth 1 -maxdepth 1 -type d | head -1)"
  [ -f "$encrypted_dir/db.dump.age" ] || fail 'encrypted backup has no db.dump.age'
  [ ! -f "$encrypted_dir/db.dump" ] || fail 'encrypted backup left plaintext db.dump'
  COMPOSE_PROJECT_NAME="$project_b" COMPOSE_FILE="$compose_file" AILOOM_ENV_FILE="$work/b.env" \
    bash deploy/scripts/restore.sh "$encrypted_dir" --identity "$work/age.key" --force >/dev/null
else
  echo "SKIP: age is not installed; encrypted round-trip not run"
fi

echo "backup-restore: ok"
