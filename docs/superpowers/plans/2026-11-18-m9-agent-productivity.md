# Milestone 9 — Agent Productivity and AI Assistance

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Turn the existing conversation inbox into a dependable daily workspace for support agents by adding explicit assignment and priority controls, complete customer context, saved replies, safe internal collaboration, and reviewable AI assistance.

**Product outcome:** An agent can understand who the customer is, see relevant history, claim or route the conversation, set urgency, collaborate privately, insert a reviewed response template, receive a concise handoff summary, and generate a grounded draft without leaving AiLoom. No AI-generated text is sent without an agent action.

**Architecture:** Reuse the existing conversation row locks, tenant repositories, audit service, `Llm` service, spend-cap enforcement, generation traces, and Postgres LISTEN/NOTIFY → admin SSE fan-out. This milestone does not add Redis, Socket.IO, or another stateful service.

**Spec:** `docs/spec.md`, `docs/architecture.md`. Index: `2026-11-09-00-index.md`.

## Delivery order and scope boundary

Build the workflow in the order agents use it:

```text
route work → understand customer → respond consistently → collaborate privately → use reviewed AI help
```

The milestone delivers:

- manual assignment and unassignment with an explicit role matrix;
- priority editing, inbox filtering, and stable priority-aware sorting;
- a contact sidebar with identity, safe attributes, conversation history, and CRM links;
- workspace saved replies that agents insert and edit before sending;
- generated handoff summaries and grounded suggested replies;
- private internal notes that cannot enter any customer or integration channel;
- audit, realtime, isolation, accessibility, performance, and end-to-end release gates.

The following remain out of scope: voice and telephony, round-robin or skills-based routing, agent presence, typing indicators, unread synchronization, SLA/business-hours automation, new messaging channels, contact tags, a full CRM record editor, autonomous agent actions, and auto-sending AI output. Those require broader product or infrastructure decisions and must not be smuggled into M9.

Milestone 8's connector catalog remains contract-tested against fake provider servers. Live-provider certification and ongoing sandbox smoke tests are a separate operational release gate; M9 may display existing CRM links but must not claim that every provider has been production-certified.

## Non-negotiable invariants

All index constraints apply. Milestone-specific constraints:

- Every read and write takes `workspaceId` first and resolves nested contact, member, conversation, reply, note, artifact, and integration IDs inside that workspace. A foreign ID returns `404`, not a revealing authorization error.
- Owner/admin may assign a conversation to any active workspace member or unassign it. Agents may assign an unassigned conversation to themselves and unassign only a conversation assigned to themselves. Removed members cannot remain selectable.
- Assignment, priority, status, and reply operations serialize through the existing conversation row lock. A stale write must not silently overwrite a newer agent's action.
- Conversations gain an integer `workflowVersion`, initialized to `1` and incremented atomically by assignment, priority, and status changes, plus the last client workflow mutation ID. New workflow mutations require the version last read and a UUID mutation ID: replaying the last mutation is an idempotent read of its result, while any other stale version returns `409 stale_conversation` with no mutation.
- All workspace members may set priority. Priority does not imply an SLA, deadline, or automated routing policy in M9.
- Saved replies are workspace-owned. Owner/admin can create, edit, archive, and reorder them; agents can search, read, and insert them. Insertion only changes the local composer and never sends immediately.
- Internal notes live in a separate tenant table, not in `messages` and not as a `system` role. Notes are excluded by construction from widget DTOs/SSE, email, webhook and CRM payloads, exports intended for contacts, and AI context unless a later explicit policy says otherwise.
- AI summaries and suggestions are drafts. They are visually labelled, never auto-sent, become ordinary agent text only after explicit insertion and send, and must be regenerated when the source conversation has changed.
- AI assistance is owner/admin-controlled per bot and defaults off for existing bots after migration. Suggested replies and automatic handoff summaries have separate switches, a visible cost/privacy disclosure, and an immediate kill switch that prevents new work without hiding existing artifacts.
- Agent-assist calls use the existing `Llm` abstraction, credential resolution, pricing, usage accounting, spend cap, redaction, and trace controls. No feature calls provider SDKs directly.
- Agent-assist endpoints use existing workspace/user rate-limit primitives and allow at most one active run per conversation and assist kind. Retries share an idempotency key; repeated clicks cannot multiply provider cost.
- Contact attributes and conversation text are untrusted data. They are size-capped, rendered as text, delimited in prompts, and cannot inject HTML, prompt roles, links, or tool calls.
- Realtime events carry identifiers and change hints only. Clients refetch authoritative data; event payloads never contain note bodies, contact attributes, saved-reply content, or AI draft content.

