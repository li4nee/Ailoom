---
title: Getting Started
description: Run AiLoom locally for development
---

For a production-style install, see [Self-Hosting](/self-hosting/). To work on the code:

Requirements: Node 24, pnpm 12 (via `corepack enable`), and Docker.

```bash
pnpm install
cp .env.example .env && pnpm secrets:generate      # paste the output into .env
docker compose -f deploy/docker-compose.dev.yml up -d   # Postgres 18 on localhost:55432 + Mailpit
pnpm db:migrate
pnpm dev
```

Required variables (see [Configuration](/configuration/) for all of them):

| Variable          | Description                                       |
| ----------------- | ------------------------------------------------- |
| `PUBLIC_URL`      | Base URL users open, e.g. `http://localhost:8080` |
| `DATABASE_URL`    | PostgreSQL connection string                      |
| `AUTH_SECRET`     | Signs admin access tokens (≥ 32 bytes)            |
| `WIDGET_SECRET`   | Signs widget visitor tokens (≥ 32 bytes)          |
| `ENCRYPTION_KEYS` | AES-256-GCM key ring for provider credentials     |

Run the built-in embedding model download once before integration tests:
`pnpm --filter @app/api fetch-model`.
