# M12 — Agent Corrections to Knowledge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an agent mark an AI answer wrong and write the correct answer, saved as a knowledge
suggestion that an admin approves into a text source the bot retrieves from.

**Architecture:** The review is recorded on the AI message (`messages.agent_review`, reserved by the
spec as `{ verdict, corrected_answer, reviewer_id }`). A new tenant table `knowledge_suggestions`
holds the pending correction with the visitor question it answers. Approval calls the existing
`SourcesService.create` with a text source, so ingestion, chunking, embedding and retrieval need
no new code. The suggestion keeps the created source id for traceability.

**Tech Stack:** NestJS, TypeORM, pg-boss (existing ingestion jobs), React admin.

**Spec:** `docs/spec.md` §27 "Agent corrections: mark AI answer wrong, write the correct answer, save
it as a knowledge suggestion (admin approves → becomes a text source)", and §9 `messages.agent_review`.

## Global Constraints

See `2026-11-24-00-phase2-index.md`.

## Decisions

- **Who:** any workspace member (owner, admin, agent) can review an AI message and suggest a correction. Only owners and admins can approve or reject.
- **Question:** the suggestion's question is the nearest preceding `visitor` message's content, trimmed to 1,000 characters. The agent can edit it before submitting (some visitor messages are noisy).
- **Answer:** the corrected answer is 1–4,000 characters of plain Markdown.
- **Approval** creates a text source titled `Correction: <question, first 80 chars>` with body `Question: <question>\n\nAnswer: <answer>`, attached to the conversation's bot. The admin may edit the title, question and answer while approving. Approval is idempotent: a second approve returns the same `sourceId`.
- **Reject** keeps the row with a reason (optional, ≤ 500 chars). Nothing is created.
- **Correct answers:** marking an answer "correct" is also allowed. It records `agent_review.verdict = 'correct'` with no suggestion, and feeds the eval suite (M15) as a positive example.
- **Visibility:** suggestions and reviews never reach the visitor or any integration/webhook payload, the same rule as internal notes.
- **Retention:** deleting the conversation keeps approved suggestions (the knowledge source is independent) but sets `message_id` to `NULL`.

## Review Focus

1. The AI message is still streaming or errored: review is rejected with `conflict`. Only `status = 'complete'`, `role = 'ai'` can be reviewed. Test it in Task 1.
2. The bot is deleted between suggestion and approval: approve returns `conflict` (`bot_unavailable`), and the suggestion stays pending. Test it in Task 2.
3. Two admins approve at once: exactly one source is created (row lock plus idempotent result). Test it in Task 2.
4. A non-member, or an agent calling approve: 403. A foreign-workspace suggestion id: 404. Add both to the route-isolation inventory.
5. The correction text contains prompt-injection or HTML: it is stored as-is, but it is a text source, so the existing knowledge sanitisation and prompt delimiters apply. Assert the source body round-trips unchanged and renders escaped in the admin.

---

### Task 1: Review and suggest (API)

**Files:**

- Create: `apps/api/src/db/migrations/<ts>-knowledge-suggestions.ts`
- Create: `apps/api/src/modules/knowledge/entities/knowledge-suggestion.entity.ts`
- Create: `apps/api/src/modules/knowledge/suggestions.repository.ts`, `suggestions.service.ts`, `suggestions.controller.ts`
- Create: `packages/shared/src/suggestions.ts`
- Modify: `apps/api/src/modules/conversations/entities/message.entity.ts` (type `agentReview` as `AgentReview | null`)
- Test: `apps/api/src/modules/knowledge/suggestions.int.spec.ts`

**Interfaces:**

- Produces: table `knowledge_suggestions`:
  - `id uuid PK default uuidv7()`
  - `workspace_id uuid NOT NULL`
  - `bot_id uuid NOT NULL REFERENCES bots ON DELETE CASCADE`
  - `message_id uuid NULL REFERENCES messages ON DELETE SET NULL`
  - `conversation_id uuid NULL REFERENCES conversations ON DELETE SET NULL`
  - `question text NOT NULL`
  - `answer text NOT NULL`
  - `status suggestion_status NOT NULL DEFAULT 'pending'`, an enum of `pending | approved | rejected`
  - `created_by uuid NULL REFERENCES users ON DELETE SET NULL`
  - `reviewed_by uuid NULL REFERENCES users ON DELETE SET NULL`
  - `reviewed_at timestamptz NULL`
  - `reject_reason text NULL`
  - `source_id uuid NULL REFERENCES knowledge_sources ON DELETE SET NULL`
  - `created_at timestamptz NOT NULL DEFAULT now()`
  - Index: `(workspace_id, status, created_at DESC)`
  - Unique: `(workspace_id, message_id) WHERE status = 'pending'`, so there is one pending suggestion per message.
