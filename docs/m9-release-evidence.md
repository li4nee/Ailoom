<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# M9 release evidence

Recorded 2026-11-18 on `feat/m9-agent-productivity`, before merge to `main`.

## Verified locally

- `pnpm test`: passed. API unit 651 passed / 7 skipped; admin 119 passed; shared 14 passed; eslint-config 38 passed; widget tests passed; Playwright 10 passed.
- Focused API conversation e2e: 12 passed. Isolation e2e: 5 passed. Demo seed integration: 2 passed. Workspace purge integration: 6 passed.
- `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm format:check`, and `pnpm db:check` passed. Lint reports one existing disabled live-provider contract-test warning.
- Playwright handoff flow covers notification email, urgent/unassigned filtering, assignment, private note privacy, saved reply insertion, axe, a 390px viewport, handback, grounded suggestion review, manual send, and answer details.
- The isolated release drill reverted six M9 migrations to the M8 schema, reapplied all six, seeded the demo, backed up database and files, restored to a second stack, and verified login, document access, chat, non-empty restore refusal, and checksum-tamper rejection.
- The isolated M9 build passed the existing 60-second visitor TTFT benchmark at 20 concurrent conversations: 343 requests, 0 failures, p50 44.2 ms, p95 92.5 ms, p99 153.1 ms. Raw output: `apps/api/artifacts/perf/ttft-overhead-m9.json`. This is the visitor reply latency check; it does not measure inbox-list or assignment/priority latency.
- Seed integration verifies the demo handoff, contact history, CRM link, internal note, saved reply, handoff summary, and cited suggestion records.
- Internal docs link validation passed. `age` was unavailable, so encrypted backup round-trip was skipped.

## Release gates still requiring evidence

- No live provider evaluation was run. The deterministic fake-provider suite passed; live-model thresholds still need results from the workflow in `docs/agent-assist-evaluation.md` using configured provider credentials.
- The M8 inbox-list p95 baseline and the M9 20-agent inbox/assignment/priority load measurements were not captured. Do not claim the 10% inbox regression or 300 ms mutation thresholds are met. The TTFT result above does not close this gate.
- CI on `main` has not run for this branch. Merge, green main CI, and the `m9-done` tag remain release actions.
