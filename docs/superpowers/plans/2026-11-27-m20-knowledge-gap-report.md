# M20 Knowledge Gap Report

Status: Implemented and validated on `m20-knowledge-gap-report`.

## Outcome

Give workspace admins a ranked list of the questions their bots repeatedly could not answer from
knowledge. An admin can pick a bot and date range, see how often a gap came up, open example
conversations, and use the existing knowledge workflow to address it.

## 1. Define what the report counts

- Start from the same eligible widget traces as the [Unanswered report](../../../apps/api/src/modules/traces/traces.repository.ts).
  Include `escalated` traces with `no_knowledge` or `top_score_below_threshold`. These include
  configured fallback replies even if no agent was requested. Exclude handoff intent, provider
  errors, spend caps, other outcomes, and non-widget traffic. Tool-assisted answers count only
  when their final trace matches the same criteria.
- Count each visitor message once, even if it has multiple eligible traces. Count different
  messages in one conversation as separate occurrences and show the distinct conversation count
  alongside them so repeated attempts are visible.
- Group within each workspace and bot. For the first release, lowercase question text, trim it,
  collapse whitespace, and strip trailing question marks. Preserve word order, accents, internal
  punctuation, and digits. If normalization would erase a nonblank question, retain its trimmed
  text as the grouping key. For example, “Where is the return policy?” and “ where is the return
  policy ” group together. “How do I return an item?” stays separate. Label the result as repeat
  wording so admins understand which questions are grouped.
- Use retained messages and traces. Report counts may change as records expire or are deleted.
  Feedback remains in its own report because a thumbs-down can flag an incorrect answer even when
  retrieval found useful material.

## 2. Build the report API

- Add `GET /v1/workspaces/:workspaceId/knowledge-gaps` to the existing admin quality reports
  controller. Add shared response and query schemas in `packages/shared/src/reports.ts`. Accept
  optional `botId` and required `from` and `to` UTC dates. Reject invalid calendar dates, reversed
  ranges, and ranges over 90 inclusive days. Query timestamps from the first midnight through the
  start of the day after `to`, excluding that upper bound.
- Query PostgreSQL on demand through the traces repository. Filter by workspace, widget origin,
  escalation reason, and date before grouping. Keep every trace, message, conversation, and bot
  lookup workspace scoped. Follow outcomes report behavior for a bot outside the workspace.
- Return up to 50 groups sorted by occurrence count descending, then most recent occurrence and
  a stable grouping key for ties. Report total qualifying messages and total groups across the
  full filtered range so the UI can disclose when it shows only the top 50. Include bot identity,
  last seen time, counts, daily occurrence counts, and up to three recent examples per group.
  Resolve equal example timestamps by message ID. Return plain-text excerpts and conversation
  links for examples, with full transcripts available through the existing conversation view.
- Benchmark the busiest supported date range against seeded retained traces before shipping.
  Inspect the query plan before adding an index. The first release uses the existing database,
  with no model calls, background jobs, or duplicate store of customer questions.

  **Benchmark result:** The 90-day report was exercised against 5,000 seeded retained messages and
  traces. The first detail-query shape took about 23 seconds because it built trends and examples
  for every group. Selecting the top 50 before building those details reduced the end-to-end request
  to about 91 ms in the local PostgreSQL test container. No index was added. This is a local fixture
  measurement, not a production latency guarantee.

## 3. Build the admin workflow

- Add **Usage → Knowledge gaps** beside **Unanswered** and **Feedback** for workspace owners and
  admins. Default to the last 30 UTC calendar days, including today, and all bots. Reuse the
  existing usage filters and loading, empty, and error patterns. Support keyboard access and
  narrow screens.
- Show the most common question wording groups first, with the bot, occurrence and conversation
  counts, and last seen time. Show the daily trend and example conversations when a group expands.
  Label the selected range and show a limit message when more than 50 groups match.
- Add a **Review knowledge** action that opens the existing add-source flow for the group's bot.
  Use the example wording as a prompt for what to document, and let the admin choose what to
  write. Keep customer text out of new sources by default. Link to the existing correction queue
  for reviewed AI answers and document how approved corrections can seed evaluation cases. A gap
  can come from missing content or weak retrieval, so suggest checking **Test retrieval** before
  writing a new article.

## 4. Validate and ship

- Cover duplicate traces, fallback replies, excluded origins and reasons, normalization, bot
  and workspace isolation, invalid dates, UTC boundaries, and counts beyond the display limit.
  Confirm direct API requests enforce the same admin permissions as the other quality reports.
- Exercise the report with seeded repeated questions, different bots, and no matching results.
  Check the trend, filter changes, conversation links, and bot selected in the add-source dialog.
- Update the analytics guide and README with the report definition, grouping limits, and review
  workflow when the feature ships. Keep semantic clustering, generated document recommendations,
  and scheduled digests as follow-up options if the first report shows demand for them.

## Validation completed

- API e2e covers message deduplication, normalized wording, widget/reason filtering, bot filtering,
  date validation, workspace-scoped bot lookup behavior, admin-only authorization, and totals beyond
  the 50-group response cap.
- Admin usage tests cover the report group, conversation/correction links, and knowledge workflow.
- `pnpm typecheck`, API and admin lint, the admin test suite, and the report e2e suite pass.
- README and analytics docs describe the report's eligibility, exact grouping behavior, limits, and
  review workflow. Semantic clustering and scheduled digests remain future scope.