## Permission matrix

| Capability                       | Owner/admin                                  | Agent                      | Visitor/public/API key |
| -------------------------------- | -------------------------------------------- | -------------------------- | ---------------------- |
| Assign to any active member      | Yes                                          | No                         | No                     |
| Self-assign an unassigned thread | Yes                                          | Yes                        | No                     |
| Unassign                         | Yes                                          | Only when assigned to self | No                     |
| Change priority                  | Yes                                          | Yes                        | No                     |
| Read contact context/history     | Yes                                          | Yes                        | Scope unchanged        |
| Manage saved replies             | Yes                                          | Read/insert only           | No                     |
| Read/write internal notes        | Yes                                          | Yes                        | Never                  |
| Generate AI assistance           | Yes                                          | Yes                        | No                     |
| Send an agent reply              | Existing conversation ownership rules remain | Existing rules remain      | No                     |

## Review focus

1. **Two agents claim the same unassigned conversation at once.** Expected: the row lock chooses one winner; the loser receives `409 already_assigned`; no duplicate transition or misleading audit entry is written. → Task 9.1.
2. **An admin attempts to assign a user from another workspace, or a member removed moments earlier.** Expected: `404`; the existing assignment remains unchanged. → Task 9.1.
3. **A contact has hundreds of attributes or malicious HTML/prompt text.** Expected: bounded text-only rendering and delimited AI input; no script, role, or tool instruction is executed. → Tasks 9.3 and 9.6.
4. **An internal note is added to a conversation shared by email, webhook, CRM transcript, widget replay, and AI draft generation.** Expected: the note appears only to authorized admin users and in no external payload or default AI context. → Task 9.7.
5. **A visitor sends another message after a suggested reply is generated.** Expected: the draft is marked stale and cannot be sent as an AI suggestion without explicit review/regeneration; ordinary manual editing remains possible. → Task 9.6.
6. **The monthly spend cap is reached during summary generation.** Expected: the conversation remains usable, the assist action returns a safe unavailable state, no provider call bypasses the cap, and no half-written artifact appears. → Tasks 9.5 and 9.6.
7. **A workspace is deleted while assist work is queued.** Expected: the worker exits at its next tenant check; saved replies, notes, artifacts, and queued work are purged without touching another tenant. → Task 9.9.
8. **An agent repeatedly clicks Generate while AI assistance is disabled or a run is active.** Expected: no provider call when disabled; one provider call while active; deterministic disabled, in-progress, or rate-limited responses; no duplicate cost or artifact. → Tasks 9.5, 9.6, and 9.8.

---

### Task 9.1: Manual assignment and ownership controls

**Files:**

- Modify: `packages/shared/src/conversations.ts`, `packages/shared/src/events.ts`
- Modify: conversation entity/data-source registration and create a reviewed migration for `workflow_version` and `last_workflow_mutation_id`
- Modify: `apps/api/src/modules/conversations/{agent-actions.controller.ts,agent-actions.service.ts,conversations.repository.ts,inbox.repository.ts}`
- Modify: workspace-member query/repository used for active assignee choices
- Test: transition unit tests, conversation integration/e2e tests, route-isolation fixtures

**Interfaces:**

- Produces an assignment mutation accepting `assignedUserId: uuid | null`, `expectedWorkflowVersion`, and `mutationId`, and returning the authoritative assignee, status, and incremented `workflowVersion`.
- Preserves `POST …/takeover` as the fast self-claim action; both paths share one locked assignment implementation.
- Owner/admin can route to any active owner/admin/agent. An agent can claim only self and release only self.
- Assigning an `ai` or `needs_human` conversation moves it to `human`, aborts an active AI stream after commit, and writes one visible system transition. Reassigning an already-human conversation changes ownership without fabricating another handoff.
- Every successful change records actor, previous assignee, next assignee, conversation ID, and reason in the audit log, without customer message content.
- Emits `conversation.updated` after commit; retries and idempotent repeats do not create duplicate system messages or outbox events.

