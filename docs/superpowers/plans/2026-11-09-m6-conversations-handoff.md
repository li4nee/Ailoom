# Milestone 6 — Conversations and Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agents see a live inbox with a "Needs human" list, take over conversations, reply to visitors in real time (and by email when they left), hand back or close, open any AI answer's full replay, and read usage, unanswered-question, and negative-feedback reports.

**Architecture:** spec §14.3, §15, §17.7–17.8; architecture §3.3 (live updates). Realtime fan-out already exists (Task 3.0); this milestone adds the conversation write paths and the admin screens.

**Tech Stack:** existing stack; Notification API and `<audio>` in the admin.

**Spec:** `docs/spec.md`, `docs/architecture.md`. Index: `2026-11-09-00-index.md`.

## Global Constraints

All index constraints apply. Milestone-specific:

- Agent reply reaches the visitor's widget within 2 seconds (spec §26.5).
- Status transitions allowed: `ai → needs_human` (visitor/auto), `ai|needs_human → human` (takeover or agent message), `human|needs_human → ai` (hand back), any → `closed`, `closed → human` only by an agent message (reopens). Anything else → `409 invalid_transition`.
- Every status change inserts a `system` message describing it, so the visitor and the replay timeline both show it.
- Inbox sort: `last_message_at DESC, id DESC`, cursor encodes both.

## Review Focus (this milestone)

1. **Two agents click "Take over" at the same moment.** Expected: one wins; the other gets `409 already_assigned` showing who owns it. → Task 6.2 test.
2. **Agent replies while the AI is streaming an answer** in the same conversation. Expected: the AI stream is aborted, its partial answer stored as `error`, and the agent message follows; the visitor sees no further AI tokens. → Task 6.2 test.
3. **Visitor closed the tab and left an email; agent replies three times quickly.** Expected: one email containing all three replies (debounced 60 s), not three emails. → Task 6.3 test.
4. **Search input with Postgres tsquery syntax** (`refund & !shipping`, `"unbalanced`, `:*`). Expected: treated as plain words via `websearch_to_tsquery`; never a 500. → Task 6.1 test.
5. **Trace whose chunks were deleted.** Expected: replay still renders, rows show "source deleted", no 500. → Task 6.4 test.

---

### Task 6.1: Conversations list and detail

**Files:**

- Create: `packages/shared/src/conversations.ts`, `apps/api/src/modules/conversations/{conversations.controller.ts,conversations.service.ts,conversations.mapper.ts,inbox.query.ts}`
- Modify: `apps/api/test/isolation/isolation-fixtures.ts` (`conversationId`)
- Test: `apps/api/test/e2e/conversations.e2e.spec.ts`

**Interfaces:**

- Produces:
  - `GET /api/v1/workspaces/:workspaceId/conversations?botId&status&assignedTo(=me|<userId>|none)&q&cursor&limit` (agent) → `Page<ConversationListItem>`; `ConversationListItem = { id, botId, botName, status, contact: { id, email, name }, assignedTo: { id, name } | null, handoffReason, handoffRequestedAt, lastMessageAt, lastMessagePreview /* 140 chars */, unansweredByHuman: boolean }`
  - `GET /api/v1/workspaces/:workspaceId/conversations/counts` → `{ needsHuman: number; mine: number }` (badge)
  - `GET …/conversations/:conversationId` → `{ conversation, contact, messages: AdminMessage[] /* all, oldest first, with traceId for AI messages */ }`
  - `InboxQuery.search(ws, filters): Promise<Page<…>>` — `q` matches `messages.tsv @@ websearch_to_tsquery('simple', q)` (EXISTS) or `contacts.email = lower(trim(q))`

- [ ] **Step 1: Write failing tests** — filters combine; `needs_human` sorted by `last_message_at desc`; cursor pagination stable with equal timestamps; `q` with `refund & !shipping`, `"unbalanced`, `:*` → 200; email search exact; counts endpoint; detail includes `traceId` on AI messages; agents can read; non-member 404.
- [ ] **Step 2–4: Fail → implement → pass.**
- [ ] **Step 5: Isolation** — fixture `conversationId`; suite PASS.
- [ ] **Step 6: Commit** — `git commit -s -m "feat(conversations): inbox listing, search, counts and detail"`

