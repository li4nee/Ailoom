# M14 — Knowledge Freshness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep crawled knowledge current: scheduled recrawls, unreachable-page detection, a "not
refreshed in N days" report, version history with a diff view, and a manual content editor.

**Architecture:** A pg-boss cron job finds URL and sitemap sources whose `recrawl_interval` has
elapsed and runs the existing resync path, which already skips unchanged pages by content hash
(`versioning.service.ts`). Page fetches record a check time and an unreachable time on the
document. Sitemap pages that disappear are marked `removed` and lose their current version, which
takes them out of retrieval without touching the retrieval query. Version diffs are computed
server-side. Manual edits create a new `document_versions` row with `edited_by` and re-embed it
through the existing pipeline.

**Tech Stack:** NestJS, pg-boss schedules, Postgres, `diff` (jsdiff, BSD-3-Clause) for line diffs, React admin.

**Spec:** `docs/spec.md` §27 "Knowledge freshness: scheduled recrawl per source,
`document_versions` history with diff view, unreachable-page detection, 'stale for N days' report,
manual content editor (creates a new version)". It uses the reserved Phase 2 columns
`knowledge_sources.recrawl_interval`, `last_synced_at`, `document_versions.edited_by` and
`document_status = 'unreachable' | 'removed'`.

## Global Constraints

See `2026-11-24-00-phase2-index.md`. The new runtime dependency `diff` must be justified in the PR
(what: line diff; why: correct LCS diff without a hand-rolled algorithm; license: BSD-3-Clause; size).

## Decisions

- **Recrawl interval:** allowed values are `null` (off, the default), `1 day`, `7 days` and `30 days`, for `url` and `sitemap` sources only. `text` and `file` sources reject a non-null interval.
- **Due:** a source is due when `status = 'ready'` AND `recrawl_interval IS NOT NULL` AND `coalesce(last_synced_at, created_at) + recrawl_interval <= now()`. The scheduler runs every 15 minutes, claims due sources with `FOR UPDATE SKIP LOCKED`, and enqueues at most 25 per tick. The per-domain crawl limits still apply.
- **Unreachable:** a page fetch that returns HTTP 404/410 or fails DNS/connection on a recrawl sets `documents.status = 'unreachable'` and `unreachable_since` (if not already set). The document keeps its current version and stays searchable, since the content was valid when it was fetched. A later successful fetch clears both.
- **Removed:** a page absent from a recrawled sitemap sets `status = 'removed'` and `current_version_id = NULL`. The page drops out of retrieval through the existing `JOIN documents d ON d.current_version_id = c.document_version_id`, and its versions are kept for history.
- **Not refreshed in N days:** the report lists documents where `coalesce(last_checked_at, current_version.created_at) < now() - N days`, or where `status = 'unreachable'`. N defaults to 90 and must be 7–365.
- **Manual edit:** allowed only for documents of `text` and `file` sources. URL and sitemap content would be overwritten by the next crawl, so editing them returns `conflict` with a message saying so. An edit equal to the current content (same hash) returns `{ changed: false }`.

## Review Focus

1. A recrawl runs while an admin is editing or deleting the source: the scheduler skips sources not in `ready` status, and deletion wins. Test it in Task 1.
2. A site that is down for one tick: the page becomes `unreachable` but stays searchable, then recovers on the next success. Test it in Task 1.
3. A huge sitemap with an interval of `1 day`: enqueue is capped at 25 sources per tick, and the domain slots throttle page fetches. Assert the cap in Task 1.
4. Diff of two versions from different documents → 404. A diff of a very large document is capped at 200 KB of output with a `truncated` flag. Test it in Task 2.
5. The bot's embedding model changes while an edit is re-embedding: the edit uses the existing generation-based cancellation from the reembed module. Test that the newest model wins, in Task 3.

---

### Task 1: Scheduled recrawl and unreachable detection

**Files:**

- Create: `apps/api/src/db/migrations/<ts>-document-freshness.ts` (`documents.last_checked_at timestamptz NULL`, `documents.unreachable_since timestamptz NULL`, index `knowledge_sources (status, recrawl_interval) WHERE recrawl_interval IS NOT NULL`)
- Create: `apps/api/src/modules/knowledge/freshness/recrawl-scheduler.processor.ts`, `freshness.repository.ts`
- Modify: `apps/api/src/modules/knowledge/knowledge.jobs.ts` (`knowledge.schedule_recrawls`, cron `*/15 * * * *`)
- Modify: `apps/api/src/modules/knowledge/ingest/ingest-page.processor.ts`, `fetch-page.ts` (record check and unreachable status), the sitemap path in `ingest-source.processor.ts` (mark removed pages)
- Modify: `packages/shared/src/knowledge.ts` (`recrawlInterval: '1 day' | '7 days' | '30 days' | null` on create/update/DTO)
- Modify: `apps/api/src/modules/knowledge/sources.service.ts` (validate the interval per source type)
- Test: `apps/api/src/modules/knowledge/freshness/recrawl.int.spec.ts`

**Interfaces:**

- Produces: `FreshnessRepository.claimDueSources(now: Date, limit: number): Promise<{ workspaceId: string; sourceId: string }[]>`. Raw SQL with `FOR UPDATE SKIP LOCKED`, then `SourcesService.resync(workspaceId, sourceId, SYSTEM_ACTOR)`.
- Produces: `DocumentDto` fields `lastCheckedAt: string | null`, `unreachableSince: string | null`; `KnowledgeSourceDto.recrawlInterval`.

