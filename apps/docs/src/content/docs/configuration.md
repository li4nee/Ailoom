---
title: Configuration
description: Environment variables and settings reference
---

# Configuration

AiLoom is configured entirely through environment variables. See `.env` for the full reference.

## Required variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgres://app:app@localhost:5432/app` |
| `AUTH_SECRET` | Session signing secret (32+ chars) | `a...` |
| `WIDGET_SECRET` | Widget message signing secret | `w...` |
| `ENCRYPTION_KEYS` | Credential encryption keys | `v1:...` |

## Optional variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PUBLIC_URL` | `http://localhost:3000` | Public base URL |
| `NODE_ENV` | `development` | `development`, `test`, or `production` |
| `LOG_LEVEL` | `info` | Log verbosity |
| `LOCAL_EMBEDDING_MODEL` | `bge-small-en-v1.5` | Built-in embedding model |
| `SIGNUP_MODE` | `open` | `open`, `invite`, or `closed` |

## Generate secrets

```bash
pnpm --filter @app/api secrets:generate
```

## Coming in v0.1.0

- Configuration reference table for all provider-specific env vars
- `.env.example` with commented production values