- [x] **Step 1: Write failing tests** — self-claim, admin assignment, reassignment, self-release, forbidden agent routing, removed/foreign member, concurrent claims, stale workflow version, idempotent retry, active-stream abort, audit, realtime, migration, and isolation.
- [x] **Step 2: Define shared request/response schemas and the exact role matrix.**
- [x] **Step 3–5: Fail → implement the locked service/repository path → pass.**
- [x] **Step 6: Add all new parameter/body references to the route-isolation inventory.**
- [x] **Step 7: Commit** — `git commit -s -m "feat(conversations): add manual assignment controls"`

### Task 9.2: Priority workflow and inbox routing UI

**Files:**

- Modify: `packages/shared/src/conversations.ts`, `packages/shared/src/enums.ts`
- Modify: `apps/api/src/modules/conversations/{conversations.controller.ts,conversations.service.ts,inbox.repository.ts}`
- Modify: `apps/admin/src/features/conversations/{api.ts,components/inbox.tsx,components/inbox-filters.tsx,components/conversation-actions.tsx}`
- Test: inbox repository integration tests, API e2e tests, admin component tests

**Interfaces:**

- Produces a priority mutation using the existing `low | normal | high | urgent` enum plus `expectedWorkflowVersion` and `mutationId`, returns the incremented version, and adds an optional priority inbox filter.
- Makes priority a typed field in list and detail contracts instead of an arbitrary string.
- Default inbox ordering remains predictable: conversations needing humans first, then priority rank, then `lastMessageAt DESC`, then UUIDv7 ID as the stable cursor tie-breaker.
- Adds an assignee picker, unassign action, priority selector, and clear filters for status, assignee, priority, bot, and search.
- Uses existing workspace SSE invalidation so assignment/priority changes made in another tab refetch list, counts, and detail without WebSockets.
- Reuses the existing opt-in browser-notification path to notify a member when another user assigns a conversation to them. Self-assignment, idempotent retries, and unassignment do not notify; the event contains no transcript or contact attributes.
- Controls are keyboard accessible, labelled, focus-stable after mutation, and expose pending/error states without optimistic ownership lies.

- [x] **Step 1: Write failing repository/API tests** — each priority filter, deterministic sort/cursor behavior, closed conversations, concurrent updates, and tenant isolation.
- [x] **Step 2: Write failing admin tests** — role-gated assignee options, priority changes, filter URL state, realtime invalidation, assignment notification rules, keyboard use, and mutation rollback.
- [x] **Step 3–5: Fail → implement API and UI → pass.**
- [x] **Step 6: Check the inbox query plan against the seeded large-workspace fixture; add/review an index only if measured.**
- [x] **Step 7: Commit** — `git commit -s -m "feat(inbox): add assignment and priority workflow"`

### Task 9.3: Contact context and conversation history

**Files:**

- Modify: `packages/shared/src/conversations.ts`
- Modify: `apps/api/src/modules/conversations/{contacts.repository.ts,conversations.controller.ts,conversations.service.ts,inbox.repository.ts}`
- Read through: `apps/api/src/modules/integrations/` for existing external contact links
- Create/modify: `apps/admin/src/features/conversations/components/contact-sidebar.tsx` and conversation detail composition
- Test: contact/history integration tests, API e2e tests, admin component tests

**Interfaces:**

- Expands the tenant-safe contact detail used by a conversation with `externalId`, bounded attributes, first/last seen times, and existing integration links.
- Adds cursor-paginated conversation history for the same contact, including bot, status, assignee, priority, and last-message preview; selecting history never crosses workspace boundaries.
- CRM links are generated only from stored provider IDs and configured provider base URLs. Arbitrary contact attributes never become clickable URLs.
- The UI uses a responsive sidebar/drawer and renders unknown attributes as escaped key/value text with depth, entry-count, key-length, and value-length limits.
- Email and external IDs have explicit copy actions; sensitive-looking attribute keys are masked by default and can be revealed only by a deliberate user action.
- Empty, anonymous, disconnected-integration, and deleted-member states remain understandable.

