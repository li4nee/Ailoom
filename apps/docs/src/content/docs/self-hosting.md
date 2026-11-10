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

## Health checks

```bash
curl "$PUBLIC_URL/api/health/live"    # process is up
curl "$PUBLIC_URL/api/health/ready"   # database, migrations, queue and pgvector are ready
```