- [ ] **Step 1: Write failing tests** (fake fetch, fixed `Clock`):
  - A due source is resynced, and a non-due one is not.
  - A source not in `ready` status is skipped.
  - The cap of 25 per tick holds.
  - An unchanged page creates no new version but updates `last_checked_at` and `last_synced_at`.
  - A 404 sets `unreachable` + `unreachable_since` and the page stays searchable.
  - Recovery clears both.
  - A page missing from the sitemap becomes `removed`, and retrieval no longer returns its chunks.
  - An interval on a text source → 400.
- [ ] **Step 2:** Run `pnpm --filter @app/api test:int src/modules/knowledge/freshness`. Expected: FAIL.
- [ ] **Step 3:** Implement. Make sure the system actor is accepted by the audit writer (`actorUserId: null`, `actorType: 'system'`).
- [ ] **Step 4:** Run the knowledge integration suite, `pnpm db:check`, and the retrieval benchmark. Expected: PASS, and no retrieval regression.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(knowledge): recrawl sources on a schedule and detect unreachable pages"`

### Task 2: Version history, diff and the freshness report

**Files:**

- Modify: `apps/api/src/modules/knowledge/versions.repository.ts`, `sources.controller.ts`
- Create: `apps/api/src/modules/knowledge/freshness/version-diff.ts`
- Create: `packages/shared/src/freshness.ts`
- Test: `apps/api/src/modules/knowledge/freshness/versions.int.spec.ts`, `version-diff.spec.ts`

**Interfaces:**

- Produces:
  - `GET v1/workspaces/:workspaceId/bots/:botId/documents/:documentId/versions` → `{ data: { id, createdAt, contentHash, editedBy: { id, name } | null, isCurrent }[] }`
  - `GET …/documents/:documentId/versions/:fromId/diff/:toId` → `{ hunks: { oldStart, oldLines, newStart, newLines, lines: { kind: 'add' | 'remove' | 'context'; text: string }[] }[]; truncated: boolean }`
  - `GET v1/workspaces/:workspaceId/knowledge/freshness?botId=&days=&cursor=` → `{ data: { documentId, sourceId, title, url, status, lastCheckedAt, lastChangedAt, unreachableSince }[]; nextCursor }`
- Produces: `diffVersions(oldText: string, newText: string, maxOutputBytes = 200_000): VersionDiff` in `version-diff.ts`, using `structuredPatch` from `diff` with 3 context lines.

- [ ] **Step 1: Write failing tests**:
  - Versions list is newest first and marks the current one.
  - The diff of two known texts produces the expected hunks.
  - Identical versions produce no hunks.
  - Mismatched document ids → 404.
  - Output over 200 KB sets `truncated`.
  - The freshness report filters by `days` and the bot, includes unreachable documents, rejects `days` outside 7–365 (400), and doesn't leak across workspaces.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement and add the routes to the isolation inventory.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(knowledge): document version history, diffs and freshness report"`

### Task 3: Manual content editor (API)

**Files:**

- Modify: `apps/api/src/modules/knowledge/ingest/versioning.service.ts` (accept `editedBy`)
- Modify: `apps/api/src/modules/knowledge/sources.controller.ts`, `sources.service.ts`
- Test: `apps/api/src/modules/knowledge/freshness/manual-edit.int.spec.ts`

**Interfaces:**

- Produces: `PUT v1/workspaces/:workspaceId/bots/:botId/documents/:documentId/content` with body `{ content: string }` (1 B–200 KB) → `{ changed: boolean; versionId: string | null }`. It creates a version with `edited_by = actor` and enqueues `knowledge.embed_chunks` for it. Owner/admin only.

- [ ] **Step 1: Write failing tests**:
  - An edit creates a version with `edited_by` and is re-embedded; retrieval returns the new text after the embed job.
  - The same content → `{ changed: false }`.
  - URL/sitemap documents → 409 with the documented message.
  - Agent role → 403.
  - An audit row is written.
  - An embedding-model change during the embed leaves the newest model's chunks only.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement on the existing versioning and embedding services. Don't add a parallel pipeline.
- [ ] **Step 4:** Run the knowledge suites. Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(knowledge): edit text and file document content as a new version"`

### Task 4: Admin UI and docs

**Files:**

- Modify: `apps/admin/src/features/knowledge/components/source-detail.tsx` (recrawl interval select, last checked, unreachable badges)
- Modify: `apps/admin/src/features/knowledge/components/document-viewer.tsx` (a Versions panel with a two-version picker and a unified diff view; an Edit button for text/file documents with a textarea editor and save)
- Create: `apps/admin/src/features/knowledge/components/freshness-report.tsx` (Knowledge → Freshness tab with a days filter)
- Modify: knowledge `api.ts`, routes, strings; `apps/docs/src/content/docs/` (a `knowledge-freshness.md` page); `README.md`
- Test: `apps/admin/src/features/knowledge/freshness.spec.tsx`

- [ ] **Step 1: Write failing admin tests**:
  - The interval select only shows for URL/sitemap sources.
  - Unreachable and removed badges render with a tooltip.
  - The diff view marks added and removed lines with text labels, not colour alone.
  - The Edit button is hidden for URL documents.
  - The editor saves and shows "No changes" when unchanged.
  - The freshness report shows empty, loading and error states and keeps the days filter in the URL.
- [ ] **Step 2:** Implement and run `pnpm --filter @app/admin exec vitest run src/features/knowledge`. Expected: PASS.
- [ ] **Step 3:** Document intervals, what "unreachable" and "removed" mean for retrieval, the report definition, and why crawled pages can't be edited.
- [ ] **Step 4: Commit** — `git commit -s -m "feat(admin): manage knowledge freshness, versions and edits"`