- [x] **Step 1: Write failing tests** — anonymous/identified contacts, multiple conversations, pagination, foreign contact/link IDs, deleted assignee, malicious attributes, oversized/nested attributes, and disconnected integrations.
- [x] **Step 2: Define the public-safe contact projection and rendering limits.**
- [x] **Step 3–5: Fail → implement repository/API/UI → pass.**
- [x] **Step 6: Run accessibility checks for drawer focus trapping, labels, copy feedback, and narrow screens.**
- [x] **Step 7: Commit** — `git commit -s -m "feat(inbox): add customer context sidebar"`

### Task 9.4: Workspace saved replies

**Files:**

- Create: `apps/api/src/modules/saved-replies/{saved-reply.entity.ts,saved-replies.repository.ts,saved-replies.service.ts,saved-replies.controller.ts,saved-replies.module.ts,index.ts}`
- Create: `packages/shared/src/saved-replies.ts`
- Create: database migration for `saved_replies`
- Create/modify: admin settings management and conversation composer picker
- Modify: workspace purge and entity/data-source registration
- Test: repository/service/e2e, isolation, admin component, migration and purge tests

**Interfaces:**

- Stores `workspace_id`, title, body, normalized search text, sort order, archived state, creator/updater, and timestamps. Bodies are plain text and use the agent-message size limit.
- Owner/admin CRUD is audited. Agents list/search active replies and insert one into the composer; archived replies remain available only to settings history and are never hard-deleted by ordinary edits.
- Search is case-insensitive and bounded; list ordering is `sortOrder`, normalized title, then ID. Active reply titles are unique per workspace case-insensitively through a reviewed partial database index; archiving releases the title for reuse.
- Insertion replaces the current composer only after confirmation when unsent text exists. It never calls the send endpoint.
- No template variable language ships in M9; literal braces and untrusted contact attributes cannot trigger interpolation.

- [x] **Step 1: Write the migration and failing tests** — role matrix, isolation, validation, search/order, archive/idempotency, audit, workspace purge, and schema drift.
- [x] **Step 2–4: Fail → implement API and tenant repository → pass.**
- [x] **Step 5: Write failing admin tests, then implement settings and composer picker.**
- [x] **Step 6: Run `pnpm db:check` and migration up/down/upgrade coverage.**
- [x] **Step 7: Commit** — `git commit -s -m "feat(conversations): add workspace saved replies"`

### Task 9.5: AI handoff summaries

**Files:**

- Create: `apps/api/src/modules/agent-assist/{conversation-ai-artifact.entity.ts,agent-assist.repository.ts,agent-assist.service.ts,agent-assist.module.ts,handoff-summary.job.ts,handoff-summary.processor.ts}`
- Create: `packages/shared/src/agent-assist.ts`
- Create: database migration for `conversation_ai_artifacts`
- Modify: handoff transition/outbox-adjacent path, usage accounting, generation trace origin/purpose, workspace purge
- Modify: conversation detail UI to show summary state and regenerate action
- Test: prompt/service unit tests, processor/integration/e2e tests, admin component tests

**Interfaces:**

- Enqueues an idempotent summary after a committed transition to `needs_human`; handoff itself never waits for or depends on the LLM.
- Automatic enqueue occurs only when an owner/admin has enabled automatic summaries for that bot. Existing bots migrate disabled; disabling the setting stops new jobs and queued jobs re-check it before calling a provider.
- Summarizes a bounded recent customer-visible transcript into structured fields: issue, actions already attempted, relevant customer facts, sentiment/urgency signals, and unresolved question. Unknown facts are omitted, never invented.
- Persists an immutable `handoff_summary` artifact with source-through message ID, prompt version, trace ID, creator (`system` or user), content, and timestamp. A later source message marks it stale; regeneration creates a new version.
- Uses the bot's configured chat credential/model through `Llm`, with spend-cap, pricing, token, latency, provider-error, and redacted request-snapshot accounting.
- Failure is non-blocking and visible as retryable/unavailable. There is no infinite retry and no summary content in realtime payloads.

