---
title: Sizing and scaling
description: Host sizing, PgBouncer, and the supported single-host topology
---

# Sizing and scaling

## Recommended host

| Resource | Minimum | Recommended |
| --- | --- | --- |
| CPU | 2 vCPU | 2 vCPU |
| RAM | 2 GB with `LOCAL_EMBEDDINGS=false` | 4 GB |
| Disk | 10 GB | 20 GB plus knowledge and uploads |

The built-in ONNX embedder is the main memory consumer. Disable it on small hosts and use a
provider embedding model.

The launch performance target is measured on a single 2 vCPU / 4 GB host at 20 concurrent
widget conversations. See the performance benchmark notes in the repository
(`apps/api/test/perf/README.md`) for current numbers and known gaps.

## One host, one API

The current release supports **one API instance**. Rate limits and some realtime fan-out
state are in memory, so running several API replicas changes their semantics. Do not scale
`api` horizontally yet.

The worker can be separated from the API on another host, but both need the same database
and `WIDGET_SECRET`/`AUTH_SECRET` values.

## PgBouncer

If you put PgBouncer in front of PostgreSQL, point `DATABASE_URL` at the pooler and
`DATABASE_LISTEN_URL` at a direct connection. LISTEN/NOTIFY and migrations need a session
connection; the app fails ready checks when the direct URL is not usable.

```dotenv
DATABASE_URL=postgres://ailoom:...@pgbouncer:6432/ailoom
DATABASE_LISTEN_URL=postgres://ailoom:...@postgres:5432/ailoom
```

Use transaction pooling mode. Prepared statements must be disabled for the pooled
connection (PnP-style clients usually need `?statement_cache_size=0`).

## Backups and upgrades

Size the backup window for `pg_dump` plus the files tarball. Backups run while the worker is
writing; see [Backups](/backups/) and [Upgrades](/upgrades/).
