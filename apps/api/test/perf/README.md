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

Visitors are phase-staggered across the 3.5-second pacing interval. This preserves the
20-conversation concurrency and aggregate request rate without turning the harness into an
artificial synchronized burst of 20 requests every interval.

```sh
API_URL=http://localhost:13000 \
PUBLIC_URL=http://localhost:18090 \
DATABASE_URL=postgres://ailoom:perfpassword1234@127.0.0.1:15432/ailoom \
WIDGET_ORIGIN=http://localhost:8090 \
PERF_DURATION_S=60 PERF_OUTPUT=artifacts/perf/ttft-overhead.json \
  pnpm --filter @app/api exec node -r @swc-node/register test/perf/ttft-overhead.ts
```

Measured 2026-11-17 on the constrained stack after phase-staggering the workers:

| metric   | value    |
| -------- | -------- |
| requests | 343      |
| failed   | 0        |
| p50      | 35.4 ms  |
| p95      | 74.9 ms  |
| p99      | 152.8 ms |

**Target p95 < 300 ms is met.** All requests answered successfully. The old harness started
all workers in phase, creating synchronized bursts and overstating the tail; the benchmark
now measures the documented paced-concurrency workload.

## Retrieval latency

`retrieval-latency.ts` seeds 100,000 chunks across 50 bots (384 dimensions) and runs
1,000 `RetrievalRepository.search` calls.

```sh
DATABASE_URL=postgres://ailoom:perfpassword1234@127.0.0.1:15432/ailoom \
PERF_OUTPUT=artifacts/perf/retrieval-latency.json \
  pnpm --filter @app/api exec node -r @swc-node/register test/perf/retrieval-latency.ts
```

Measured 2026-11-16:

| metric | value    |
| ------ | -------- |
| chunks | 100,000  |
| bots   | 50       |
| p50    | 2.30 ms  |
| p95    | 7.39 ms  |
| p99    | 12.15 ms |

Target p95 < 50 ms: **pass**.

The retrieval harness leaves its benchmark workspace in the database. Run it against
the disposable perf stack, not a shared database.