- [x] **Step 1: Write failing tests** — disabled-by-default and kill-switch behavior, handoff enqueue only after commit, rollback/duplicate transitions, bounded transcript, prompt injection delimiters, factual omission, spend cap, provider error, stale versioning, deletion during job, audit, and isolation.
- [x] **Step 2: Define the bot settings, artifact schema, assist trace purpose/origin, prompt version, and retention behavior.**
- [x] **Step 3–5: Fail → implement worker/service/persistence → pass.**
- [x] **Step 6: Implement and test summary UI loading, stale, unavailable, and regenerate states.**
- [x] **Step 7: Commit** — `git commit -s -m "feat(agent-assist): generate handoff summaries"`

### Task 9.6: Grounded suggested replies

**Files:**

- Modify: `packages/shared/src/agent-assist.ts`
- Modify: `apps/api/src/modules/agent-assist/{agent-assist.service.ts,agent-assist.controller.ts,agent-assist.repository.ts}`
- Reuse/modify: retrieval, prompt assembly, traces, pricing, spend-cap, and credential services
- Modify: `apps/admin/src/features/conversations/components/reply-composer.tsx` and agent-assist UI
- Test: retrieval/prompt unit tests, API integration/e2e tests, admin component tests

**Interfaces:**

- Produces an explicit `Generate suggestion` action. It retrieves tenant- and bot-scoped knowledge, builds a bounded transcript prompt, and returns a draft with source citations and a source-through message ID.
- The action is available only when an owner/admin has enabled suggested replies for the bot. It uses per-user/workspace rate limits, one active run per conversation, and an idempotency key so duplicate clicks or request retries create one billed run.
- A suggestion is never written as a message and never sent automatically. `Insert draft` copies plain text into the composer; the agent can edit it, and the existing send action remains the only delivery path.
- The UI marks a suggestion stale whenever a newer conversation message exists and blocks one-click insertion until the agent confirms or regenerates.
- Suggested replies obey the same citation/link policy as visitor answers. No retrieval support produces a clearly labelled insufficient-context state rather than a confident invented answer.
- Each run persists a `suggested_reply` artifact and trace with actor, model, prompt version, retrieval IDs/scores, token usage, cost, and latency. Artifact access is tenant-scoped and follows transcript retention.
- Internal notes, hidden prompts, raw contact attributes, credentials, and integration secrets are excluded. Only the explicit safe contact projection may be included.

- [x] **Step 1: Write failing tests** — disabled/kill-switch behavior, grounded answer/citations, no-result behavior, no auto-send, stale source, malicious transcript/attribute text, note exclusion, cap/provider errors, rate limits, duplicate/in-flight generation, trace/usage, audit, and tenant isolation.
- [x] **Step 2: Reuse the existing retrieval and prompt safety primitives; add no parallel provider or accounting path.**
- [x] **Step 3–5: Fail → implement API/artifact persistence/UI → pass.**
- [x] **Step 6: Verify keyboard-only review/edit/send and screen-reader labels for generated, cited, stale, and error states.**
- [x] **Step 7: Commit** — `git commit -s -m "feat(agent-assist): add grounded reply suggestions"`

### Task 9.7: Private internal notes

**Files:**

- Create: `apps/api/src/modules/conversations/entities/internal-note.entity.ts`
- Create/modify: tenant repository, service, controller, module, and shared note contracts
- Create: database migration for `conversation_internal_notes`
- Modify: admin conversation timeline and note composer
- Modify: workspace purge/retention; explicitly review widget, email, integrations, exports, search, and AI context paths
- Test: repository/e2e/isolation/admin tests plus cross-channel non-leak regression suite

**Interfaces:**

