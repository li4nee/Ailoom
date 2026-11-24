# v0.1.0 launch checklist

Date: 2026-11-17
Branch: `launch-1.0.0`
Prepared by: engineering

Status legend:

- **Verified** — executed in this environment, with the command or test named.
- **Verified by test** — covered by an automated test that passed; not necessarily
  exercised against a real external service.
- **Blocked** — needs a host or GitHub capability not available here.
- **Failed** — measured result misses the spec §26 target.

The security review is in [security-review-v0.1.0.md](security-review-v0.1.0.md).

## Spec §26 acceptance criteria

| #   | Criterion                                                                                                            | Status                               | Evidence / gap                                                                                                                                                                                                                                                |
| --- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Fresh VPS (2 vCPU / 4 GB, clean Docker): README quick start → widget answering from a crawled site in < 15 min       | **Blocked**                          | The demo stack was built and served from the compose file on this machine (`/health` 200, admin 200), but no clean 2 vCPU / 4 GB VPS was available and no stopwatch run was performed. The operator must time this on a fresh host before announcing.         |
| 2   | Same with Ollama only, no external keys, built-in embeddings                                                         | **Blocked**                          | No Ollama daemon is installed (`127.0.0.1:11434` refused). Provider page and compose wiring exist in `apps/docs/src/content/docs/providers/ollama.md`; the run itself is unverified.                                                                          |
| 3   | Streamed answers with valid citations; replay shows chunks, scores, prompt, tokens, cost, latency                    | **Verified by test**                 | `widget-messages.e2e.spec.ts:197` streams a cited answer; `traces.e2e.spec.ts:193` returns the full replay incl. deleted source; `playground.e2e.spec.ts:173` streams §18.2 events and ends with a trace. The demo GIF shows the UI path.                     |
| 4   | Out-of-scope question escalates with no LLM call; trace shows `escalated` + reason; provider dashboard shows no call | **Verified by test**                 | `chat-orchestrator.int.spec.ts:297` asserts escalation without calling the LLM; `traces.e2e.spec.ts:267` keeps an escalated trace with no chat usage. A provider dashboard was not inspected (no external provider traffic).                                  |
| 5   | Handoff: email received → takeover → reply visible in < 2 s → hand back                                              | **Verified by test, partly blocked** | `widget-handoff-feedback.e2e.spec.ts:117,150,166` cover handoff, idempotency and agent ownership. Real email delivery was not received in an inbox and the 2 s UI timing was not measured on a host.                                                          |
| 6   | Isolation suite 100% route coverage                                                                                  | **Verified**                         | `pnpm --filter @app/api test:e2e`: 35 files / 231 tests pass, including `test/isolation/isolation.e2e.spec.ts:85` (every workspace route) and `widget-isolation.e2e.spec.ts:161` (every widget route).                                                        |
| 7   | SSRF suite, origin rejection, secret-leak test                                                                       | **Verified**                         | `safe-fetch.int.spec.ts:210-357` (private/loopback/metadata/port/DNS cases); `csrf-rate-limit.e2e.spec.ts:34,46`; `secret-leak.e2e.spec.ts:242`. All pass in the e2e run above.                                                                               |
| 8   | Spend cap stops LLM calls and emails owners                                                                          | **Verified by test**                 | `chat-orchestrator.int.spec.ts:350` escalates every message at the cap; `spend-alerts.int.spec.ts:126,142,201,243` enqueue the 80%/100% alerts and email configured addresses or owner/admin fallback. Real SMTP delivery was not exercised.                  |
| 9   | Restore drill on a second machine                                                                                    | **Verified locally, partly blocked** | Backup/restore + age drill passed locally (`backup-restore: ok`). A second physical host was not available.                                                                                                                                                   |
| 10  | Upgrade job from `v0.1.0-rc.1` passes                                                                                | **Blocked**                          | No `v0.1.0-rc.1` tag or published images exist yet. The equivalent local drill from the `m6-done` images passed: `upgrade-test: ok`, messages 2 → 4, all other row counts unchanged.                                                                          |
| 11  | Every env var documented; each provider has a page                                                                   | **Verified**                         | Docs build 25 pages with valid links; the configuration table is generated from `CONFIG_ENV_KEYS` and the staleness test passes (`docs-config.spec.ts`, 2 tests). Provider pages: OpenAI, Anthropic, Gemini, Groq, Mistral, Ollama, OpenAI-compatible, local. |
| 12  | Performance numbers on the reference host                                                                            | **Verified**                         | Retrieval passes. The corrected phase-staggered TTFT harness records p50 28.7 ms, **p95 46.4 ms**, p99 71.7 ms, 343 requests and 0 failures against the < 300 ms p95 target.                                                                                  |

