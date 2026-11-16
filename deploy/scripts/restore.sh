#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Restore an AiLoom backup made by backup.sh. Run from the repository root:
#
#   bash deploy/scripts/restore.sh BACKUP_DIR [--identity FILE] [--force]
#
# Exit codes: 0 restored, 2 database is not empty (use --force), 3 checksum mismatch, 1 other.
# Files are restored before the database; api and worker are stopped for both, migrate runs
# before the services start again.
set -euo pipefail

backup_dir="${1:-}"
if [ -z "$backup_dir" ] || [ "$backup_dir" = "--help" ] || [ "$backup_dir" = "-h" ]; then
  sed -n '2,12p' "$0"
  [ -n "$backup_dir" ] && exit 0 || exit 1
fi
shift
identity=""
force=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --identity)
      [ "$#" -ge 2 ] || { echo "restore: --identity needs a file" >&2; exit 1; }
      identity="$2"
      shift 2
      ;;
    --force)
      force=1
      shift
      ;;
    *)
      echo "restore: unknown option $1" >&2
      exit 1
      ;;
  esac
done

[ -d "$backup_dir" ] || { echo "restore: not a backup directory: $backup_dir" >&2; exit 1; }
[ -f "$backup_dir/manifest.json" ] || { echo "restore: manifest.json is missing" >&2; exit 1; }
backup_dir="$(cd "$backup_dir" && pwd)"

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$repo_root"
project="${COMPOSE_PROJECT_NAME:-ailoom}"
compose_file="${COMPOSE_FILE:-deploy/docker-compose.yml}"
env_file="${AILOOM_ENV_FILE:-.env}"
[ -f "$env_file" ] || { echo "restore: env file not found: $env_file" >&2; exit 1; }
compose=(docker compose --project-name "$project" -f "$compose_file" --env-file "$env_file")

tmp="$(mktemp -d)"
cleanup() { rm -rf "$tmp"; }
trap cleanup EXIT

sum_of() { sha256sum "$1" | cut -d' ' -f1; }

echo "==> Verifying backup checksums"
for file in files.tar.gz db.dump; do
  plain="$backup_dir/$file"
  encrypted="$backup_dir/$file.age"
  expected="$(jq -r --arg name "$file" '.files[$name] // empty' "$backup_dir/manifest.json")"
  [ -n "$expected" ] || { echo "restore: manifest has no checksum for $file" >&2; exit 3; }
  candidate="$plain"
  if [ -f "$encrypted" ]; then
    candidate="$encrypted"
  fi
  [ -f "$candidate" ] || { echo "restore: backup file missing: $candidate" >&2; exit 3; }
  actual="$(sum_of "$candidate")"
  if [ "$actual" != "$expected" ]; then
    echo "restore: checksum mismatch for $candidate" >&2
    exit 3
  fi
  if [ "$candidate" = "$encrypted" ]; then
    [ -n "$identity" ] || { echo "restore: encrypted backup needs --identity" >&2; exit 1; }
    command -v age >/dev/null 2>&1 || { echo "restore: age is required" >&2; exit 1; }
    age --decrypt --identity "$identity" --output "$tmp/$file" "$encrypted"
  else
    cp "$plain" "$tmp/$file"
  fi
done

db_has_rows() {
  # shellcheck disable=SC2016 # Expanded by the container shell, not this script.
  "${compose[@]}" exec -T postgres sh -c '
    set -eu
    export PGPASSWORD="${POSTGRES_PASSWORD:-}"
    for table in $(psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc \
      "SELECT tablename FROM pg_tables WHERE schemaname = '\''public'\''
         AND tablename NOT IN ('\''migrations'\'', '\''typeorm_metadata'\'',
           '\''instance_settings'\'', '\''worker_heartbeats'\'')"); do
      exists=$(psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc \
        "SELECT EXISTS (SELECT 1 FROM public.\"$table\")")
      [ "$exists" = "t" ] && exit 0
    done
    exit 1
  '
}

if db_has_rows; then
  if [ "$force" -ne 1 ]; then
    echo "restore: database is not empty; re-run with --force to overwrite it" >&2
    exit 2
  fi
  echo "==> --force: replacing the non-empty database"
fi

echo "==> Stopping api and worker"
"${compose[@]}" stop api worker >/dev/null

echo "==> Restoring uploaded files"
"${compose[@]}" run --rm --no-deps --entrypoint tar api -C /data -xzf - <"$tmp/files.tar.gz"

echo "==> Restoring PostgreSQL"
# shellcheck disable=SC2016 # Expanded by the container shell, not this script.
"${compose[@]}" exec -T postgres sh -c \
  'exec pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-privileges --schema=public' \
  <"$tmp/db.dump"

echo "==> Applying migrations"
"${compose[@]}" run --rm --no-deps migrate

echo "==> Starting api and worker"
"${compose[@]}" up -d --no-build api worker
"${compose[@]}" up -d --no-build --wait api worker

echo "restore: ok"
