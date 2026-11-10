# ADR-004: Single origin via Caddy

Date: 2026-11-09

Status: Accepted

## Context

The application has multiple frontend concerns (admin SPA, widget, API) that should be served under a single origin to simplify CORS, cookies, and CSP.

## Decision

Serve all traffic through a single origin using Caddy 2 as the reverse proxy. Caddy obtains and renews TLS certificates automatically (Let's Encrypt), streams Server-Sent Events without buffering (`flush_interval -1`), and serves the admin SPA's static files. The API is proxied at `/api/*`, the widget at `/widget.js` and `/widget/*`, and the admin SPA handles all other routes.

## Consequences

- **Positive:** Single CORS configuration, shared cookies, simplified CSP, and TLS termination at one point.
- **Negative:** Caddy is one more container; its route list (`deploy/Caddyfile`) must be kept in sync with new top-level paths.
