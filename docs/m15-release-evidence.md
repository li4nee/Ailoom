# M15 release evidence

Implementation evidence captured 2026-11-25:

- Shared contracts: 27 tests passed.
- Eval metrics and judge unit tests: 8 tests passed.
- Eval dataset API: 4 tests passed.
- Eval migration/schema integration: 5 tests passed.
- Workspace isolation, including the new eval and prompt routes: 5 tests passed.
- Admin eval, suggestions and feedback tests: 11 tests passed.
- API and admin TypeScript checks passed.
- Repository lint passed.
- Docs site build and internal link validation passed.
- `pnpm db:check` reported no schema drift.

The Playwright eval flow is added at `e2e/tests/eval-suite.spec.ts`. A local run could not
complete against this machine's E2E stack: its standard ports are already used by another local
stack, and the alternate-port attempt did not satisfy the app-origin CSRF check. The normal CI
stack uses the standard ports and still needs to report this flow green.

The live judge agreement calibration and the seeded demo run with at least 30 cases have not been
run. No agreement percentage or demo summary is claimed; those remain required release evidence
before tagging `m15-done`.
