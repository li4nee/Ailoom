---
title: Architecture
description: System architecture and key decisions
---

# Architecture

AiLoom is a monorepo with a NestJS API, Postgres-backed job queue, pgvector knowledge base, and a Vite admin SPA, all behind Caddy on a single origin.

## Repository layout

![Repository structure](/assets/repo-structure.svg)

## Provider layer

All AI traffic flows through the `Llm` service, which is the only importer of the Vercel AI SDK (ADR-003).

![Provider layout](/assets/providers-layout.svg)

## Module layout

![Module map](/assets/module-map.svg)

## System overview

![System overview](/assets/system-overview.svg)

## Chat pipeline

![Chat pipeline](/assets/chat-pipeline.svg)

## Ingestion pipeline

![Ingestion pipeline](/assets/ingestion-pipeline.svg)

## Module structure

![Module layout](/assets/module-layout.svg)

## Admin layout

![Admin layout](/assets/admin-layout.svg)

## Widget layout

![Widget layout](/assets/widget-layout.svg)

## Key decisions

| Decision                                  | ADR     |
| ----------------------------------------- | ------- |
| TypeORM with strict migration discipline  | ADR-001 |
| pg-boss over BullMQ                       | ADR-002 |
| Vercel AI SDK, no LangChain               | ADR-003 |
| Single origin via Caddy                   | ADR-004 |
| SSE over WebSockets                       | ADR-005 |
| Vector column with per-dimension indexes  | ADR-006 |
| Short-lived JWT + DB-backed authorization | ADR-007 |
| Admin as static Vite SPA                  | ADR-008 |
| Split licensing (AGPL/MIT)                | ADR-009 |
| Built-in local embedding model            | ADR-010 |

See `docs/adr/` for full decision records.
