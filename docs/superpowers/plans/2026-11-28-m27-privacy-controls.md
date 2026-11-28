# M27: Privacy controls and PII redaction

## Outcome

Give bot admins a clear, enforceable way to choose which common sensitive values are redacted
before conversation text is stored or sent to AI and configured tools. Redaction is deterministic,
server-side, and visible as stable placeholders in transcripts. Existing bots keep their current
behavior until an admin enables categories.

## Existing behavior

- Visitor and agent messages are stored as plaintext in `messages.content` and returned to the
  widget/admin inbox.
- The chat orchestrator sends the current visitor message, recent transcript, retrieved source
  text, and operator instructions to the configured chat provider. Query rewriting has a separate
  narrow email/phone/long-number scrubber.
- Tool inputs are validated against admin-configured schemas, but validated values may still
  contain visitor-provided personal data before the tool call.
- Tool invocation traces omit raw arguments/results. Provider request snapshots are stored with
  traces and are adapter-owned.
- Agent-assist and answer-verification calls use conversation text through separate service paths.

## Scope

1. Add a strict shared bot privacy policy with a bounded list of redaction categories: email,
   phone, payment card, and credentials/secrets. Defaults are empty to preserve existing bots.
   Admins can configure it from bot behavior settings; public widget DTOs do not expose policy.
2. Implement one deterministic redaction utility shared by storage and outbound boundaries. Use
   stable typed placeholders. Validate payment-card candidates with Luhn; redact credential-like
   labeled values, bearer tokens, and JWTs without accepting admin-supplied regexes.
3. Apply the policy to newly stored visitor and agent message text and notification previews. Keep
   bot replies and system workflow messages intact, but sanitize their content before any model
   or tool egress. Apply the same policy to current input, retrieved conversation history, and query
   rewrite context before every provider call.
4. Redact configured tool arguments immediately before execution and ensure model-visible tool
   results cannot reintroduce selected categories into the next provider request. Keep existing
   schema validation, allowlists, and bounded projections unchanged.
5. Ensure trace snapshots and application logs cannot store the selected PII categories. Keep
   raw provider errors and tool arguments/results out of logs and traces. Preserve usage metadata.
6. Add policy-aware coverage for the primary/fallback chat provider, query rewriting, answer
   verification, tool execution, transcript persistence, notifications, and admin configuration.
7. Document the detector limits, category behavior, defaults, transcript effect, and third-party
   processing boundaries in the product docs and README.

## Out of scope

- Retroactive rewrite or deletion of historical message content, custom regexes, arbitrary data
  classification, data retention/deletion schedules, consent management, and legal compliance
  certification. Existing transcript text is still redacted under the current policy before it
  leaves AiLoom for model/tool processing.
- Redacting unrelated knowledge-base documents or admin-authored instructions at rest. Those
  inputs are still checked at provider boundaries so selected categories are not disclosed.
- Provider-specific privacy guarantees, zero-retention claims, or guaranteeing detection of every
  encoding/obfuscation of personal data.

## Implementation sequence

1. Add shared category/policy schemas, bot persistence and migration, API mapper/update handling,
   and pure detector tests. Keep settings private to admin responses.
2. Add the admin controls with concise explanations of what gets hidden and what remains visible.
   Preserve policy when unrelated settings are saved.
3. Redact stored visitor/agent text and previews according to the bot's effective policy. Ensure
   all prompt builders and specialized model calls receive sanitized messages, including history
   loaded from before the setting was enabled.
4. Apply redaction before configured tools run and before any tool result is put back into model
   context. Sanitize provider snapshots/errors before trace persistence.
5. Update spec, README, and data-handling documentation. Validate migrations and run focused plus
   repository validation; create a PR and merge after required checks pass.

## Acceptance criteria

- New and existing bots retain current behavior with no selected categories; an admin can enable
  each category through the normal bot settings API/UI.
- Email, phone, Luhn-valid card numbers, and recognized credentials are replaced with stable,
  typed placeholders in the right categories; invalid card-like sequences and ordinary numbers
  remain unchanged.
- When enabled, selected values are absent from newly stored visitor/agent transcripts,
  notification previews, all model-provider inputs (including rewrite, verify, fallback and agent
  assist), tool arguments/results, and persisted request snapshots.
- Legacy transcript values remain visible to authorized staff but are sanitized before any model
  or tool boundary.
- Malformed policies fail API validation, settings never leak to public widget responses, and
  unrelated settings saves preserve privacy configuration.
- Existing tenant checks, tool validation, error behavior, and stream cancellation remain intact.
- Documentation states what is detected, the default, redaction boundaries, limitations, and the
  non-retroactive transcript behavior accurately.
- Required CI checks pass and the M27 PR is merged.

## Progress

- [x] Branch `feat/m27-privacy-controls` from current `main`.
- [x] Document scope and acceptance criteria.
- [x] Shared policy, deterministic detection, persistence, and API.
- [x] Provider/tool/trace/transcript enforcement and tests.
- [x] Admin UI and public documentation.
- [x] Local validation and migration check; PR and merge pending CI.
