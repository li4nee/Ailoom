# M22 Privacy-Aware Query Rewriting

Status: Implementation in progress on `m22-query-rewriting`.

## Outcome

Improve retrieval for short or ambiguous follow-ups by optionally deriving a standalone search
query from the latest visitor message and a small amount of recent visitor context. Query rewriting
changes only what is embedded and searched. The visitor's message, conversation history, answer
prompt, handoff rules, and displayed transcript remain unchanged.

## Scope

- Add an opt-in per-bot `queryRewritingEnabled` setting, defaulting to off for existing and new bots.
- Invoke the bot's configured primary chat model only when enabled. Give the rewriter at most the
  current and immediately previous visitor messages, with strict character limits and basic PII
  scrubbing. Do not send agent or assistant messages, tools, knowledge passages, or system prompt.
- Treat supplied messages as untrusted data. Require one short search query, validate and bound the
  result, and fall back to the existing deterministic `buildRetrievalQuery` on timeout, provider
  error, abort-safe failure, or invalid output. A visitor disconnect still aborts the turn.
- Keep rewrite request and response text out of traces and logs. Trace only whether rewriting was
  applied, duration, and a bounded failure category. Include rewrite model usage in pricing and
  workspace usage totals without persisting prompt contents.
- Snapshot the setting in evaluation runs and support same-snapshot comparison against the current
  M19/M21 retrieval configuration. Keep comparison-only runs out of automatic baselines and prompt
  release gates.
- Add an admin setting with clear provider-data disclosure, and an evaluation toggle so admins can
  compare rewritten and original queries without changing the live bot setting.
- Update API, shared contracts, tests, docs, seeded examples, and migration checks.

## Out of scope

- Answer verification, automatic knowledge edits, and generating visitor-facing text from the
  rewritten query.
- Replacing M19 lexical/vector retrieval or M21 reranking.
- Sending full transcripts, agent messages, tool results, or retrieved passages to the rewrite
  call.
- A general-purpose PII detection service. This milestone uses small, documented redaction rules
  and character limits; broader PII controls remain a separate platform concern.
- Enabling rewriting by default or claiming a rollout-quality gain without a reviewed support
  dataset. M21's 30–50-case reviewed dataset remains a pilot gate.

## Implementation sequence

1. Add the plan and define pure query-context selection, PII scrubbing, output validation, and
   deterministic fallback behavior with unit tests.
2. Add the bounded rewriter service using the existing LLM provider path, primary bot model,
   cancellation signal, and short hard timeout. Do not store request snapshots or text.
3. Add opt-in bot persistence, shared API schemas, migration, audit metadata, and admin controls.
4. Wire rewriting before embedding/retrieval. Record safe status/duration fields on traces and
   aggregate rewrite token cost under the actual provider/model, including when answer failover
   selects a different provider.
5. Snapshot rewriting in M15 eval config, add comparison eligibility for rewriting-only changes,
   preserve snapshot consistency, and expose paired evaluation controls/results.
6. Run focused API/admin/shared tests, typecheck, lint, migration checks, full CI, and browser E2E.
   Document the setting, data flow, fallback, and pilot gate.

## Implementation progress

- [x] Add bounded context selection, direct-identifier redaction, follow-up detection, and strict
      single-line output validation with deterministic fallbacks.
- [x] Add the 1.5-second provider-backed rewriter; preserve caller cancellation and discard its
      request snapshot and text from trace/log output.
- [x] Add the default-off per-bot setting, migration, audited update path, and admin disclosure.
- [x] Wire rewriting before retrieval; record safe status/latency; bill rewrite usage against its
      actual model and keep answer failover attempts priced against their own provider/model.
- [x] Snapshot the setting in eval runs, allow same-context comparisons when it changes, and hide
      baselines in the UI when dataset cases, knowledge, dataset policy, or enabled tools changed.
- [x] Add unit, API integration, pricing, admin-setting, and evaluation comparison coverage.
- [ ] Finish full workspace CI and browser E2E on the PR, then merge.

## Acceptance criteria

- Existing bots and normal requests preserve byte-for-byte deterministic query behavior while the
  setting is off.
- When enabled, only the bounded, scrubbed visitor context reaches the rewriter; rewritten text
  never replaces the visitor message or appears in ordinary logs/traces.
- Provider errors, invalid output, and the rewrite deadline use the deterministic query and do not
  turn an otherwise answerable request into an error. A real caller abort stops work promptly.
- Usage accounting attributes rewrite tokens to the rewrite provider/model and includes their cost
  even when the final answer uses the configured fallback provider.
- Evaluation comparisons use the same dataset/cases, prompt, models, thresholds, tools, and
  knowledge snapshot; only retrieval/rewrite switches may differ.
- The feature remains off by default. No live pilot is recommended before the reviewed support
  dataset shows gains on follow-ups without regressions in citations, expected handoffs, latency,
  or spend.

## Pilot evidence required later

Run vector, hybrid, hybrid+reranking, and hybrid+reranking+rewriting on the same reviewed 30–50
case support set, including follow-ups, exact identifiers, out-of-scope requests, and expected
handoff labels. Report hit@k/MRR, source/citation accuracy, handoff precision/recall, p95 latency,
and total estimated cost. The corpus is owner-reviewed and anonymized; customer transcripts are
not copied into it automatically.
