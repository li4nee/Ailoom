# M11 — Analytics and CSAT Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Answer "does the bot work?" with outcome metrics: AI resolution rate, handoff rate,
first human response time, resolution time, CSAT, and cost per resolved conversation.

**Architecture:** Visitors rate a conversation 1–5 once it closes, stored on `conversations`. A new
`OutcomesRepository` computes every metric in SQL over conversations _created_ in the report
range. It reuses the existing `usageQuerySchema` (`from`, `to`, `botId`), so the UTC day buckets
and the bot filter match the usage page. There is no rollup table yet; the queries are bounded to
a 92-day range and indexed. Add a rollup only if the perf benchmark shows a need.

**Tech Stack:** NestJS, Postgres, Zod, React admin (existing usage chart components), Preact widget.

**Spec:** `docs/spec.md` §27 "Analytics: AI resolution rate, handoff rate, first response time,
resolution time, CSAT (end-of-conversation rating), cost per resolved conversation."

## Global Constraints

See `2026-11-24-00-phase2-index.md`.

## Metric definitions (exact; documented on the report page and docs site)

The population is conversations with `created_at` in `[from 00:00Z, to+1 00:00Z)`, for the
workspace and, when given, the bot. Each conversation needs at least one visitor message.

| Metric                             | Definition                                                                                                                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conversations                      | count of the population                                                                                                                                                            |
| Handoff rate                       | `handoff_requested_at IS NOT NULL` / conversations                                                                                                                                 |
| AI-resolved                        | `handoff_requested_at IS NULL` AND ≥ 1 complete `ai` message AND no `ai` message with `feedback = -1` AND (`status = 'closed'` OR `last_message_at < now() - interval '24 hours'`) |
| AI resolution rate                 | AI-resolved / (conversations that are AI-resolved or handed off). Open conversations still inside the 24 h window are excluded from the denominator and reported as "pending".     |
| First human response (median, p90) | for handed-off conversations: first `agent` message `created_at` − `handoff_requested_at`; conversations with no agent reply are counted as "unanswered", not as zero              |
| Resolution time (median, p90)      | for handed-off conversations that are closed: `closed_at` − `handoff_requested_at`                                                                                                 |
| CSAT                               | share of ratings ≥ 4 among rated conversations, plus average score and response rate (rated / closed)                                                                              |
| Cost per resolved conversation     | `sum(generation_traces.cost_usd)` for the population's conversations / (AI-resolved + closed handed-off). Includes agent-assist traces; excludes playground.                       |

## Review Focus

1. A range with zero conversations: every rate shows "—", not `NaN` or a division by zero. Test it in Task 2.
2. A conversation is handed off twice (handback, then a second handoff): the first `handoff_requested_at` counts, and the first agent reply after it counts. Test it in Task 2.
3. The visitor rates, then the conversation reopens (a new visitor message after close): keep the rating, and only one rating per conversation is allowed (`409 conflict` on the second). Test it in Task 1.
4. The bot filter and workspace isolation: a foreign workspace's `botId` returns `not_found`, and metrics never cross workspaces. Test it in Task 2 and add to the route-isolation inventory.
5. A 92-day range on 50k conversations stays under 300 ms p95 on the perf overlay. Add it to the perf benchmark in Task 2.

---

### Task 1: End-of-conversation rating (API + widget)

**Files:**

- Create: `apps/api/src/db/migrations/<ts>-conversation-csat.ts`
- Modify: `apps/api/src/modules/conversations/entities/conversation.entity.ts`
- Modify: `packages/shared/src/widget.ts` (`rateConversationSchema`)
- Create: `apps/api/src/modules/widget/widget-rating.controller.ts`
- Modify: `apps/api/src/modules/widget/widget.service.ts`, `widget.module.ts`
- Modify: `packages/widget/src/main/state.ts`, `packages/widget/src/main/ui/` (new `rating-prompt.tsx`), `packages/widget/src/i18n/*`
- Modify: `apps/api/src/modules/bots` appearance settings (`csatEnabled: boolean`, default `true` for new bots, `false` for existing bots in the migration)
- Test: `apps/api/test/e2e/widget-rating.e2e.spec.ts`, `packages/widget/src/main/rating-prompt.spec.tsx`

**Interfaces:**

- Produces: columns `conversations.csat_score smallint NULL CHECK (csat_score BETWEEN 1 AND 5)`, `csat_comment text NULL CHECK (char_length(csat_comment) <= 1000)`, `csat_at timestamptz NULL`.
- Produces: `POST /api/widget/v1/conversations/:conversationId/rating` with body `{ score: 1..5, comment?: string }`, response `204`. It requires the visitor token that owns the conversation (`widget.ownConversation`), requires `status = 'closed'` (otherwise `conflict`), allows exactly one rating (`conflict` if `csat_score` is set), and is rate-limited like feedback.
- Produces: widget config field `csatEnabled: boolean`.