- Produces: `AgentReview = { verdict: 'correct' | 'incorrect'; correctedAnswer: string | null; reviewerId: string; reviewedAt: string; suggestionId: string | null }`.
- Produces: `POST v1/workspaces/:workspaceId/conversations/:conversationId/messages/:messageId/review` with body `{ verdict: 'correct' } | { verdict: 'incorrect'; question: string; answer: string }`, response `{ review: AgentReview; suggestion: KnowledgeSuggestionDto | null }`.
- Produces: `KnowledgeSuggestionDto = { id, botId, botName, messageId, conversationId, question, answer, status, createdBy: { id, name } | null, reviewedBy: { id, name } | null, reviewedAt, rejectReason, sourceId, createdAt }`.

- [ ] **Step 1: Write failing tests** — incorrect creates a pending suggestion and sets `agent_review`; correct sets the review only; re-review replaces the review, and a new incorrect replaces the pending suggestion (same row is updated); streaming/error/non-AI message → 409; foreign conversation → 404; audit row written; realtime `conversation.updated` sent; integration outbox gets no event.
- [ ] **Step 2:** Run `pnpm --filter @app/api test:int src/modules/knowledge/suggestions.int.spec.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the migration, entity, repository (`TenantRepository`), service and controller. Add the route to the isolation inventory.
- [ ] **Step 4:** Run the tests and `pnpm db:check`. Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(knowledge): record agent reviews and correction suggestions"`

### Task 2: Approve or reject (API)

**Files:**

- Modify: `apps/api/src/modules/knowledge/suggestions.service.ts`, `suggestions.controller.ts`
- Modify: `apps/api/src/modules/knowledge/sources.service.ts` (accept a `manager` so approval and source creation share one transaction)
- Test: `apps/api/src/modules/knowledge/suggestions-approval.int.spec.ts`

**Interfaces:**

- Consumes: `SourcesService.create(workspaceId, botId, { type: 'text', title, body }, actor, manager?)`.
- Produces:
  - `GET v1/workspaces/:workspaceId/knowledge/suggestions?status=&botId=&cursor=&limit=` → `{ data: KnowledgeSuggestionDto[]; nextCursor }`
  - `POST …/knowledge/suggestions/:id/approve` with body `{ title?: string; question?: string; answer?: string }` → `{ suggestion, sourceId }`
  - `POST …/knowledge/suggestions/:id/reject` with body `{ reason?: string }` → `{ suggestion }`
- Produces: `suggestion_created` and `suggestion_reviewed` domain events (consumed by M13 notifications).

- [ ] **Step 1: Write failing tests**:
  - Approve creates exactly one text source with the decided title and body, and links `source_id`.
  - Ingestion is enqueued.
  - A second approve returns the same `sourceId`.
  - Concurrent approves create one source.
  - Approve on a deleted bot → 409, and the suggestion stays pending.
  - Reject stores the reason.
  - An agent role → 403.
  - The list filters by status and bot with cursor pagination.
  - Audit rows are written for approve and reject.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement with `SELECT … FOR UPDATE` on the suggestion inside the transaction that creates the source.
- [ ] **Step 4:** Run the tests plus the knowledge integration suite. Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(knowledge): approve corrections into text sources"`

### Task 3: Admin UI and docs

**Files:**

- Modify: `apps/admin/src/features/conversations/components/message-timeline.tsx` (a "Review answer" action on AI messages: Correct / Incorrect → a dialog with an editable question and answer)
- Create: `apps/admin/src/features/knowledge/components/suggestions-queue.tsx` (a Knowledge → Suggestions tab: list, approve dialog with editable title/question/answer, reject with reason)
- Modify: knowledge routes, `api.ts` hooks, strings
- Modify: `apps/docs/src/content/docs/agent-productivity.md` (a corrections section), `README.md`
- Test: `apps/admin/src/features/conversations/review-answer.spec.tsx`, `apps/admin/src/features/knowledge/suggestions-queue.spec.tsx`

- [ ] **Step 1: Write failing admin tests**:
  - The review action shows only on complete AI messages.
  - The dialog prefills the question from the preceding visitor message.
  - Submit calls the review endpoint, and the badge "Marked incorrect · pending" appears.
  - Admins see Approve/Reject; agents see a read-only status.
  - Approve shows a link to the created source.
  - Empty, loading and error states render.
  - Focus returns to the trigger after the dialog closes.
- [ ] **Step 2:** Implement. Run `pnpm --filter @app/admin exec vitest run src/features/conversations src/features/knowledge`. Expected: PASS.
- [ ] **Step 3:** Document the flow, roles, what the created source looks like, and that corrections never reach visitors or CRMs.
- [ ] **Step 4: Commit** — `git commit -s -m "feat(admin): review AI answers and approve corrections"`