## Additional launch checks

| Check                       | Status                            | Evidence                                                                                                                                                                                                                                                                                |
| --------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit tests                  | **Verified**                      | 73 files, 606 tests, 7 skipped.                                                                                                                                                                                                                                                         |
| Typecheck / lint / build    | **Verified**                      | API typecheck pass; repo lint pass (1 pre-existing warning); 5 build tasks pass.                                                                                                                                                                                                        |
| Production dependency audit | **Verified**                      | `pnpm audit --prod` reports no known vulnerabilities after the overrides.                                                                                                                                                                                                               |
| Image scan                  | **Verified with accepted risk**   | API image: 0 HIGH/CRITICAL. Web image: 1 HIGH (`golang.org/x/net` in Caddy 2.11.9), accepted in the security review §4.1.                                                                                                                                                               |
| ZAP baseline                | **Verified with design warnings** | 0 FAIL, 4 WARN, 64 PASS; all four reviewed in the security review §4.3.                                                                                                                                                                                                                 |
| Docs link/config checks     | **Verified**                      | 25-page build, config staleness test passes.                                                                                                                                                                                                                                            |
| Demo assets                 | **Verified**                      | `docs/assets/demo.gif` (2.4 MB) and four screenshots recorded against a fresh demo stack.                                                                                                                                                                                               |
| Release workflow definition | **Verified**                      | `actionlint` passed. Release run [45349415316](https://github.com/li4nee/Ailoom/actions/runs/45349415316) completed successfully after PR #24 corrected four invalid action pins; it built and signed the API and web images. Clean-client signature and SBOM verification remain open. |
| GitHub settings             | **Blocked**                       | Private vulnerability reporting, CodeQL result triage and Scorecard results require repository access not available here.                                                                                                                                                               |

## Release steps still owned by the operator

Repository follow-ups:

- [x] Publish the operator-facing [data-handling guide](../apps/docs/src/content/docs/data-handling.md)
      covering stored data, provider flows, defaults, deletion, and backups.
- [x] Make conversation retention preserve human-owned and waiting-for-human conversations;
      retention now uses last-message age and deletes in batches.
- [ ] Add and pass retention coverage for stale AI/closed conversations, recent conversations,
      and stale human-owned/waiting conversations before merging this behavior change.
- [x] Document the Redis decision: Redis is not needed for the supported single-API topology;
      Redis alone would not make horizontal API scaling supported.

External release checks still open:

1. [x] Complete the `v0.1.0` tag-triggered release workflow after correcting the action pins; run 45349415316 succeeded.
2. On a fresh VPS, run criteria 1, 2 and 5; record the quick-start time and the
   2 s takeover measurement in this file.
3. Run the restore drill on a second host and the upgrade workflow from `v0.1.0`.
4. Re-run the corrected TTFT benchmark on the release reference host and preserve its output as release evidence.
5. Confirm published images, signatures, provenance and release notes; verify signature and
   SBOM attestations from a clean client.
6. In GitHub, confirm private vulnerability reporting is enabled, review CodeQL findings, and
   inspect the latest Scorecard results.
7. Confirm the docs site deploys the new data-handling page and its links work.
8. Recheck the Caddy base image for the x/net fix and rescan the final release image.
9. Post the announcement draft (see [announcement-v0.1.0.md](announcement-v0.1.0.md)).

CRM support is a separate release gate; do not advertise all catalog entries as verified until
the provider-specific work in [crm-verification.md](integrations/crm-verification.md) is complete.

Do not describe the product as horizontally scalable or run multiple API replicas in this
release. A Redis service is not a release prerequisite; shared rate limits, realtime fan-out,
and multi-instance tests are prerequisites for a future horizontal-scaling release.

## Release tag history

`v1.0.0` was created in error and removed before publication. `v0.1.0` is the first public beta
release. Its initial tag-triggered workflow failed during setup because four action references in
`release.yml` did not resolve, and that run published nothing. PR #24 fixed the pins. The annotated
`v0.1.0` tag was then moved to merge commit
[`7c0e1a9`](https://github.com/li4nee/Ailoom/commit/7c0e1a97b38d4cb1ec2bfb0b0860c41133305f38),
and release run 45349415316 completed successfully. The `m7-done` milestone tag remains separate
from the versioned release tag.
