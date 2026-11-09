# ADR-002: pg-boss over BullMQ in Phase 1

Date: 2026-11-09

Status: Accepted

## Context

The application needs a job queue for background work (knowledge ingestion, embedding generation, usage rollups). BullMQ is the popular choice but requires Redis as a separate stateful service.

## Decision

Use pg-boss, a Postgres-backed job queue, to keep the deployment to a single stateful service (PostgreSQL).

## Consequences

- **Positive:** One less service to operate, monitor, and back up. No Redis dependency in Phase 1.
- **Negative:** Job throughput is limited by Postgres performance. Revisit in Phase 5 if job throughput requires Redis.
