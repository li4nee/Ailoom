# ADR-004: Single origin via nginx

Date: 2026-11-09

Status: Accepted

## Context

The application has multiple frontend concerns (admin SPA, widget, API) that should be served under a single origin to simplify CORS, cookies, and CSP.

## Decision

Serve all traffic through a single origin using nginx as a reverse proxy. The API is proxied at `/api/*`, the widget at `/widget.js` and `/widget/*`, and the admin SPA handles all other routes.

## Consequences

- **Positive:** Single CORS configuration, shared cookies, simplified CSP, and TLS termination at one point.
- **Negative:** nginx adds an operational component; configuration must be kept in sync with API route changes.
