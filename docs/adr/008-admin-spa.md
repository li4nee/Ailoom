# ADR-008: Admin as a static SPA (Vite), not Next.js

Date: 2026-11-09

Status: Accepted

## Context

The admin interface needs to be a dashboard for managing bots, credentials, knowledge sources, and conversations. Options included a Next.js SSR app or a static Vite SPA.

## Decision

Build the admin as a static Vite SPA.

## Consequences

- **Positive:** No Node runtime service, no SSR-vs-cookie-path problems, no CSP nonce plumbing. The admin is behind login and has no SEO need, so SSR provides no benefit.
- **Negative:** Client-side routing requires fallback configuration (handled by Caddy's `try_files {path} /index.html`).
