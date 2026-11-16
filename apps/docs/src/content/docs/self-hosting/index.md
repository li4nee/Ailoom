---
title: Self-Hosting
description: Deploy AiLoom with Docker Compose behind Caddy
---

AiLoom runs on a single host with Docker Compose. All state lives in PostgreSQL, and
[Caddy](https://caddyserver.com) is the only public entrypoint: it terminates TLS (automatic
Let's Encrypt certificates), serves the admin app, and proxies `/api`, `/widget.js` and
`/widget/*` to the api.

## Requirements

- Docker with Docker Compose
- 2 vCPU / 4 GB RAM recommended (2 GB minimum; set `LOCAL_EMBEDDINGS=false` below that)
- A domain pointing at the host for HTTPS, or `http://localhost:<port>` for local use

## Deploy

From the repository root:

```bash
cp .env.example .env
docker compose -f deploy/docker-compose.yml run --rm api secrets:generate   # paste into .env
# edit .env: PUBLIC_URL, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB, secrets
docker compose -f deploy/docker-compose.yml --env-file .env up -d --build --wait
```

Always pass both `-f deploy/docker-compose.yml` and `--env-file .env`.

| Service    | Published ports          | Description                                    |
| ---------- | ------------------------ | ---------------------------------------------- |
| `web`      | `HTTP_PORT`/`HTTPS_PORT` | Caddy + admin app, the only public entrypoint  |
| `api`      | none (internal)          | AiLoom API, reached through Caddy at `/api`    |
| `worker`   | none                     | Background jobs (ingestion, email, cleanup)    |
| `migrate`  | none                     | One-shot database migrations before api/worker |
| `postgres` | none                     | PostgreSQL 18 with pgvector                    |
| `ollama`   | none                     | Optional, `--profile ollama` for local models  |

### Local mode (no domain)

Set `PUBLIC_URL=http://localhost:8080` and `HTTP_PORT=8080` in `.env`. Caddy then serves
plain HTTP on that port.

### Ollama (local models)

Ollama runs as an optional compose service. Start the stack with the `ollama` profile:

```bash
docker compose -f deploy/docker-compose.yml --env-file .env \
  --profile ollama up -d --build --wait
```

Ollama is reachable internally at `http://ollama:11434`. Create a provider credential of type
`ollama` in the admin, pointing `base_url` at `http://ollama:11434`, then select an Ollama model
as the bot's chat model. The built-in local embedding model still handles embeddings unless you
configure a separate embedding provider.

Set `LOCAL_EMBEDDINGS=false` to skip baking the ONNX embedding model into the api image and
reduce the image size and memory footprint.

## Health checks

```bash
curl "$PUBLIC_URL/api/health/live"    # process is up
curl "$PUBLIC_URL/api/health/ready"   # database, migrations, queue and pgvector are ready
```

## Backup and restore

Backups are made with `deploy/scripts/backup.sh` and restored with `deploy/scripts/restore.sh`. Both run from the repository root and read `.env` (or `AILOOM_ENV_FILE`).

### Back up

```bash
# plain backup (files + database dump + manifest with SHA-256 checksums)
bash deploy/scripts/backup.sh

# encrypted backup (requires the `age` tool and a recipient public key)
bash deploy/scripts/backup.sh --age-recipient age1...
```

This creates a timestamped directory under `backups/` containing `files.tar.gz`, `db.dump`, and `manifest.json`. With `--age-recipient`, both archives are encrypted to `age` and the plaintext files are removed.

### Restore (restore drill)

Stopping api/worker, replacing the database, re-applying migrations, and restarting:

```bash
# restore onto an empty database
bash deploy/scripts/restore.sh backups/ailoom-backup-20260101T000000Z

# restore over a non-empty database (destructive)
bash deploy/scripts/restore.sh backups/ailoom-backup-20260101T000000Z --force

# restore an encrypted backup (requires the matching age identity file)
bash deploy/scripts/restore.sh backups/ailoom-backup-20260101T000000Z --identity ~/.ssh/age-key.txt
```

The restore script verifies each file's SHA-256 against `manifest.json` (exit 3 on mismatch), refuses to overwrite a non-empty database unless `--force` is given (exit 2), stops `api` and `worker`, restores uploaded files into `/data`, restores PostgreSQL with `pg_restore`, applies pending migrations with the `migrate` service, then restarts `api` and `worker`.

### Drill checklist

Run this on a staging instance before trusting backups in production:

- [ ] A backup completes and `manifest.json` lists both archives with valid checksums
- [ ] Restoring to a fresh database brings conversations, bots, knowledge sources and uploaded files back
- [ ] Restoring with `--force` over an existing database replaces it without leaving stale rows
- [ ] An encrypted backup round-trips with `--identity`
- [ ] The admin loads after restore and `GET /api/health/ready` returns ready

Restore drill: script `deploy/scripts/backup-restore.test.sh` exercises the full back up → wipe → restore → verify cycle against a throwaway compose stack.
