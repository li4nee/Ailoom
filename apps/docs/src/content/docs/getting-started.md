---
title: Getting Started
description: Run AiLoom locally or on a server in a few commands
---

# Getting started

AiLoom is one Docker Compose stack: PostgreSQL with pgvector, the API, a worker, and Caddy
serving the admin app and widget. You bring a model key or run Ollama locally.

## Quick start (about 5 commands)

On a host with Docker, Docker Compose, Node 24, and pnpm:

```bash
git clone https://github.com/li4nee/ailoom.git && cd ailoom
cp .env.example .env
# Add PUBLIC_URL, HTTP_PORT, POSTGRES_USER, POSTGRES_PASSWORD, and POSTGRES_DB to .env.
# For local HTTP, use PUBLIC_URL=http://localhost:8080 and HTTP_PORT=8080.
pnpm secrets:generate        # paste the generated secrets into .env
docker compose -f deploy/docker-compose.yml --env-file .env up -d --build --wait
```

Then open `PUBLIC_URL` (for local use: `http://localhost:8080`), sign up for the first
account, and create a workspace.

For the bundled Compose stack, edit `PUBLIC_URL`, `AUTH_SECRET`, `WIDGET_SECRET`,
`ENCRYPTION_KEYS`, and the three `POSTGRES_*` values. `DATABASE_URL` is assembled by Compose
from the Postgres values; set it yourself only when connecting to an external database. See
[Configuration](/configuration/) for every variable.

## First login

The first signup becomes the instance admin. Email transport defaults to `none`, so the
account is verified immediately and emails are written to the API log.

For a production install, set `EMAIL_TRANSPORT` and `EMAIL_FROM` before inviting anyone;
otherwise verification and invitation links only appear in the logs.

## First bot

1. Create a bot in the workspace.
2. Add a model credential: OpenAI, Anthropic, Gemini, Groq, Mistral, Ollama, or an
   OpenAI-compatible endpoint. The built-in local embedder needs no key.
3. Add a knowledge source (text, file upload, or sitemap crawl) and wait for ingestion.
4. Ask a test question from the bot's playground. If the answer is not grounded, inspect
   the retrieved chunks and scores in the trace drawer.

## First widget

Copy the snippet from the bot's **Install** tab into the host page. It looks like:

```html
<script src="https://support.example.com/widget.js" data-key="pk_live_..." async></script>
```

Add the host page's origin to the bot's allowed origins, including the scheme and port.
See [Widget](/widget/) for attributes, the JavaScript API, and the CSP lines the host page
needs.

## Local development

For working on the code instead of running a release:

```bash
pnpm install
cp .env.example .env && pnpm secrets:generate
docker compose -f deploy/docker-compose.dev.yml up -d   # Postgres on :55432 + Mailpit
pnpm db:migrate
pnpm dev
```

Download the local embedding model once before integration tests:

```bash
pnpm --filter @app/api fetch-model
```