- Stores a tenant-scoped note with conversation, author, plain-text body, integer version, created/edited timestamps, and deletion tombstone metadata. Notes are not messages and do not update `lastMessageAt`, unread/customer state, email jobs, or integration outbox events.
- Owner/admin/agent can create and read notes. An agent may edit or delete only their own note; owner/admin may moderate any note. Edit/delete requires the version last read and returns `409 stale_note` on conflict. Delete clears the body and retains author/time/tombstone metadata. Every mutation is audited without copying the current or previous body into audit details.
- Admin realtime emits only `internal_note.created|updated|deleted` plus IDs. The admin fetches authorized content through the notes API.
- The timeline visually distinguishes private notes from customer-visible messages and warns that notes are workspace-visible, not personal.
- A dedicated non-leak suite proves notes are absent from widget history/events, agent-reply email, handoff email, webhooks, all CRM transcript modes, public API conversation/message payloads, contact-facing exports, full-text message search, and default AI summary/suggestion context.

- [x] **Step 1: Write the migration and failing CRUD tests** — role/author policy, validation, edit/delete races, audit, realtime IDs, isolation, retention, and purge.
- [x] **Step 2: Write the failing non-leak matrix before wiring notes into the UI.**
- [x] **Step 3–5: Fail → implement separate persistence/API/UI → pass all channels.**
- [x] **Step 6: Add an architectural dependency test or explicit allowlist preventing note entities/services from integration and visitor delivery modules.**
- [x] **Step 7: Commit** — `git commit -s -m "feat(conversations): add private internal notes"`

### Task 9.8: AI-assistance quality, safety, and observability gate

**Files:**

- Create: curated agent-assist evaluation fixtures and deterministic scorer under `apps/api/test/agent-assist/`
- Create: manual live-provider release evaluation workflow that never runs in ordinary CI
- Modify: agent-assist metrics/diagnostics and operator documentation
- Test: deterministic fake-model contract/evaluation suite, prompt regression suite, telemetry redaction tests

**Interfaces:**

- Provides at least 25 versioned scenarios covering long and short handoffs, ambiguity, conflicting messages, no relevant knowledge, stale context, malicious instructions, sensitive attributes, multilingual text, provider refusal, and internal-note exclusion.
- CI uses the mock provider and deterministic outputs to enforce structure, bounded input, resolved citation IDs, no forbidden fields, no internal-note text, no secret markers, no fabricated external links/IDs, correct stale detection, and no send-side effect. It does not use a flaky LLM judge or real network.
- A documented manual workflow runs the same dataset against a configured live model before release and records model/version, prompt version, factual-support score, citation-support score, useful-draft score, latency, token use, and cost. Release thresholds are declared before running the evaluation; a threshold failure blocks release until the prompt, implementation, or supported-model configuration is corrected and the suite passes.
- Metrics expose run count, success/error/cap/rate-limit outcomes, queue and provider latency, tokens, and cost by assist kind and model. Metric labels and logs never contain prompts, drafts, notes, customer identifiers, or attribute values.
- Diagnostics show whether each assist mode is enabled and whether its configured bot credential/model is usable, without exposing credential material.

- [x] **Step 1: Define the versioned fixture format, deterministic safety assertions, manual rubric, and release thresholds before tuning prompts.**
- [x] **Step 2: Add failing fixtures for leakage, unsupported claims/links, broken citations, stale drafts, prompt injection, disabled mode, and duplicate generation.**
- [x] **Step 3–5: Fail → implement the evaluation runner and prompt/service fixes → pass.**
- [x] **Step 6: Add redacted metrics/diagnostics and prove no high-cardinality or content-bearing labels are emitted.**
- [x] **Step 7: Commit** — `git commit -s -m "test(agent-assist): add quality and safety release gate"`

### Task 9.9: Release hardening, documentation, and demo

**Files:**

- Modify: `apps/api/test/isolation/{route-inventory.ts,isolation-fixtures.ts,isolation.e2e.spec.ts}`
- Create/modify: Playwright inbox workflow and accessibility coverage
- Modify: seed data for priorities, assignments, contact context, saved replies, notes, summaries, and suggestions
- Modify: `apps/docs/src/content/docs/`, `docs/spec.md`, `docs/architecture.md`, `README.md`, `CHANGELOG.md`
- Test: full repository gates, migration/upgrade/restore, leak, load, and fake-provider suites

**Interfaces:**

