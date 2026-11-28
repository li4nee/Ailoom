---
title: Getting Started
description: Install AiLoom, create a bot, and add the chat widget.
---

<span id="get-ailoom-running"></span>

The Docker Compose stack runs the admin app, API, background worker, Caddy, and PostgreSQL with pgvector. You need Docker Compose, Node.js 24, and pnpm 12.

## Install

```bash
git clone https://github.com/li4nee/ailoom.git
cd ailoom
cp .env.example .env
pnpm install --frozen-lockfile
pnpm secrets:generate
```

Add the generated secrets to `.env`. For a local HTTP install, set:

```dotenv
PUBLIC_URL=http://localhost:8080
HTTP_PORT=8080
POSTGRES_USER=ailoom
POSTGRES_PASSWORD=replace-with-a-long-url-safe-password
POSTGRES_DB=ailoom
```

Start the stack:

```bash
docker compose -f deploy/docker-compose.yml --env-file .env up -d --build --wait
```

Open `http://localhost:8080` and create an account. The first account becomes the instance admin. Create a workspace to continue.

Email transport defaults to `none`, so sign-up is verified immediately and outgoing email links are written to the API log. For a production install, configure `EMAIL_TRANSPORT` and `EMAIL_FROM` before inviting users. See [Configuration](/configuration/) for all settings.

## Create your first bot

1. Create a bot in your workspace.
2. Add a model credential: OpenAI, Anthropic, Gemini, Groq, Mistral, Ollama, or an OpenAI-compatible endpoint. The built-in local embedder needs no key.
3. Add text, a file, or a sitemap source. Wait for its status to become **Ready**.
4. Ask a question in the bot playground. If the answer is weak, inspect the retrieved chunks and scores in the trace drawer.

## Add the widget

Copy the snippet from the bot's **Install** tab into your site:

```html
<script src="https://support.example.com/widget.js" data-key="pk_live_..." async></script>
```

Add the page's origin to the bot's allowed origins, including the scheme and port. The [Widget guide](/widget/) covers welcome interactions, JavaScript controls, and content security policy settings.

## Develop the codebase

For local development, use the separate development Compose stack:

```bash
pnpm install
cp .env.example .env
pnpm secrets:generate
docker compose -f deploy/docker-compose.dev.yml up -d
pnpm db:migrate
pnpm dev
```

Set `PUBLIC_URL=http://localhost:3000` and `DATABASE_URL=postgres://app:app@localhost:55432/app` in `.env`. Start the worker in another terminal:

```bash
pnpm --filter @app/api dev:worker
```

Fetch the local embedding model before running integration tests that use it:

```bash
pnpm --filter @app/api fetch-model
```

See [Contributing](https://github.com/li4nee/ailoom/blob/main/CONTRIBUTING.md) for repository setup and review guidelines.
