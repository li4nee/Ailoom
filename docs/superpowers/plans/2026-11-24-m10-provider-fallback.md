# M10 — Provider Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each bot name a secondary chat credential and model that answers when the primary
provider fails before streaming starts.

**Architecture:** Two nullable bot columns hold the fallback. The chat orchestrator wraps its one
`Llm.streamChat` call in a helper. The helper retries once on the fallback when the primary throws
a fail-over-eligible `ProviderError` before the first delta. The trace records which model
answered and why. Agent-assist and CRM-context jobs keep using the primary only; they are
background jobs with their own retries.

**Tech Stack:** NestJS, TypeORM, Vercel AI SDK (behind `Llm`), React admin.

**Spec:** `docs/spec.md` §27 "Provider fallback: secondary chat credential/model per bot used on
provider errors."

## Global Constraints

See `2026-11-24-00-phase2-index.md`.

## Decisions

- **Fail over** only when nothing has streamed yet (`ttftMs === null`), and only on these `ProviderError.code` values: `rate_limited`, `quota_exceeded`, `timeout`, `connection_failed`, `provider_error`, `local_model_unavailable`, `auth_failed`, `model_not_found`. **Never** on `aborted` (the visitor left) or `blocked_url` (a policy decision).
- **Once:** at most one fallback attempt per answer, with no chaining.
- **Mid-stream errors** keep today's behaviour. The visitor already saw partial text, and a second model would contradict it.
- **Same prompt:** the fallback gets the same messages, `maxOutputTokens` and `temperature`.
- **Validation:** the fallback credential must exist in the workspace and serve chat (same `credential(workspaceId, id, 'chat')` check as the primary). It must differ from the primary pair, and the two fields are set or cleared together.
- **Cost:** cost and usage are charged to the model that answered, using the existing pricing lookup on the trace's `chat_provider` / `chat_model`.

## Review Focus

1. The primary fails after the first delta: there must be no fallback and the error path is unchanged. Test it in Task 2.
2. The fallback also fails: the visitor gets the standard error, and the trace records both failures (`decision_reason = 'fallback_failed'`). Test it in Task 2.
3. The admin deletes a credential that a live bot uses as its fallback: block it with `credential_in_use`, the same rule as for the primary (spec §17.4). Test it in Task 1.
4. The visitor aborts during the primary attempt: there must be no fallback call. Test it in Task 2.
5. The spend cap is reached between attempts: the existing pre-call check runs once per answer, so document that the fallback attempt doesn't re-check. Assert this in the Task 2 test.

---

### Task 1: Schema, contracts and bot API

**Files:**

- Create: `apps/api/src/db/migrations/<ts>-bots-fallback-model.ts`
- Modify: `apps/api/src/modules/bots/entities/bot.entity.ts`
- Modify: `packages/shared/src/bots.ts` (create/update/DTO schemas)
- Modify: `apps/api/src/modules/bots/bots.service.ts`, `bots.mapper.ts`
- Test: `apps/api/src/modules/bots/bots-fallback.int.spec.ts`

**Interfaces:**

- Produces: columns `bots.fallback_chat_credential_id uuid NULL REFERENCES provider_credentials(id)` (no cascade; same FK behaviour as `chat_credential_id`) and `bots.fallback_chat_model text NULL`, plus `CHECK ((fallback_chat_credential_id IS NULL) = (fallback_chat_model IS NULL))`.
- Modifies: `CredentialsService` delete guard (`credentials.service.ts:174`) also counts live bots that reference the credential as their fallback.
- Produces: shared fields `fallbackChatCredentialId: string | null`, `fallbackChatModel: string | null` on `BotDto`; and `fallback: { chatCredentialId: string; chatModel: string } | null` on the update request.

- [ ] **Step 1: Write failing tests** — sets a fallback; clears it with `fallback: null`; rejects a foreign-workspace credential (`validation_failed`); rejects fallback equal to primary; deleting a credential used as a live bot's fallback returns `credential_in_use`; GET returns both fields.
- [ ] **Step 2:** Run `pnpm --filter @app/api test:int src/modules/bots/bots-fallback.int.spec.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the migration, entity, schemas and service validation (reuse `credential(workspaceId, id, 'chat')`).
- [ ] **Step 4:** Run the test plus `pnpm db:check`. Expected: PASS, no drift.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(bots): store an optional fallback chat model"`