- [ ] **Step 1: Write failing API tests** — rates a closed conversation; second rating → 409; open conversation → 409; foreign visitor → 404; score 0 or 6 → 400; comment over 1000 chars → 400; `csatEnabled = false` → 404.
- [ ] **Step 2: Write failing widget tests** — the prompt appears when the conversation status changes to `closed` and `csatEnabled`. Five labelled buttons (keyboard and screen-reader accessible), an optional comment, and Submit, then a thank-you. Dismissing hides it for that conversation. The prompt is not shown when `csatEnabled` is false.
- [ ] **Step 3:** Run both. Expected: FAIL.
- [ ] **Step 4:** Implement the migration, endpoint, config flag and widget UI. Strings go through the widget i18n catalog; the bot appearance tab gets a "Ask for a rating when a conversation closes" toggle.
- [ ] **Step 5:** Run the tests plus `pnpm --filter @app/widget size`. Expected: PASS and within the bundle budget.
- [ ] **Step 6: Commit** — `git commit -s -m "feat(widget): ask visitors to rate closed conversations"`

### Task 2: Outcomes repository and endpoint

**Files:**

- Create: `apps/api/src/modules/usage/outcomes.repository.ts`
- Create: `apps/api/src/modules/usage/outcomes.service.ts`
- Modify: `apps/api/src/modules/usage/usage.controller.ts` (`GET v1/workspaces/:workspaceId/usage/outcomes`)
- Create: `packages/shared/src/outcomes.ts`
- Create: `apps/api/src/db/migrations/<ts>-outcome-indexes.ts` (only the indexes EXPLAIN shows are needed, e.g. `conversations (workspace_id, created_at)` and `messages (workspace_id, conversation_id, role, created_at)` if missing)
- Test: `apps/api/src/modules/usage/outcomes.int.spec.ts`
- Modify: `apps/api/test/perf/` (an `outcomes-latency.ts` benchmark, wired into `perf.yml`)

**Interfaces:**

- Consumes: `usageQuerySchema` from `packages/shared/src/reports.ts`, plus a new refinement that the range is ≤ 92 days.
- Produces: `OutcomesDto`:

```ts
{
  conversations: number;
  pending: number;
  handoffRate: number | null;
  aiResolutionRate: number | null;
  aiResolved: number;
  handedOff: number;
  firstHumanResponse: {
    medianSeconds: number | null;
    p90Seconds: number | null;
    unanswered: number;
  }
  resolutionTime: {
    medianSeconds: number | null;
    p90Seconds: number | null;
  }
  csat: {
    satisfiedRate: number | null;
    averageScore: number | null;
    responseRate: number | null;
    ratings: number;
  }
  costPerResolvedUsd: string | null;
  daily: {
    day: string;
    conversations: number;
    aiResolved: number;
    handedOff: number;
  }
  [];
}
```

- Produces: `OutcomesRepository.compute(workspaceId: WorkspaceId, query: UsageQuery, now: Date): Promise<OutcomesDto>`. It uses one statement per metric group with `percentile_cont` for the medians, and raw SQL with the "why" comment.

- [ ] **Step 1: Write failing integration tests** with a fixture that covers each row of the definitions table, including:
  - an empty range
  - a double handoff
  - an unanswered handoff
  - a thumbs-down AI-only conversation (not resolved)
  - an open conversation inside 24 h (pending)
  - a closed conversation outside 24 h
  - a foreign-workspace bot
  - a range over 92 days → 400

  Assert the exact numbers.

- [ ] **Step 2:** Run `pnpm --filter @app/api test:int src/modules/usage/outcomes.int.spec.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Use the injected `Clock` for `now`. Admins and agents can read it (same roles as the usage page).
- [ ] **Step 4:** Run the tests, `pnpm db:check`, and the new benchmark with 50k conversations. Expected: PASS, p95 < 300 ms.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(usage): compute conversation outcome metrics"`

### Task 3: Outcomes report UI and docs

**Files:**

- Create: `apps/admin/src/features/usage/components/outcomes-report.tsx`
- Modify: the usage route (add an "Outcomes" tab, the default tab), `apps/admin/src/features/usage/api.ts`, strings
- Modify: `apps/docs/src/content/docs/` (a new `analytics.md` with the definitions table), `README.md`
- Test: `apps/admin/src/features/usage/outcomes-report.spec.tsx`

- [ ] **Step 1: Write failing admin tests**:
  - Renders each metric card with its definition tooltip.
  - Shows "—" for null values.
  - Shows a daily stacked chart (resolved vs handed-off).
  - Reuses the date and bot filters with URL state.
  - Shows loading, error and zero states.
  - Is keyboard-usable at 375 px.
- [ ] **Step 2:** Implement with the existing `usage-chart.tsx` primitives. Run `pnpm --filter @app/admin exec vitest run src/features/usage`. Expected: PASS.
- [ ] **Step 3:** Write `analytics.md`: the definitions table verbatim, how CSAT is collected, and the 24 h pending rule.
- [ ] **Step 4: Commit** — `git commit -s -m "feat(admin): add the conversation outcomes report"`