---

### Task 6.2: Agent actions — reply, take over, hand back, close

**Files:**

- Create: `apps/api/src/modules/conversations/{agent-actions.service.ts,agent-actions.controller.ts,domain/transitions.ts}`, `apps/api/src/modules/chat/active-streams.ts`
- Modify: `apps/api/src/modules/chat/chat-orchestrator.ts` (register/unregister its `AbortController` in `ActiveStreams`)
- Test: `apps/api/src/modules/conversations/domain/transitions.spec.ts`, `apps/api/test/e2e/agent-actions.e2e.spec.ts`

**Interfaces:**

- Produces:
  - `nextStatus(current: ConversationStatus, action: 'takeover' | 'agent_message' | 'handback' | 'close'): ConversationStatus` (throws `invalid_transition`)
  - Routes (spec §17.7): `POST …/conversations/:conversationId/messages { content (1–4000) }` (agent; implies takeover when status ≠ `human`), `POST …/takeover`, `POST …/handback`, `POST …/close`
  - `ActiveStreams.abort(conversationId: string): boolean` (in-process registry; aborts an in-flight AI answer)
  - Takeover sets `assigned_user_id` with `UPDATE … WHERE assigned_user_id IS NULL OR assigned_user_id = $me` → 0 rows → `409 already_assigned` (`details: [{ path: 'assignedTo', message: '<name>' }]`); `handoff_reason = 'agent_takeover'` when the AI was still in charge
  - System messages: `"<Agent name> joined the conversation."`, `"<Agent name> handed the conversation back to the assistant."`, `"<Agent name> closed the conversation."`
  - Audit: none (conversation actions are not admin config changes)

- [ ] **Step 1: Write failing tests**

```ts
it.each([['ai', 'takeover', 'human'], ['needs_human', 'agent_message', 'human'], ['human', 'handback', 'ai'], ['closed', 'agent_message', 'human'], ['ai', 'handback', 'invalid']])(
  '%s + %s → %s', (s, a, r) => r === 'invalid' ? expect(() => nextStatus(s as never, a as never)).toThrow() : expect(nextStatus(s as never, a as never)).toBe(r));
it('agent message takes over and reaches the visitor live', async () => { /* visitor events stream receives event: message role agent within 2 s */ });
it('only one agent wins a simultaneous takeover', async () => { const [a, b] = await Promise.all([takeover(agent1), takeover(agent2)]);
  expect([a.status, b.status].sort()).toEqual([200, 409]); });
it('agent reply aborts an in-flight AI answer', async () => { /* slow mock model; agent posts; AI message status error; no deltas after agent message */ });
it('hand back returns control to the AI', async () => { … next visitor message gets an AI answer });
it('closing then agent message reopens as human', async () => { … });
it('AI does not answer after takeover', async () => { … visitor message stored, no AI message });
```

- [ ] **Step 2–4: Fail → implement → pass.**
- [ ] **Step 5: Commit** — `git commit -s -m "feat(conversations): agent replies, takeover, hand back and close"`

---

### Task 6.3: Handoff notifications and agent-reply emails

**Files:**

- Create: `apps/api/src/modules/conversations/{handoff-notifier.listener.ts,visitor-presence.ts,agent-reply-email.job.ts,agent-reply-email.processor.ts}`, `apps/api/src/modules/email/templates/{handoff-requested.ts,agent-reply.ts}`
- Modify: `apps/api/src/modules/widget/widget-events.controller.ts` (register presence)
- Test: `apps/api/src/modules/conversations/notifications.int.spec.ts`

**Interfaces:**

- Produces:
  - Listener on `chat.handoff_requested` → `handoff_requested` email to `settings.notificationEmails` or owners + admins, with conversation link `<PUBLIC_URL>/w/<ws>/conversations/<id>`, bot name, reason, contact email, last visitor message (≤ 500 chars)
  - `VisitorPresence.isConnected(conversationId): boolean` (count of open visitor event streams in this process)
  - Job `conversation.agent_reply_email { workspaceId; conversationId }` with `singletonKey = conversationId` and `startAfter = 60 s`; processor sends one `agent_reply` plain-text email containing all agent messages newer than `contacts.last_emailed_at` when the visitor is still not connected and `contact.email` is set; then sets `last_emailed_at` (new column on `contacts`, spec §9.4 updated)

