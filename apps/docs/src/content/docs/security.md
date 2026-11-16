---
title: Security
description: SSRF protections, key rotation, signup modes, and reporting
---

# Security

## Provider URL policy

Custom provider endpoints (Ollama, OpenAI-compatible) are checked before use:

- Only `http` and `https` URLs without a query string or fragment are accepted.
- Addresses that resolve to loopback, link-local, private, or otherwise reserved ranges are
  blocked by default.
- `PROVIDER_URL_ALLOWLIST` and `PROVIDER_URL_DENYLIST` accept host names, IPs, or CIDR
  ranges. The deny list wins.
- `ALLOW_PRIVATE_PROVIDER_URLS=true` permits private addresses for a trusted, isolated
  deployment. Use it with the allowlist rather than by itself.

A blocked URL is a normalized provider error (`blocked_url`) and is safe to show to an
admin. Raw upstream bodies are never stored or returned.

## Secret handling

- Provider API keys are encrypted with AES-256-GCM under `ENCRYPTION_KEYS` and are never
  returned by the API after saving.
- Sessions and widget visitor tokens are signed, HTTP-only, and bound to `PUBLIC_URL`.
- Logs redact authorization headers, cookies, provider keys, and secret-bearing fields.
  The secret-leak e2e test exercises signup, login, credentials, chat failures, traces,
  diagnostics, and password-reset mail.

## Rotating encryption keys

1. Add a new key with a higher version to `ENCRYPTION_KEYS`, keeping the old one:
   `v2:<new hex>,v1:<old hex>`.
2. Restart `api` and `worker`.
3. Run the re-encrypt job from the API image:

   ```bash
   docker compose -f deploy/docker-compose.yml --env-file .env \
     run --rm api node dist/cli/credentials-reencrypt.js
   ```

4. Watch the worker finish. Once no rows remain on the old version, remove `v1:` and
   restart again.

Never remove an old key before the re-encrypt job has finished; encrypted credentials that
cannot be decrypted are unrecoverable.

## Rotating auth secrets

`AUTH_SECRET` accepts a comma-separated list. Prepend a new secret, restart, and remove the
old one after the access-token lifetime has passed. Rotating `WIDGET_SECRET` invalidates
existing visitor sessions and forces the widget to create new ones.

## Signup modes

- `open`: anyone who reaches the signup page can create an account.
- `invite`: only invitation links from workspace admins work.
- `closed`: no new accounts, including invitations.

The first account on an empty instance always becomes the instance admin.

## Reporting a vulnerability

Do not open a public issue. Follow [SECURITY.md](https://github.com/li4nee/ailoom/blob/main/SECURITY.md)
for the private reporting address and expected response time. Include a reproduction and the
affected version (`/api/health/live` reports it).
