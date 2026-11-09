---
title: Self-Hosting
description: Deploy AiLoom with Docker Compose
---

# Self-Hosting

AiLoom is designed to run on a single host using Docker Compose, with all state in PostgreSQL.

## Requirements

- Docker and Docker Compose
- PostgreSQL 18 with pgvector (included via `pgvector/pgvector:pg18`)
- ~2 GB RAM for the API and worker
- ~150 MB disk for the built-in embedding model

## Deploy with Docker Compose

From the repository root:

```bash
cp .env.example .env
# Edit .env with your settings
docker compose -f deploy/docker-compose.yml up -d
```

This starts:

| Service    | Port   | Description                 |
| ---------- | ------ | --------------------------- |
| `postgres` | 5432   | PostgreSQL 18 with pgvector |
| `migrate`  | —      | Runs database migrations    |
| `api`      | 3000   | AiLoom API server           |
| `worker`   | —      | Background job worker       |
| `web`      | 80/443 | nginx + admin SPA           |

## Health checks

```bash
curl http://localhost:3000/api/health/live
curl http://localhost:3000/api/health/ready
```

## Coming in v0.1.0

- Production reverse proxy with TLS
- Backup and restore procedures
- Monitoring and observability setup
