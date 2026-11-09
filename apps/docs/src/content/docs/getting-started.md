---
title: Getting Started
description: Set up AiLoom in 5 commands
---

# Getting Started

AiLoom requires Node 24, pnpm, and PostgreSQL 18 (with pgvector).

## 1. Install dependencies

```bash
pnpm install
```

## 2. Configure the environment

Copy `.env` and fill in the required secrets:

```bash
cp .env .env.local
# Edit .env.local with your database URL, auth secret, and provider keys
```

Required environment variables:

| Variable          | Description                            |
| ----------------- | -------------------------------------- |
| `DATABASE_URL`    | PostgreSQL connection string           |
| `AUTH_SECRET`     | Signing secret for sessions            |
| `WIDGET_SECRET`   | Secret for widget signatures           |
| `ENCRYPTION_KEYS` | Encryption keys for credential storage |

Generate secrets with:

```bash
pnpm --filter @app/api secrets:generate
```

## 3. Run migrations

```bash
pnpm --filter @app/api db:migrate
```

## 4. Start the development server

```bash
pnpm --filter @app/api dev
```

The API will be available at `http://localhost:3000`.

## Coming in v0.1.0

- Widget embed guide
- Provider setup walkthroughs
- Knowledge base ingestion tutorial
