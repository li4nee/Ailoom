<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# M9 release evidence

Recorded 2026-11-18 on `feat/m9-agent-productivity`, before merge to `main`.

## Verified locally

- `pnpm test`: passed. API unit 651 passed / 7 skipped; admin 119 passed; shared 14 passed; eslint-config 38 passed; widget tests passed; Playwright 10 passed.
- Focused API conversation e2e: 12 passed. Isolation e2e: 5 passed. Demo seed integration: 2 passed. Workspace purge integration: 6 passed.
- `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm format:check`, and `pnpm db:check` passed. Lint reports one existing disabled live-provider contract-test warning.
- Playwright handoff flow covers notification email, urgent/unassigned filtering, assignment, private note privacy, saved reply insertion, axe, a 390px viewport, handback, grounded suggestion review, manual send, and answer details.
- The isolated release drill reverted seven M9 migrations to the M8 schema, reapplied all seven, seeded the demo, backed up database and files, restored to a second stack, and verified login, document access, chat, non-empty restore refusal, and checksum-tamper rejection.
- The isolated M9 build passed the existing 60-second visitor TTFT benchmark at 20 concurrent conversations: 343 requests, 0 failures, p50 44.2 ms, p95 92.5 ms, p99 153.1 ms. Raw output: `apps/api/artifacts/perf/ttft-overhead-m9.json`. This is the visitor reply latency check; it does not measure inbox-list or assignment/priority latency.
- A retrospective M8/M9 code comparison used the same M9 schema, 1,000 mixed-status conversations (20% handoffs), 20 distinct agent accounts, one-second per-agent think time, and 30 seconds per phase on the 2 CPU / 4 GB perf overlay. M8 code `b66d8ca` inbox p95 was 16.62 ms (600 requests, 0 failures). The first M9 run measured 46.90 ms and the clean repeat measured 70.95 ms (600 requests, 0 failures each), increases of 182.2% and 326.8%; both exceed the 10% limit. This is a controlled retrospective comparison, not a baseline captured before M9 implementation. Reports: `apps/api/artifacts/perf/inbox-m8.json`, `apps/api/artifacts/perf/inbox-m9.json`, and `apps/api/artifacts/perf/inbox-m9-repeat.json`.
- Priority mutation p95 was 94.57 ms in the first M9 run and 63.53 ms in the clean repeat, with no failed requests; both met the 300 ms limit. Assignment p95 was 323.44 ms and 348.12 ms respectively, with no failed requests; both exceeded the 300 ms limit. A prior matched M9 run measured 29.89 ms and 85.69 ms for priority and assignment, showing substantial run-to-run variation. The two latest comparable runs fail the assignment gate.
- The inbox SQL plan uses `conversations_inbox_priority_status`; its indexed query execution was 0.069 ms in the isolated database. The inbox projection now loads contact attributes and identity timestamps only on the detail route.
- Seed integration verifies the demo handoff, contact history, CRM link, internal note, saved reply, handoff summary, and cited suggestion records.
- Internal docs link validation passed. `age` was unavailable, so encrypted backup round-trip was skipped.

## Release gates still requiring evidence

- No live provider evaluation was run. The deterministic fake-provider suite passed; live-model thresholds still need results from the workflow in `docs/agent-assist-evaluation.md` using configured provider credentials.
- The retrospective inbox comparison fails the 10% regression limit, and both latest assignment p95 samples exceed 300 ms. Do not sign off the inbox performance gate until the regression and assignment tail are resolved and clean repeats pass. The TTFT result above does not close this gate.
- CI on `main` has not run for this branch. Merge, green main CI, and the `m9-done` tag remain release actions.
