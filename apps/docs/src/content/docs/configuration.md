---
title: Configuration
description: Environment variables and settings reference
---

# Configuration

AiLoom is configured through environment variables. Copy `.env.example` to `.env`, fill in
the required values, and start the stack with `--env-file .env`.

Generate the three secrets and the encryption key with:

```bash
pnpm secrets:generate
```

## Complete reference

The table is generated from `CONFIG_ENV_KEYS`; run `pnpm docs:config` after adding or
changing a variable.

<!-- BEGIN CONFIG REFERENCE -->

| Variable                       | Required | Description                                                                                                      |
| ------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                     | no       | Runtime mode: `development`, `test`, or `production`.                                                            |
| `DEMO_MODE`                    | no       | Allows the mock chat provider in a production build for demo and benchmark stacks. Never enable with real users. |
| `PUBLIC_URL`                   | yes      | Public base URL used in emails, the widget snippet, and Caddy.                                                   |
| `DATABASE_URL`                 | yes      | PostgreSQL connection string. Compose builds this from `POSTGRES_*`.                                             |
| `DATABASE_LISTEN_URL`          | no       | Direct (non-PgBouncer) connection for LISTEN/NOTIFY. Defaults to `DATABASE_URL`.                                 |
| `DATABASE_SSL`                 | no       | `false`, `true`, or `require`.                                                                                   |
| `DATABASE_SSL_CA`              | no       | PEM path; when set, database certificates are verified.                                                          |
| `AUTH_SECRET`                  | yes      | At least 32 bytes. Signs admin access JWTs; comma-separate for rotation.                                         |
| `ACCESS_TOKEN_TTL_MIN`         | no       | Admin access token lifetime in minutes.                                                                          |
| `REFRESH_TOKEN_TTL_DAYS`       | no       | Refresh token and session lifetime in days.                                                                      |
| `WIDGET_SECRET`                | yes      | At least 32 bytes. Signs visitor tokens.                                                                         |
| `CHALLENGE_SECRET`             | no       | At least 32 bytes. Signs proof-of-work challenges; required when a bot uses them.                                |
| `ENCRYPTION_KEYS`              | yes      | `v1:<64 hex>[,v0:<64 hex>]`; the highest version encrypts, every entry decrypts.                                 |
| `SIGNUP_MODE`                  | no       | `open`, `invite`, or `closed`.                                                                                   |
| `EMAIL_TRANSPORT`              | no       | `smtp`, `resend`, or `none` (logs emails).                                                                       |
| `EMAIL_FROM`                   | no       | Sender address, e.g. `Support <support@example.com>`. Required when email is enabled.                            |
| `SMTP_HOST`                    | no       | SMTP server host. Required for `EMAIL_TRANSPORT=smtp`.                                                           |
| `SMTP_PORT`                    | no       | SMTP server port; defaults to 587, or 465 when `SMTP_SECURE=true`.                                               |
| `SMTP_USER`                    | no       | SMTP login, if the server needs one.                                                                             |
| `SMTP_PASS`                    | no       | SMTP password.                                                                                                   |
| `SMTP_SECURE`                  | no       | `true` for implicit TLS (usually port 465), `false` for STARTTLS.                                                |
| `RESEND_API_KEY`               | no       | Resend API key. Required for `EMAIL_TRANSPORT=resend`.                                                           |
| `STORAGE_DIR`                  | no       | Absolute path for uploaded files; the compose stack mounts `/data/files`.                                        |
| `MAX_UPLOAD_MB`                | no       | Largest accepted upload, in megabytes.                                                                           |
| `CRAWL_MAX_PAGES`              | no       | Maximum pages fetched for one sitemap source.                                                                    |
| `CRAWL_RESPECT_ROBOTS`         | no       | Honour `robots.txt` while crawling.                                                                              |
| `CRAWL_USER_AGENT`             | no       | User-Agent sent by the crawler.                                                                                  |
| `ALLOW_PRIVATE_PROVIDER_URLS`  | no       | Allow provider base URLs that resolve to private addresses. Off by default for SSRF safety.                      |
| `PROVIDER_URL_ALLOWLIST`       | no       | Comma-separated host names, IPs, or CIDR ranges allowed as provider URLs.                                        |
| `PROVIDER_URL_DENYLIST`        | no       | Comma-separated host names, IPs, or CIDR ranges always blocked.                                                  |
| `LOCAL_EMBEDDINGS`             | no       | Run the built-in ONNX embedding model. Disable below 2 GB RAM.                                                   |
| `LOCAL_EMBEDDING_MODEL`        | no       | Default local embedding model for new bots.                                                                      |
| `LOG_LEVEL`                    | no       | `fatal`, `error`, `warn`, `info`, `debug`, or `trace`.                                                           |
| `RETENTION_CONVERSATIONS_DAYS` | no       | Delete closed/idle conversations older than this. `0` keeps them.                                                |
| `RETENTION_TRACES_DAYS`        | no       | Delete generation traces older than this.                                                                        |
| `RETENTION_SESSIONS_DAYS`      | no       | Delete revoked sessions and expired tokens older than this.                                                      |

<!-- END CONFIG REFERENCE -->

## Notes

- Empty values count as unset. An invalid value stops the process with a list of every
  problem, without echoing secret values.
- `AUTH_SECRET` and `ENCRYPTION_KEYS` accept comma-separated rotation lists. The first
  `AUTH_SECRET` signs and all verify; the highest `ENCRYPTION_KEYS` version encrypts and
  all decrypt.
- Compose-only variables (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `HTTP_PORT`,
  `HTTPS_PORT`, `VERSION`, `IMAGE_OWNER`) are documented in `.env.example` and the
  [self-hosting guide](/self-hosting/).
- Provider base URLs are SSRF-checked. See [Security](/security/) before enabling private
  addresses.
