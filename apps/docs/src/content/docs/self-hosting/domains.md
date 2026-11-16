---
title: Domains and TLS
description: Point a domain at the stack and let Caddy manage certificates
---

# Domains and TLS

Caddy is the only public entrypoint. It serves the admin SPA, proxies `/api`, `/widget.js`
and `/widget/*` to the API, and obtains and renews Let's Encrypt certificates automatically.

## Public domain

1. Create an `A` (and `AAAA` if you use IPv6) record pointing at the host.
2. Allow inbound TCP 80 and 443.
3. Set `PUBLIC_URL=https://support.example.com` in `.env`.
4. Leave `HTTP_PORT=80` and `HTTPS_PORT=443` (or change them only if the host maps other
   ports).
5. Start the stack and watch Caddy:

```bash
docker compose -f deploy/docker-compose.yml --env-file .env logs -f web
```

Caddy needs port 80 reachable for the HTTP-01 challenge. If port 80 is blocked, use a DNS
challenge by editing the Caddyfile for your deployment.

## Local or no-domain mode

Set both values to the same port:

```dotenv
PUBLIC_URL=http://localhost:8080
HTTP_PORT=8080
```

Caddy then serves plain HTTP. Do not expose this mode to the internet.

## Behind another proxy

Prefer letting Caddy terminate TLS. If another proxy must sit in front, forward both HTTP
and HTTPS ports, preserve `Host`, and append `X-Forwarded-For` and `X-Forwarded-Proto`.
Set `PUBLIC_URL` to the URL clients actually use; cookies and CSRF checks are bound to it.

## Changing the URL

Changing `PUBLIC_URL` changes the widget origin, email links, and secure-cookie rules.
Restart `api`, `worker`, and `web` together after editing it, then update each bot's allowed
origins if the host page origin changed too.