- [ ] **Step 1: Write failing tests** — handoff email recipients and content; no email transport → handoff still works, nothing sent; three agent replies while the visitor is away → exactly one email with all three; visitor reconnects before 60 s → no email; contact without email → no job.
- [ ] **Step 2–4: Fail → implement → pass.**
- [ ] **Step 5: Commit** — `git commit -s -m "feat(conversations): handoff notification and debounced agent reply emails"`

---

### Task 6.4: Trace (replay) endpoints

**Files:**

- Create: `packages/shared/src/traces.ts`, `apps/api/src/modules/traces/{traces.controller.ts,traces.service.ts,traces.mapper.ts}`
- Modify: `apps/api/test/isolation/isolation-fixtures.ts` (`traceId`, `messageId`)
- Test: `apps/api/test/e2e/traces.e2e.spec.ts`

**Interfaces:**

- Produces: `GET /api/v1/workspaces/:workspaceId/traces/:traceId` and `GET …/messages/:messageId/trace` (agent) → `TraceDetail = { id, decision, decisionReason, origin, createdAt, promptVersion: { id, version, systemPrompt } | null, platformPromptVersion, chat: { provider, model } | null, embedding: { provider, model } | null, retrieval: { rank, score, used, chunkId, documentId: string | null, sourceTitle: string | null, preview: string | null, sourceDeleted: boolean }[], requestSnapshot, inputTokens, outputTokens, embeddingTokens, costUsd, priceKnown, latencyMs, ttftMs, error, feedback: 1 | -1 | null }`

- [ ] **Step 1: Write failing tests** — full detail for an answered trace; chunks deleted → rows with `sourceDeleted: true` and null preview; `requestSnapshot` never contains credential values (seeded secret string search); escalated trace has null chat usage; message without trace → 404.
- [ ] **Step 2–4: Fail → implement → pass.**
- [ ] **Step 5: Commit** — `git commit -s -m "feat(traces): answer replay endpoints with deleted-source handling"`

---

### Task 6.5: Usage, unanswered and feedback reports

**Files:**

- Create: `apps/api/src/modules/usage/{usage.controller.ts,usage.service.ts}`, `apps/api/src/modules/traces/reports.controller.ts`
- Test: `apps/api/test/e2e/reports.e2e.spec.ts`

**Interfaces:**

- Produces:
  - `GET /api/v1/workspaces/:workspaceId/usage?from&to&botId` (agent; dates `YYYY-MM-DD` UTC, max range 366 days) → `{ days: { day, conversations, visitorMessages, aiMessages, escalations, inputTokens, outputTokens, embeddingTokens, costUsd }[]; totals: same fields; feedback: { positive, negative, positiveRate: number | null }; monthToDate: { costUsd, capUsd } | null }`
  - `GET …/unanswered?botId&cursor` (admin) → recent visitor messages whose trace is `escalated` with reason `top_score_below_threshold` or `no_knowledge` (widget origin only): `{ messageId, conversationId, content, topScore, createdAt }`
  - `GET …/feedback?rating=-1&botId&cursor` (admin) → AI messages with that rating: `{ messageId, conversationId, content, traceId, feedbackAt }`

- [ ] **Step 1: Write failing tests** — totals equal the sum of days; days without rows are present with zeros; playground usage counts cost but not conversations; `positiveRate` null with no feedback; unanswered excludes `handoff_intent` and playground; range over 366 days → 400.
- [ ] **Step 2–4: Fail → implement → pass.**
- [ ] **Step 5: Commit** — `git commit -s -m "feat(usage): usage, unanswered questions and negative feedback reports"`

---

### Task 6.6: Admin — inbox and notifications

**Files:**

- Create: `apps/admin/src/routes/_app/w/$workspaceId/conversations/index.tsx`, `apps/admin/src/features/conversations/{api.ts,components/{inbox-filters.tsx,conversation-list.tsx,status-badge.tsx}}`, `apps/admin/src/lib/notifications.ts`, `apps/admin/public/sounds/needs-human.mp3` (CC0 source noted in `THIRD_PARTY_NOTICES.md`)
- Modify: app shell nav (badge from `/conversations/counts`)
- Test: `apps/admin/src/features/conversations/*.spec.tsx`, `apps/admin/src/lib/notifications.spec.ts`

