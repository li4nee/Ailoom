# M23 Answer Verification and Citation Accuracy

## Outcome

Let an admin opt a bot into checking each draft answer against the knowledge passages and
visitor-visible tool results used to produce it. Show the answer only after the check passes;
otherwise use the bot's configured no-answer behavior. Keep the feature off by default.

## Scope

- Add an audited, per-bot `answerVerificationEnabled` setting, default off, exposed in bot behavior
  settings and evaluation run overrides.
- Verify only against the current visitor question, generated draft, bounded retrieved passages,
  and bounded fields from tool results visible to the visitor. Treat all inputs as untrusted data.
- Require a strict structured verdict. A negative, malformed, timed-out, aborted, or unavailable
  verification must not release the draft to the visitor; use the existing safe no-answer behavior.
- Buffer streamed answer text only while verification is enabled. Preserve streaming unchanged when
  disabled. Keep verifier input/output and unsupported claim text out of logs, traces, and storage.
- Trace a bounded status and duration; include verifier tokens and cost under the actual provider and
  model. Snapshot the setting in evaluations and report citation accuracy and verification status.
- Keep the feature default off. Do not claim a quality improvement without an owner-reviewed,
  anonymized support dataset that includes citations, unsupported claims, tool answers, and handoffs.

## Out of scope

- Automatic knowledge edits, broad PII detection/redaction, and changes to the existing response
  prompt when verification is disabled.
- Using a verifier verdict to rewrite visitor-facing content.

## Acceptance criteria

- Existing bots keep the current streaming behavior unless an admin enables verification.
- With verification enabled, only a supported draft is released. Every negative or inconclusive
  result is handled through the bot's configured fallback/handoff behavior.
- Verifier prompts/results are never stored or logged; traces contain status, duration, and usage
  only.
- Eval runs snapshot the setting, and comparison/baseline eligibility rejects mismatched settings.
- Citation accuracy and verification outcome are visible per evaluation result.
- Migration checks, API/admin/shared tests, typecheck, lint, browser E2E, and CI pass.

## Implementation checklist

- [x] Add bounded verifier with strict output parsing, timeout, abort, and deterministic failure.
- [x] Add bot setting, migration, API/admin control, and audit metadata.
- [x] Buffer and gate verified answers; include visible tool-result fields as grounding evidence.
- [x] Add safe trace status/duration and accurate token/cost accounting.
- [x] Add eval snapshot, comparison eligibility, citation metrics, and UI controls/results.
- [x] Update README/docs. Typechecks, lint, formatting, and Pages build pass locally; migration
      check needs a PostgreSQL service and will run in PR CI.
- [ ] Run PR CI and merge.
