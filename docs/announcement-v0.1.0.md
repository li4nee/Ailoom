# AiLoom v0.1.0 — announcement draft

**The easiest self-hosted AI support platform for developers to deploy, extend,
and trust.**

AiLoom answers customers first, grounded in your own knowledge, and knows when
to hand off to a person. It is one `docker compose up`: PostgreSQL with pgvector,
the API, the admin, and the embeddable widget. No Redis, no separate vector
database, no vendor lock-in.

## What makes it different

- **Answer replay.** Open any AI answer to see the exact prompt, retrieved
  chunks, scores, tokens, cost, latency and time to first token.
- **Knowledge-gap analytics.** Unanswered and negatively rated questions are
  collected so you know what documentation to write next.
- **Bring your own model.** OpenAI, Anthropic, Gemini, Groq, Mistral, Ollama, or
  any OpenAI-compatible endpoint. The built-in embedding model runs locally and
  works with a single chat key.
- **Operable by one person.** One database, one compose file, documented
  backup/restore and upgrade paths.

## Quick start

```bash
git clone https://github.com/li4nee/ailoom.git && cd ailoom
cp .env.example .env
pnpm secrets:generate
docker compose -f deploy/docker-compose.yml --env-file .env up -d --build --wait
```

Open `PUBLIC_URL`, sign up, create a bot, add knowledge, and paste the widget
snippet into your site.

- Docs: https://li4nee.github.io/ailoom/
- Repository: https://github.com/li4nee/ailoom
- License: AGPL-3.0-only for the application, MIT for packages.

## Status

v0.1.0 is a public beta release. It supports a single API instance, soft spend caps, and the
documented limitations in the security review and launch checklist. Operators should complete
the launch checklist before using it for a production workload.
