---
title: Troubleshooting
description: Diagnose startup, provider, widget, and ingestion problems
---

# Troubleshooting

Start with **Instance → Diagnostics** in the admin, or `GET /api/health/diagnostics` as an
instance admin. Each check has a status, a detail, and a fix hint.

## The stack will not become ready

`/api/health/ready` failing means one dependency is not ready. Check the migrate job first:

```bash
docker compose -f deploy/docker-compose.yml --env-file .env ps -a
docker compose -f deploy/docker-compose.yml --env-file .env logs migrate
```

Common causes: `DATABASE_URL` does not match the `POSTGRES_*` values, the password contains
URL-unsafe characters, or a migration failed. The process prints every invalid environment
variable at startup without printing its value.

## Diagnostics checks

| Check        | Error or warning          | Fix                                                              |
| ------------ | ------------------------- | ---------------------------------------------------------------- |
| `email`      | `warn`, transport `none`  | Set `EMAIL_TRANSPORT`, `EMAIL_FROM`, and the SMTP/Resend values  |
| `encryption` | rows need re-encryption   | Add the newest key first, restart, run `credentials-reencrypt`   |
| `storage`    | not writable              | Check the `files_data` volume permissions and `STORAGE_DIR`      |
| `worker`     | heartbeat older than 90 s | Start the worker; check its logs and database access             |
| `pgvector`   | extension missing         | Use the `pgvector/pgvector:pg18` image and run migrations        |
| `localModel` | model unavailable         | Run `fetch-model`, or set `LOCAL_EMBEDDINGS=false`               |
| `listen`     | no LISTEN connection      | Set `DATABASE_LISTEN_URL` to a direct connection, not the pooler |
| `queues`     | failed jobs               | Inspect the worker log and the failed job payload                |

## Provider errors

- `auth_failed`: the key is wrong, revoked, or for another provider.
- `blocked_url`: the base URL resolves to a private/reserved address. See
  [Provider URL policy](/security/#provider-url-policy).
- `model_not_found`: the model ID is not available on that account; test the credential in
  the admin.
- `rate_limited` / `quota_exceeded`: wait or raise the provider limit. The bot's spend cap
  also stops calls and emails owners.

Raw provider bodies are never stored. Trace details show the normalized code and a hint.

## Widget does not load

- Confirm the script tag has `data-key` and the URL is the platform origin.
- Add the exact host page origin (scheme, host, port) to the bot's allowed origins.
- If the page has a CSP, allow the platform in `script-src` and `connect-src`.
- Check the browser console for `[ailoom]` warnings; the loader warns when the key is
  missing or the bundle cannot load.

## Answers are not grounded

Open the message trace and inspect retrieved chunks and scores. If nothing passes the
threshold:

- confirm ingestion finished and the source status is ready;
- lower the retrieval threshold or improve chunk headings;
- make sure the bot uses the embedding model that was used at ingestion. Changing it triggers
  a re-embed.

## Emails only appear in logs

`EMAIL_TRANSPORT=none` is the default. Set SMTP or Resend and `EMAIL_FROM`, then restart the
API. Invitations and password resets are not delivered until email is enabled.
