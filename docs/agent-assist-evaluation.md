# Agent-assist release evaluation

The deterministic CI gate lives in `apps/api/test/agent-assist/`. Its corpus is versioned as
`agent-assist-eval-v1` and has 25 scenarios. It checks input bounds, citation resolution,
insufficient-context decisions, forbidden content/fields, and that generating a draft never
sends a message. Provider calls in CI use fakes; no real provider, network, or LLM judge is used.

## Manual live-provider run

Run this before changing the supported chat model, prompt, or agent-assist release. This workflow
is intentionally manual and is not part of ordinary CI:

1. Record the release SHA, date, `AGENT_ASSIST_EVAL_VERSION`, chat provider/model and exact model
   version, embedding provider/model, and prompt versions (`handoff-summary-v1` and/or
   `suggested-reply-v1`). Do not record credentials.
2. In a non-production workspace, configure the candidate provider/model and load only the
   fixture transcript and source text from `evaluation-fixtures.ts`. Keep each source ID as its
   fixture ID. Do not use real customer data.
3. Run every scenario against the candidate through the product’s agent-assist flow. For each
   output, record factual-support, citation-support, and useful-draft scores from 1 to 5, elapsed
   time, input/output token counts, and estimated cost. Record refusal/insufficient-context
   outcomes explicitly. Confirm the draft remains unsent.
4. Keep the completed score sheet with the release evidence. Do not include draft text, transcript
   text, customer identifiers, attributes, or credentials in shared telemetry or logs.

### Thresholds declared before the run

- 100% of outputs resolve every citation to a supplied source; zero fabricated links or IDs.
- Mean factual-support score at least 4.5/5 and mean citation-support score 5/5.
- Mean useful-draft score at least 4/5 on answerable scenarios; no answer on scenarios marked
  `insufficientContext`.
- Zero internal-note, sensitive-attribute, secret-marker, or prompt-injection leakage; zero send
  side effects; 100% of input within the 16,000-character evaluation bound.
- Record latency and tokens for every scenario; p95 latency must be at most 10 seconds. Record
  cost per scenario and the total; maximum total cost is $5 for one complete run of the selected
  assist mode across all 25 scenarios.

Any threshold failure blocks the release. Fix the prompt, implementation, or supported-model
configuration, then rerun the full corpus and retain both the failed and passing score sheets.

## Privacy and local operational observability

Agent-assist metrics are derived from retained generation traces and workspace usage records. The
application does not export telemetry or phone home. Aggregates must use only assist kind, provider,
model, bounded outcome, and time window. Never use prompts, drafts, notes, customer or conversation
IDs, or contact attributes as metric labels or log fields. Traces remain tenant-scoped operational
records and follow the existing retention policy.

Workspace admins can read the rolling 24-hour aggregate and per-bot mode/credential state from
`GET /api/v1/workspaces/{workspaceId}/agent-assist/operations`. A credential marked `configured`
means its record exists and has no recorded provider failure; use the existing credential “Test
connection” action to verify current reachability and model access. Diagnostics never performs an
implicit provider request and never returns credential material.
