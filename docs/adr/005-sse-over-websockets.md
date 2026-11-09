# ADR-005: SSE over WebSockets in Phase 1

Date: 2026-11-09

Status: Accepted

## Context

The application needs server→client streaming for chat responses and live updates. Options included Server-Sent Events (SSE) and WebSockets.

## Decision

Use SSE for streaming and live updates in Phase 1.

## Consequences

- **Positive:** SSE works through proxies, needs no extra infrastructure, and pairs naturally with PostgreSQL LISTEN/NOTIFY for live updates.
- **Negative:** SSE is server→client only; WebSockets arrive in Phase 2 for the agent inbox where bidirectional communication is needed.