- Every new route is present in the isolation inventory; every nested/body resource reference has an A-vs-B workspace test and returns `404` without mutation.
- The release suite covers assignment races, removed-member assignment, deterministic inbox pagination, stale AI drafts, spend caps, queued work during deletion, and the complete internal-note non-leak matrix.
- Seed/demo mode includes a realistic urgent handoff with contact history, a CRM link, an internal note, a saved reply, a generated summary, and a grounded suggestion.
- Docs explain permissions, assignment/priority semantics, contact data handling, saved replies, note privacy, AI draft review, costs, failure states, and the explicit no-auto-send guarantee.
- Load checks protect inbox p95 and AI assistance does not increase visitor message time-to-first-token because summaries are asynchronous and suggestions are agent-initiated.
- Establish an M8 inbox baseline before implementation. On the standard single-host performance fixture, M9 may not regress inbox-list p95 by more than 10%; assignment and priority mutations must remain below 300 ms p95 at 20 concurrent agents. Any threshold change requires captured evidence and plan review.
- Backup/restore retains saved replies, notes, artifacts, settings, and provenance. Workspace deletion and conversation/contact retention remove linked notes and artifacts; no orphaned queued jobs or rows remain. Contact-facing exports continue to exclude internal notes and AI drafts.

- [x] **Step 1: Complete route/body-reference isolation and secret/PII leak coverage.**
- [x] **Step 2: Add Playwright workflow** — filter urgent/unassigned, assign, inspect contact history, add note, insert saved reply, generate/review suggestion, send manually, close.
- [x] **Step 3: Add axe checks and narrow-screen coverage for inbox, contact drawer, notes, and composer.**
- [x] **Step 4: Run migration fresh-install, up/down where supported, upgrade-from-M8, backup/restore, workspace purge, and `pnpm db:check`.**
- [x] **Step 5: Run format, lint, typecheck, build, unit, integration, API e2e, admin, widget, Playwright, agent-assist evaluation, dependency, license, audit, and docs gates.**
- [ ] **Inbox performance gate remains open.** PR #15's retrospective comparison recorded M8 inbox p95 at 16.62 ms and M9 at 46.90 ms (182.2% regression); the clean repeat was 70.95 ms (326.8% regression). Assignment p95 was 323.44 ms and 348.12 ms, above the 300 ms limit. See [M9 release evidence](../../m9-release-evidence.md) and [PR #15](https://github.com/li4nee/Ailoom/pull/15). The existing `m9-done` tag does not close this gate.
- [x] **Step 6: Execute the seeded demo and capture release evidence; do not mark live CRM certification complete from fake-server evidence alone.**
- [x] **Step 7: Update release notes and commit** — `git commit -s -m "docs: complete M9 agent productivity release gate"`

## Definition of done

- An authorized user can route, release, and prioritize a conversation with deterministic concurrent behavior and a complete audit trail.
- Agents can filter the inbox and see changes from other sessions through the existing SSE/NOTIFY path.
- The conversation view provides bounded, tenant-safe customer identity, attributes, history, and existing CRM links.
- Workspace saved replies are role-controlled, searchable, editable before sending, isolated, and purged correctly.
- Every human handoff may receive a versioned, non-blocking, traceable summary whose failure never blocks support work.
- An agent can request a grounded, cited draft, see when it is stale, edit it, and send only through the ordinary explicit reply action.
- Internal notes remain private across every visitor, email, webhook, CRM, export, search, and default AI-context path covered by the non-leak suite.
- All AI assistance obeys configured credentials, spend caps, pricing, usage, trace, retention, and deletion rules.
- Owners/admins can independently enable or kill automatic summaries and suggested replies; disabled, duplicate, in-flight, and rate-limited requests make no extra provider calls or charges.
- The deterministic assist evaluation passes in CI, the live-model release workflow has recorded evidence against predeclared thresholds, and operational metrics contain no customer content.
- New tables, routes, body references, events, jobs, and UI states pass schema drift, tenant isolation, migration, accessibility, security, and performance checks.
- CI is green on `main`; documentation and release notes are current; the seeded instance demonstrates the complete workflow; only then tag `m9-done`.
