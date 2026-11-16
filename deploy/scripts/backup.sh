#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Back up the running AiLoom stack: uploaded files first, then the database, then a manifest
# with SHA-256 checksums. Run from the repository root:
#
#   bash deploy/scripts/backup.sh [--out DIR] [--age-recipient KEY]
#
# COMPOSE_PROJECT_NAME defaults to `ailoom`; set it when the stack uses another project.
# AILOOM_ENV_FILE and COMPOSE_FILE can point at a non-default stack, like the e2e setup.
set -euo pipefail

out="backups"
recipient=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --out)
      [ "$#" -ge 2 ] || { echo "backup: --out needs a directory" >&2; exit 1; }
      out="$2"
      shift 2
      ;;
    --age-recipient)
      [ "$#" -ge 2 ] || { echo "backup: --age-recipient needs a public key" >&2; exit 1; }
      recipient="$2"
      shift 2
      ;;
    -h|--help)
      sed -n '2,10p' "$0"
      exit 0
      ;;
    *)
      echo "backup: unknown option $1" >&2
      exit 1
      ;;
  esac
done

if [ -n "$recipient" ] && ! command -v age >/dev/null 2>&1; then
  echo "backup: age is required for --age-recipient" >&2
  exit 1
fi

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$repo_root"
project="${COMPOSE_PROJECT_NAME:-ailoom}"
compose_file="${COMPOSE_FILE:-deploy/docker-compose.yml}"
env_file="${AILOOM_ENV_FILE:-.env}"
[ -f "$env_file" ] || { echo "backup: env file not found: $env_file" >&2; exit 1; }

compose=(docker compose --project-name "$project" -f "$compose_file" --env-file "$env_file")
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$out"
backup_dir="$(cd "$out" && pwd)/${project}-backup-${stamp}"
mkdir -p "$backup_dir"

echo "==> Backing up uploaded files"
"${compose[@]}" run --rm --no-deps --entrypoint tar api -C /data -czf - files \
  >"$backup_dir/files.tar.gz"

echo "==> Backing up PostgreSQL"
# shellcheck disable=SC2016 # Expanded by the container shell, not this script.
"${compose[@]}" exec -T postgres sh -c \
  'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner' \
  >"$backup_dir/db.dump"

if [ -n "$recipient" ]; then
  echo "==> Encrypting backup to the age recipient"
  for file in files.tar.gz db.dump; do
    age --encrypt --recipient "$recipient" --output "$backup_dir/$file.age" "$backup_dir/$file"
    rm -f "$backup_dir/$file"
  done
fi

version="${VERSION:-$(git describe --tags --always 2>/dev/null || echo unknown)}"
created_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
sha_files="$(sha256sum "$backup_dir/files.tar.gz" 2>/dev/null | cut -d' ' -f1 || true)"
sha_db="$(sha256sum "$backup_dir/db.dump" 2>/dev/null | cut -d' ' -f1 || true)"
if [ -n "$recipient" ]; then
  sha_files="$(sha256sum "$backup_dir/files.tar.gz.age" | cut -d' ' -f1)"
  sha_db="$(sha256sum "$backup_dir/db.dump.age" | cut -d' ' -f1)"
fi

cat >"$backup_dir/manifest.json" <<EOF
{
  "version": "$version",
  "createdAt": "$created_at",
  "project": "$project",
  "encrypted": $([ -n "$recipient" ] && echo true || echo false),
  "files": {
    "files.tar.gz": "$sha_files",
    "db.dump": "$sha_db"
  }
}
EOF

echo "backup: ok $backup_dir"
