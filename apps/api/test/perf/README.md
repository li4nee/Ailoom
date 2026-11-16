<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Performance benchmarks (M7 Task 7.6)

Both harnesses run against the same 2 CPU / 4 GB constrained stack:
`deploy/docker-compose.yml` + `deploy/docker-compose.perf.yml`. The overlay publishes
Postgres on `127.0.0.1:15432` and the API directly on `127.0.0.1:13000`, so latency
numbers exclude Caddy.

## TTFT overhead

`ttft-overhead.ts` creates a mock chat + embedding bot, seeds one matching chunk, then
opens 20 visitor conversations and sends one paced turn per visitor for 60 seconds. Each
visitor is paced to 17 messages/minute, below the 20/minute and 200/day limits.

```sh
API_URL=http://localhost:13000 \
PUBLIC_URL=http://localhost:18090 \
DATABASE_URL=postgres://ailoom:perfpassword1234@127.0.0.1:15432/ailoom \
WIDGET_ORIGIN=http://localhost:8090 \
PERF_DURATION_S=60 PERF_OUTPUT=artifacts/perf/ttft-overhead.json \
  pnpm --filter @app/api exec node -r @swc-node/register test/perf/ttft-overhead.ts
```

Measured 2026-11-16 on the constrained stack:

| metric | value |
| --- | --- |
| requests | 360 |
| failed | 0 |
| p50 | 297 ms |
| p95 | 564 ms |
| p99 | 709 ms |

**Target p95 < 300 ms is not met.** p50 is on target and all requests answered, but the
tail is roughly 2x the target. The likely cause is queueing at 20 concurrent streams on
1.25 CPU for the API, not retrieval or provider latency (mock provider, mock embeddings).
This is an open launch-readiness gap; the harness exits non-zero until resolved.

## Retrieval latency

`retrieval-latency.ts` seeds 100,000 chunks across 50 bots (384 dimensions) and runs
1,000 `RetrievalRepository.search` calls.

```sh
DATABASE_URL=postgres://ailoom:perfpassword1234@127.0.0.1:15432/ailoom \
PERF_OUTPUT=artifacts/perf/retrieval-latency.json \
  pnpm --filter @app/api exec node -r @swc-node/register test/perf/retrieval-latency.ts
```

Measured 2026-11-16:

| metric | value |
| --- | --- |
| chunks | 100,000 |
| bots | 50 |
| p50 | 2.30 ms |
| p95 | 7.39 ms |
| p99 | 12.15 ms |

Target p95 < 50 ms: **pass**.

The retrieval harness leaves its benchmark workspace in the database. Run it against
the disposable perf stack, not a shared database.