### Task 2: Fail over in the chat orchestrator

**Files:**

- Create: `apps/api/src/modules/chat/domain/fallback.ts`
- Modify: `apps/api/src/modules/chat/chat-orchestrator.ts:259` (the `streamChat` call)
- Modify: `apps/api/src/modules/traces/` trace insert (decision reason values)
- Modify: `packages/shared/src/traces.ts` (add decision reasons)
- Test: `apps/api/src/modules/chat/domain/fallback.spec.ts`, `apps/api/src/modules/chat/chat-fallback.int.spec.ts`

**Interfaces:**

- Consumes: `BotEntity.fallbackChatCredentialId`, `BotEntity.fallbackChatModel` (Task 1).
- Produces: `FAILOVER_CODES: ReadonlySet<ProviderErrorCode>` and `shouldFailOver(error: unknown, streamed: boolean, signal: AbortSignal): boolean` in `fallback.ts`.
- Produces: trace `decision_reason` values `'answered_by_fallback'` and `'fallback_failed'`; trace `chat_provider` / `chat_model` hold the model that answered. Add a `request_snapshot.fallbackFrom = { provider, model, errorCode }` entry when the fallback answered.

- [ ] **Step 1: Write failing unit tests** for `shouldFailOver`: true for each code in the decision list when `streamed === false`; false for `aborted`, `blocked_url`, for any code when `streamed === true`, when `signal.aborted`, and for non-`ProviderError` errors.
- [ ] **Step 2: Write failing integration tests** with the mock provider configured to fail the primary (`rate_limited`):
  - The fallback answers, and the AI message is stored.
  - The trace `chat_model` equals the fallback model and `decision_reason = 'answered_by_fallback'`.
  - Usage is costed on the fallback model.
  - When the primary fails after the first delta, there is no fallback call.
  - When both fail, the standard error is sent and `decision_reason = 'fallback_failed'`.
  - When the visitor aborts during the primary, there is no fallback call.
  - The spend-cap check runs exactly once per answer.
- [ ] **Step 3:** Run both specs. Expected: FAIL.
- [ ] **Step 4:** Implement. Keep the orchestrator change to wrapping the stream creation and first-delta loop. Reset `partial` before the fallback attempt; `sink.started` has already fired once, so do not call it again.
- [ ] **Step 5:** Run the chat unit and integration suites. Expected: PASS. Then run the TTFT benchmark (`apps/api/test/perf/ttft-overhead.ts`). Expected: no regression on the no-fallback path.
- [ ] **Step 6: Commit** — `git commit -s -m "feat(chat): fail over to the bot's fallback model before streaming"`

### Task 3: Admin UI, replay and docs

**Files:**

- Modify: `apps/admin/src/features/bots/components/bot-model-form.tsx` (a "Fallback model" section: credential select + model select, reusing the primary's model-listing hook; a Clear button)
- Modify: the trace drawer in `apps/admin/src/features/traces/` (show "Answered by fallback (primary: <model>, <errorCode>)")
- Modify: `apps/admin/src/strings.ts`, `apps/docs/src/content/docs/providers/` (new "Fallback model" page section), `README.md`
- Test: `apps/admin/src/features/bots/bot-model-form.spec.tsx`

- [ ] **Step 1: Write failing admin tests** — saves `{ fallback: { chatCredentialId, chatModel } }`; Clear sends `fallback: null`; the primary credential's current model is excluded from the fallback choices for the same credential; validation errors render via `FormAlert`.
- [ ] **Step 2:** Implement and run `pnpm --filter @app/admin exec vitest run src/features/bots src/features/traces`. Expected: PASS.
- [ ] **Step 3:** Document when fallback triggers (the decision list above), the cost attribution, and that mid-stream errors don't fail over.
- [ ] **Step 4: Commit** — `git commit -s -m "feat(admin): configure and inspect bot fallback models"`