**Interfaces:**

- Produces: `useConversations(ws, filters)` (filters in URL search params), `useConversationCounts(ws)`; `notifyNeedsHuman(e: { conversationId; botName; preview }): void` — browser notification + sound only when the user opted in (`localStorage` flag, try/catch) and the tab is hidden; clicking it focuses the tab and opens the conversation.

- [ ] **Step 1: Write failing tests** — filters round-trip through the URL; `conversation.updated` with `needs_human` bumps the badge and calls `notifyNeedsHuman`; opt-in toggle requests permission only on click; no notification when the tab is visible; empty states per filter.
- [ ] **Step 2–4: Fail → implement → pass.**
- [ ] **Step 5: Commit** — `git commit -s -m "feat(admin): live inbox with needs-human badge and browser notifications"`

---

### Task 6.7: Admin — conversation view and replay drawer

**Files:**

- Create: `apps/admin/src/routes/_app/w/$workspaceId/conversations/$conversationId.tsx`, `apps/admin/src/features/conversations/components/{timeline.tsx,agent-composer.tsx,conversation-actions.tsx}`, `apps/admin/src/features/traces/{api.ts,components/{trace-drawer.tsx,retrieval-table.tsx,request-snapshot.tsx}}`
- Modify: playground "Open details" link (Task 4.12) → trace drawer
- Test: component tests

**Interfaces:**

- Produces: `useConversation`, `useSendAgentMessage`, `useTakeover`, `useHandback`, `useClose`, `useTrace(ws, traceId)`.

- [ ] **Step 1: Write failing tests** — timeline shows visitor/AI/agent/system messages with distinct styles and timestamps; AI messages show citations, feedback icon, and a "Details" button opening the drawer; drawer shows decision + reason, prompt version link, models, retrieval table (rank, score, used, title, preview, "source deleted"), collapsible request snapshot (JSON, monospace, copy button), tokens/cost/"price unknown"/latency/TTFT; composer shows "Sending as <name> will take over" when status ≠ human; `already_assigned` shows the owner's name; actions disabled per transition rules; new messages append live.
- [ ] **Step 2–4: Fail → implement → pass.**
- [ ] **Step 5: Commit** — `git commit -s -m "feat(admin): conversation view, agent actions and answer replay drawer"`

---

### Task 6.8: Admin — usage, unanswered, negative feedback pages

**Files:**

- Create: `apps/admin/src/routes/_app/w/$workspaceId/usage/{index.tsx,unanswered.tsx,feedback.tsx}`, `apps/admin/src/features/usage/{api.ts,components/{usage-chart.tsx,usage-totals.tsx}}`
- Test: component tests

- [ ] **Step 1: Write failing tests** — date range picker defaults to the current UTC month; chart of cost per day and messages per day (accessible: the same data also in a table toggle); totals tiles incl. escalation rate and feedback %; month-to-date vs cap bar when a cap exists; unanswered list links to the conversation and offers "Add knowledge" (opens add-source dialog for that bot); negative feedback rows open the trace drawer.
- [ ] **Step 2–4: Fail → implement → pass.** Use a lightweight chart library already justified in the PR, or plain SVG.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(admin): usage, unanswered questions and negative feedback pages"`

---

### Task 6.9: Browser test — full handoff flow

**Files:**

- Create: `e2e/tests/handoff.spec.ts`

- [ ] **Step 1: Write the browser test** — visitor on the host page asks an out-of-scope question → escalation with "Talk to a human" → clicks it, leaves email → Mailpit receives the handoff email → agent (second context) sees the "Needs human" badge, opens the conversation from the email link, takes over, replies → visitor sees the reply within 2 s (`expect.poll` with 2,000 ms timeout measured from the agent's click) → agent hands back → visitor's next question gets an AI answer → agent opens "Details" on that answer and sees retrieval rows and cost.
- [ ] **Step 2: Run** → PASS. Run the isolation suite → PASS, 0 uncovered.
- [ ] **Step 3: Commit and tag**

```bash
git add -A
git commit -s -m "test(e2e): end-to-end handoff flow"
git tag m6-done
```
