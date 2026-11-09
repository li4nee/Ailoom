# Milestone 3 — Knowledge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admins add text, files, URLs, and sitemaps; the worker extracts, normalizes, chunks, and embeds them with live status in the admin; retrieval returns correctly filtered, scored chunks that admins can test.

**Architecture:** spec §12, §13.1, §13.3, §17.6, §18.3; architecture §3.3 (ingestion diagram), §4.9. Realtime fan-out (moved here from Milestone 6) lands first so knowledge status is live from day one.

**Tech Stack:** pg (dedicated LISTEN client), linkedom, @mozilla/readability, turndown + turndown-plugin-gfm, unpdf, mammoth, file-type, gpt-tokenizer, robots-parser, fast-xml-parser, tldts, picomatch, @fastify/multipart.

**Spec:** `docs/spec.md`, `docs/architecture.md`. Index: `2026-11-09-00-index.md`.

## Global Constraints

All index constraints apply. Milestone-specific:

- Limits (env-configurable, spec §12.1): text 200 KB; file 20 MB (`MAX_UPLOAD_MB`) and 500 pages; URL response 5 MB; sitemap ≤ `CRAWL_MAX_PAGES` (500) pages per source, same registrable domain only.
- Chunking: target 400 tokens, max 700, overlap 60 within a section only; embed text = `title + "\n" + headingPath + "\n\n" + content`.
- Embedding batch: 64 (16 for `local`), `maxRetries: 0` in the SDK; pg-boss retries `embed.chunks` 5× with backoff; `auth_failed` fails the source immediately.
- Job handlers re-check that their source/bot/workspace still exists (and is not being deleted) before doing work, and exit quietly if not.
- Crawling uses `crawlPolicy`; it never inherits provider URL exceptions.

## Review Focus (this milestone)

1. **Soft-404 and login-wall pages** in a sitemap. Expected: `low_text_content` pages are recorded with the warning, produce no chunks, count as done, and the source ends `ready` with a warning count. → Task 3.7 test `keeps low-text pages out of the index`.
2. **The same URL listed twice** (with/without trailing slash, with `#fragment`, `?utm_*` params). Expected: one document. → Task 3.8 test.
3. **Embedding model changed twice before the first re-embed finishes.** Expected: first job cancelled, its rows removed, only the latest model applied. → Task 3.10 test.
4. **Upload whose extension lies** (`invoice.pdf` that is really an `.exe` or HTML). Expected: `415 unsupported_file_type` based on magic bytes; HTML disguised as PDF is rejected, not parsed. → Task 3.6 test.
5. **LISTEN connection dropped** (Postgres restart). Expected: the hub reconnects with backoff, admin SSE clients stay connected, and clients refetch on the `resync` event emitted after reconnect. → Task 3.0 test.

---

### Task 3.0: Realtime fan-out and workspace event stream

**Files:**
- Create: `packages/shared/src/events.ts`
- Create: `apps/api/src/modules/realtime/{notify.ts,realtime-hub.ts,sse.ts,workspace-events.controller.ts,realtime.module.ts,index.ts}`
- Create: `apps/admin/src/lib/events.ts`
- Test: `apps/api/src/modules/realtime/realtime-hub.int.spec.ts`, `apps/api/test/e2e/workspace-events.e2e.spec.ts`, `apps/admin/src/lib/events.spec.ts`

**Interfaces:**
- Produces:
  - shared `RealtimeEvent` union: `{ type: 'source.updated'; sourceId; botId; status }` · `{ type: 'conversation.created' | 'conversation.updated'; conversationId; botId; status }` · `{ type: 'message.created'; conversationId; messageId; role }` · `{ type: 'resync' }`
  - `notifyWorkspace(manager: EntityManager, ws: WorkspaceId, event: RealtimeEvent): Promise<void>` — `SELECT pg_notify($1, $2)` on channel `ws_<uuid without dashes>`; throws if the payload exceeds 7,900 bytes
  - `RealtimeHub.subscribe(ws: WorkspaceId, filter: (e: RealtimeEvent) => boolean, onEvent: (e: RealtimeEvent) => void): () => void` (unsubscribe); one dedicated `pg.Client` on `DATABASE_LISTEN_URL`; `LISTEN` per workspace with ≥ 1 subscriber, `UNLISTEN` at 0; reconnect with backoff 0.5 s → 30 s, re-`LISTEN` all channels, then emit `{ type: 'resync' }` to every subscriber
  - `openSse(reply: FastifyReply, opts: { heartbeatMs?: number }): SseStream` with `send(event: string, data: unknown, id?: string)`, `close()`, `onClose(cb)`; headers `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`; heartbeat comment `: ping` every 20 s
  - Route `GET /api/v1/workspaces/:workspaceId/events` (agent)
  - Admin `connectWorkspaceEvents(ws, onEvent): () => void` (EventSource, exponential reconnect) and `INVALIDATION_MAP: Record<RealtimeEvent['type'], (e) => QueryKey[]>`

- [ ] **Step 1: Write failing tests**

```ts
it('delivers notifications committed in a transaction', async () => {
  const got: RealtimeEvent[] = []; hub.subscribe(ws, () => true, e => got.push(e));
  await ds.transaction(m => notifyWorkspace(m, ws, { type: 'source.updated', sourceId, botId, status: 'ready' }));
  await vi.waitFor(() => expect(got).toEqual([expect.objectContaining({ type: 'source.updated' })]));
});
it('drops notifications from rolled-back transactions', async () => { … 500 ms → [] });
it('isolates workspaces', async () => { /* subscriber on wsB gets nothing for wsA */ });
it('reconnects and emits resync after the connection is killed', async () => {
  await ds.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE query ILIKE 'LISTEN%'`);
  await vi.waitFor(() => expect(got).toContainEqual({ type: 'resync' }), { timeout: 10_000 });
  // and later notifications still arrive
});
it('rejects oversized payloads', async () => { … });
// e2e
it('streams events to members and 404s non-members', async () => { … event: source.updated; non-member 404 });
it('sends heartbeats', async () => { /* heartbeatMs 50 via test config → ': ping' seen */ });
// admin events.spec.ts
it('maps events to query invalidations', () => expect(INVALIDATION_MAP['source.updated']({ type: 'source.updated', sourceId: 's', botId: 'b', status: 'ready' } as never))
  .toEqual([['sources', 'b'], ['source', 's']]));
it('invalidates everything on resync', () => { … });
```

- [ ] **Step 2–4: Fail → implement → pass.** Boot fails with `LISTEN connection could not be established (is DATABASE_URL a PgBouncer transaction pool? set DATABASE_LISTEN_URL)` when the first connect fails in production.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(realtime): listen/notify hub and workspace sse stream"`

---

### Task 3.1: File storage and file-type detection

**Files:**
- Create: `apps/api/src/common/storage/{file-storage.ts,local-disk.storage.ts,memory.storage.ts,detect-file-type.ts,storage.module.ts,index.ts}`
- Modify: `apps/api/src/modules/workspaces/workspace-purge.processor.ts` (delete blobs)
- Test: `apps/api/src/common/storage/{local-disk.storage.spec.ts,detect-file-type.spec.ts}`, fixtures `apps/api/test/fixtures/files/`

**Interfaces:**
- Produces:
  - `interface FileStorage { put(key: string, data: Buffer | Readable): Promise<{ sizeBytes: number; sha256: string }>; get(key: string): Promise<Readable>; delete(key: string): Promise<void>; exists(key: string): Promise<boolean> }`, token `FILE_STORAGE`
  - `newStorageKey(ws: WorkspaceId): string` → `<workspaceId>/<uuidv7>` (no user-supplied parts)
  - `detectFileType(head: Buffer, filename: string): 'pdf' | 'docx' | 'html' | 'markdown' | 'text' | null` (pdf/docx by magic bytes via `file-type`; docx requires a zip containing `word/document.xml`; html/markdown/text only when the bytes are valid UTF-8 and contain no NUL; markdown vs text by extension `.md`/`.markdown`; html by extension `.html`/`.htm` **and** a leading `<` after whitespace)

- [ ] **Step 1: Write failing tests**

```ts
it('rejects path traversal keys', () => expect(storage.put('../etc/passwd', Buffer.from('x'))).rejects.toThrow());
it('round-trips and reports sha256', async () => { … });
it.each([['sample.pdf', 'pdf'], ['sample.docx', 'docx'], ['page.html', 'html'], ['notes.md', 'markdown'], ['notes.txt', 'text'],
  ['fake.pdf' /* html bytes */, null], ['program.exe.pdf', null], ['binary.txt' /* contains NUL */, null], ['plain.zip.docx' /* zip without word/ */, null]])(
  '%s → %s', async (f, t) => expect(detectFileType(await head(f), f)).toBe(t));
it('purge deletes blobs of the workspace', async () => { … });
```

- [ ] **Step 2–4: Fail → implement → pass.** Fixtures: commit tiny real files (`sample.pdf` exported from LibreOffice, `scanned.pdf` = one embedded image, `sample.docx`, `encrypted.pdf`) with a `README.md` saying how each was produced.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(storage): local file storage and magic-byte file type detection"`

---

### Task 3.2: Normalization and content hashing

**Files:**
- Create: `apps/api/src/modules/knowledge/domain/{normalize.ts,content-hash.ts}`
- Test: `apps/api/src/modules/knowledge/domain/normalize.spec.ts`

**Interfaces:**
- Produces: `normalizeMarkdown(md: string): string`; `contentHash(normalized: string): string` (SHA-256 hex).

- [ ] **Step 1: Write failing tests**

```ts
it('strips zero-width characters and normalizes to NFC', () => expect(normalizeMarkdown('Re​fund café')).toBe('Refund café'));
it('normalizes newlines and collapses blank lines', () => expect(normalizeMarkdown('a\r\n\r\n\r\n\r\nb')).toBe('a\n\nb'));
it('trims trailing spaces but keeps code blocks intact', () => expect(normalizeMarkdown('x  \n```\n  keep  \n```')).toBe('x\n```\n  keep  \n```'));
it('removes repeated short boilerplate lines, keeping the first', () =>
  expect(normalizeMarkdown('Skip to content\nA\nSkip to content\nB\nSkip to content')).toBe('Skip to content\nA\nB'));
it('keeps repeated list items, headings and table rows', () => expect(normalizeMarkdown('- yes\n- yes\n- yes')).toBe('- yes\n- yes\n- yes'));
it('hash is stable across whitespace-only differences', () => expect(contentHash(normalizeMarkdown('a \n\n\nb'))).toBe(contentHash(normalizeMarkdown('a\n\nb'))));
```

- [ ] **Step 2–4: Fail → implement → pass.** Boilerplate rule: a non-empty line ≤ 120 chars, outside code fences, not a heading/list item/table row/blockquote, occurring ≥ 3 times → keep the first occurrence only.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(knowledge): text normalization and content hashing"`

---

### Task 3.3: HTML and text extraction

**Files:**
- Create: `apps/api/src/modules/knowledge/extract/{types.ts,html.ts,text.ts,quality.ts,index.ts}`
- Test: `apps/api/src/modules/knowledge/extract/html.spec.ts`, fixtures `apps/api/test/fixtures/html/{article.html,spa-shell.html,nav-heavy.html,table.html,login-wall.html,relative-links.html}`

**Interfaces:**
- Produces:
  - `type ExtractResult = { title: string | null; markdown: string; warnings: ExtractionWarning[] }`
  - `class ExtractError extends Error { code: 'pdf_no_text_layer' | 'pdf_encrypted' | 'unsupported_content' | 'empty_content' }`
  - `extractHtml(html: string, pageUrl: string, opts?: { maxMarkdownBytes?: number /* 1 MiB */ }): ExtractResult`
  - `extractPlain(text: string, kind: 'markdown' | 'text', title: string | null): ExtractResult`
  - `qualityWarnings(input: { htmlBytes: number; markdown: string; hasEmptyAppRoot: boolean }): ExtractionWarning[]` (`js_rendered_suspected` when text < 200 chars and HTML > 20 KB, or an empty app root `#root`/`#app`/`#__next`/`[ng-app]`; `low_text_content` when < 50 words)

- [ ] **Step 1: Write failing tests**

```ts
it('extracts the article body without nav and footer', () => { const r = extractHtml(fixture('article.html'), 'https://ex.com/a');
  expect(r.title).toBe('Refund policy'); expect(r.markdown).toContain('## Eligibility'); expect(r.markdown).not.toMatch(/Home \| Products|© 2026/); });
it('keeps tables as GFM', () => expect(extractHtml(fixture('table.html'), u).markdown).toMatch(/\| Plan \| Price \|/));
it('absolutizes links and drops images and scripts', () => { const md = extractHtml(fixture('relative-links.html'), 'https://ex.com/docs/a').markdown;
  expect(md).toContain('(https://ex.com/docs/b)'); expect(md).not.toMatch(/!\[|<script|javascript:/); });
it('flags SPA shells', () => expect(extractHtml(fixture('spa-shell.html'), u).warnings).toContain('js_rendered_suspected'));
it('flags login walls as low text', () => expect(extractHtml(fixture('login-wall.html'), u).warnings).toContain('low_text_content'));
it('truncates very large pages with a warning', () => { … 'truncated' });
it('never leaves raw HTML in the markdown', () => expect(extractHtml('<p>a<iframe src=x></iframe><b onclick=x>b</b></p>', u).markdown).toBe('a**b**'));
```

- [ ] **Step 2–4: Fail → implement → pass.** Pipeline: `linkedom` parse → remove `script, style, noscript, iframe, svg, canvas, form, nav, footer, header, aside, [aria-hidden=true], [role=navigation], [role=banner], [role=contentinfo]` and elements whose id/class matches `/cookie|consent|banner|newsletter|subscribe/i` → Readability on a clone (fallback: `body`) → Turndown (`headingStyle: 'atx'`, `codeBlockStyle: 'fenced'`, gfm tables, rules dropping `img`, keeping link text with absolute `href` only for `http(s)`/`mailto`).
- [ ] **Step 5: Commit** — `git commit -s -m "feat(knowledge): html and plain text extraction with quality warnings"`

---

### Task 3.4: PDF and DOCX extraction

**Files:**
- Create: `apps/api/src/modules/knowledge/extract/{pdf.ts,docx.ts}`
- Test: `apps/api/src/modules/knowledge/extract/{pdf.spec.ts,docx.spec.ts}`

**Interfaces:**
- Produces:
  - `PAGE_BREAK = '\f'` — a line containing only a form feed separates PDF pages in the markdown; the chunker consumes it (Task 3.5)
  - `extractPdf(data: Uint8Array, opts?: { maxPages?: number /* 500 */ }): Promise<ExtractResult>` — title from PDF metadata or first line; `truncated` when pages > maxPages; throws `ExtractError('pdf_no_text_layer')` when average extracted chars per page < 20; `ExtractError('pdf_encrypted')` for password-protected files
  - `extractDocx(data: Buffer): Promise<ExtractResult>` — mammoth → HTML → the Turndown setup from 3.3 (no Readability)

- [ ] **Step 1: Write failing tests** — `sample.pdf` (2 pages) → markdown contains both pages' text separated by `\n\f\n`; `scanned.pdf` → rejects `pdf_no_text_layer`; `encrypted.pdf` → rejects `pdf_encrypted`; a generated 3-page PDF with `maxPages: 2` → `truncated` and only 2 pages; `sample.docx` → headings become `#`/`##`, a table becomes GFM, title from the first heading.
- [ ] **Step 2–4: Fail → implement → pass** (unpdf `extractText(pdf, { mergePages: false })`).
- [ ] **Step 5: Commit** — `git commit -s -m "feat(knowledge): pdf and docx extraction"`

---

### Task 3.5: Structure-aware chunker

**Files:**
- Create: `apps/api/src/modules/knowledge/domain/{chunker.ts,tokens.ts}`
- Test: `apps/api/src/modules/knowledge/domain/chunker.spec.ts`

**Interfaces:**
- Produces:
  - `countTokens(text: string): number` (gpt-tokenizer `encode().length`)
  - `type ChunkDraft = { ordinal: number; headingPath: string; content: string; tokenCount: number; embedText: string; metadata: { pages?: number[] } }`
  - `chunkMarkdown(doc: { title: string; markdown: string }, opts?: { targetTokens: number; maxTokens: number; overlapTokens: number }): ChunkDraft[]` (defaults 400 / 700 / 60)

Algorithm (not determined by the signature):
```
1. Split into sections at ATX headings; headingPath = stack of heading texts joined " > " (a level-n heading pops levels ≥ n).
2. Inside a section, split into blocks: fenced code, tables, lists, paragraphs (blank-line separated). Track the current page by counting PAGE_BREAK lines and remove them from content.
3. Greedily pack blocks until adding the next would exceed targetTokens; a block alone > maxTokens is split by sentences (Intl.Segmenter granularity 'sentence'), then hard-split by tokens if one sentence still exceeds maxTokens.
4. Overlap: each chunk after the first in the same section starts with the last whole sentences of the previous chunk totaling ≤ overlapTokens. Never across sections.
5. embedText = `${title}\n${headingPath}\n\n${content}`; ordinals are 0..n-1 in document order.
```

- [ ] **Step 1: Write failing tests**

```ts
it('builds heading paths', () => expect(chunkMarkdown({ title: 'T', markdown: '# Billing\n## Refunds\nText.' })[0]?.headingPath).toBe('Billing > Refunds'));
it('never exceeds maxTokens', () => { const cs = chunkMarkdown({ title: 'T', markdown: longDoc }); for (const c of cs) expect(c.tokenCount).toBeLessThanOrEqual(700); });
it('targets ~400 tokens', () => { const cs = chunkMarkdown({ title: 'T', markdown: longDoc }); expect(median(cs.map(c => c.tokenCount))).toBeGreaterThan(250); });
it('overlaps within a section only', () => { … second chunk of section A starts with tail of first; first chunk of section B does not contain section A text });
it('keeps a small code block and table whole', () => { … });
it('records PDF pages and strips page breaks', () => { const cs = chunkMarkdown({ title: 'T', markdown: 'p1 text\n\f\np2 text' });
  expect(cs[0]?.metadata.pages).toEqual([1, 2]); expect(cs[0]?.content).not.toContain('\f'); });
it('prepends title and heading path only to embedText', () => { … content excludes title });
it('returns [] for empty input', () => expect(chunkMarkdown({ title: 'T', markdown: '   ' })).toEqual([]));
it('is deterministic', () => expect(chunkMarkdown(doc)).toEqual(chunkMarkdown(doc)));
```

- [ ] **Step 2–4: Fail → implement → pass.**
- [ ] **Step 5: Commit** — `git commit -s -m "feat(knowledge): structure-aware markdown chunker"`

---

### Task 3.6: Knowledge sources API

**Files:**
- Create: `packages/shared/src/knowledge.ts`
- Create: `apps/api/src/modules/knowledge/{sources.controller.ts,sources.service.ts,sources.repository.ts,documents.repository.ts,knowledge.mapper.ts,knowledge.jobs.ts,knowledge.module.ts,index.ts}`, migration `<ts>-knowledge-progress.ts`
- Modify: `apps/api/test/isolation/isolation-fixtures.ts` (`sourceId`), `docs/spec.md` §9.3 (`pages_total`, `pages_done`, `pages_failed`, `warning_count` on `knowledge_sources`; status value `deleting`; unique index `chunks (document_version_id, embedding_model, ordinal)`)
- Test: `apps/api/test/e2e/sources.e2e.spec.ts`

**Interfaces:**
- Produces:
  - shared: `createSourceSchema` discriminated by `type`: `text { title ≤ 200, body ≤ 200 KB }`, `url { url, title? }`, `sitemap { url, includePatterns?: string[], excludePatterns?: string[], maxPages?: number ≤ CRAWL_MAX_PAGES }`; `sourceDtoSchema` incl. progress counters and warning count
  - Job definitions in `knowledge.jobs.ts` (used by 3.7–3.10): `IngestSource { workspaceId; sourceId }` (retry 2, concurrency 4), `IngestPage { workspaceId; sourceId; documentId: string | null; url: string | null }` (retry 3, backoff, concurrency 8), `EmbedChunks { workspaceId; botId; documentVersionId; embeddingModel }` (retry 5, backoff, concurrency 4), `DeleteSource { workspaceId; sourceId }` (retry 3), `ReembedBot { workspaceId; botId; targetModel; targetCredentialId; generation: number }` (retry 3, concurrency 1)
  - Routes (spec §17.6, param names `:botId`, `:sourceId`, `:documentId`): list, create (JSON), `POST …/sources/upload` (multipart `file`, optional `title`; 413 above `MAX_UPLOAD_MB`; 415 `unsupported_file_type`), get, `POST …/:sourceId/resync` (singleton per source), `DELETE …/:sourceId` (202; status `deleting`; enqueues `DeleteSource`)
  - Every create/resync/delete inserts or updates the source, enqueues the job with the same `manager`, and calls `notifyWorkspace(source.updated)` — all in one transaction.
  - Audit: `knowledge.source_added`, `knowledge.source_deleted`, `knowledge.source_resynced`

- [ ] **Step 1: Write failing tests**

```ts
it('creates a text source and enqueues ingestion atomically', async () => { … status 'pending'; job ingest.source exists });
it('rejects text over 200 KB', async () => { … 400 });
it('rejects private and non-http URLs early', async () => { url 'http://10.0.0.1/x' → 400 blocked_url; 'ftp://x' → 400 validation_failed });
it('accepts a PDF upload and stores the blob outside served paths', async () => { … files row, storage key `<ws>/<uuid>` });
it('rejects a disguised file by magic bytes', async () => { /* html bytes named invoice.pdf */ → 415 unsupported_file_type });
it('rejects oversized uploads', async () => { MAX_UPLOAD_MB=1 in test config, 2 MB → 413 payload_too_large });
it('resync twice quickly runs one job', async () => { … one ingest.source job });
it('delete returns 202 and marks deleting', async () => { … });
it('agents cannot add knowledge', async () => { 403 });
```

- [ ] **Step 2–4: Fail → implement → pass.** If the DB transaction fails after a blob was written, the blob is deleted in a `finally`.
- [ ] **Step 5: Isolation** — fixtures `sourceId`, `documentId`; suite PASS.
- [ ] **Step 6: Commit** — `git commit -s -m "feat(knowledge): sources api with uploads, validation and atomic job enqueue"`

---

### Task 3.7: Ingestion jobs — sources, pages, versions, chunks, embeddings

**Files:**
- Create: `apps/api/src/modules/knowledge/ingest/{ingest-source.processor.ts,ingest-page.processor.ts,embed-chunks.processor.ts,versioning.service.ts,progress.service.ts,fetch-page.ts}`, `apps/api/src/modules/usage/usage.repository.ts`
- Test: `apps/api/src/modules/knowledge/ingest/ingest.int.spec.ts`

**Interfaces:**
- Consumes: extractors (3.3, 3.4), `normalizeMarkdown`, `contentHash` (3.2), `chunkMarkdown` (3.5), `Llm.embed` (0.13), `safeFetch` + `crawlPolicy` (0.12), `FileStorage` (3.1), `notifyWorkspace` (3.0), `PricingService.cost` (2.5).
- Produces:
  - `fetchPage(url: string, deps): Promise<{ finalUrl: string; contentType: string; body: Buffer }>`; Nest tokens `CRAWL_FETCH_POLICY` and `FETCH_DEPS` (tests inject a lookup that maps `site.test` to the local server and allow it)
  - `VersioningService.recordContent(ws, documentId, extract: ExtractResult): Promise<{ changed: false } | { changed: true; versionId: string }>` (hash compare against the current version)
  - `VersioningService.swapCurrentVersion(ws, documentId, versionId, embeddingModel, manager)` — sets `current_version_id`, deletes chunks of older versions of that document, notifies; one transaction
  - `ProgressService.pageDone(ws, sourceId, outcome: 'done' | 'failed', warnings: number)` — atomic counter update; when `pages_done + pages_failed = pages_total` sets `ready` (or `failed` with `error` = most common failure message when `pages_done = 0`) and notifies
  - `UsageRepository.increment(manager, k: { workspaceId; botId; day: string /* YYYY-MM-DD UTC */ }, d: Partial<{ conversations; visitorMessages; aiMessages; escalations; inputTokens; outputTokens; embeddingTokens; costUsd: string }>): Promise<void>` (`INSERT … ON CONFLICT DO UPDATE` adding deltas)

- [ ] **Step 1: Write failing tests** (local HTTP server serving fixtures as `site.test`; mock embedding model)

```ts
it('ingests a text source end to end', async () => {
  const s = await addText('Refunds', '# Refunds\nYou can return items within 30 days.');
  await drainJobs();
  expect(await source(s.id)).toMatchObject({ status: 'ready', pagesTotal: 1, pagesDone: 1 });
  expect(await chunkCount(s.botId)).toBeGreaterThan(0);
  expect(events).toContainEqual(expect.objectContaining({ type: 'source.updated', status: 'ready' }));
});
it('ingests a URL with the crawl user agent', async () => { … server saw UA = config.crawl.userAgent });
it('skips re-embedding unchanged content on resync', async () => { … embed model called once across two syncs });
it('creates a new version and swaps chunks when content changes', async () => { … old chunks gone, version count 2, current points at v2 });
it('keeps low-text pages out of the index', async () => { … page has warning low_text_content, 0 chunks, source ready, warningCount 1 });
it('fails a source with a clear error when the embedding key is rejected', async () => { /* mock failWith auth_failed → status failed, error 'The embedding provider rejected the API key.' after 1 attempt */ });
it('records embedding tokens and cost in usage_daily', async () => { … });
it('is idempotent when embed.chunks runs twice', async () => { … unique index prevents duplicates; count unchanged });
it('stops quietly if the source was deleted mid-flight', async () => { … no error logged, no chunks });
it('pdf without text layer marks the document failed with the user-facing message', async () => { … });
```

- [ ] **Step 2–4: Fail → implement → pass.** User-facing error messages live in `knowledge/errors.ts` (`errorMessageFor(code): string`), e.g. `pdf_no_text_layer` → `"This PDF has no text layer (it's probably scanned). OCR is not supported yet."`.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(knowledge): ingestion, versioning, chunking and embedding jobs"`

---

### Task 3.8: Sitemap discovery and crawl rules

**Files:**
- Create: `apps/api/src/modules/knowledge/crawl/{discover.ts,sitemap-parser.ts,robots.ts,url-normalize.ts,domain-slots.ts}`
- Modify: `ingest-source.processor.ts` (sitemap branch), `ingest-page.processor.ts` (slots + robots)
- Test: `apps/api/src/modules/knowledge/crawl/*.spec.ts`, `apps/api/src/modules/knowledge/crawl/crawl.int.spec.ts`

**Interfaces:**
- Produces:
  - `normalizeCrawlUrl(u: string): string` — drops fragment, `utm_*`/`gclid`/`fbclid` params, sorts remaining params, lowercases host, removes default port and trailing slash (except root)
  - `parseSitemap(xml: string): { urls: string[]; sitemaps: string[] }` (urlset + sitemapindex)
  - `discoverUrls(start: string, opts: { maxPages: number; include: string[]; exclude: string[]; respectRobots: boolean; userAgent: string }, fetcher): Promise<{ urls: string[]; skipped: { url: string; reason: 'other_domain' | 'excluded' | 'robots' | 'limit' }[] }>` — start `.xml`/`.xml.gz` → sitemap; else `<origin>/sitemap.xml`, then `Sitemap:` lines in robots.txt; nested sitemaps to depth 3; same registrable domain via `tldts.getDomain`; globs on the pathname via picomatch
  - `RobotsCache.allowed(url: string, userAgent: string): Promise<boolean>` and `crawlDelayMs(origin)` (cap 10 s), cached per origin for the job run
  - `DomainSlots.withSlot<T>(domain: string, fn: () => Promise<T>): Promise<T | 'busy'>` — two slots per domain via `pg_try_advisory_lock(hashtext('crawl:' || domain), slot)` held on a dedicated query runner; `'busy'` → the page job re-enqueues itself with `startAfter: 5 s` and completes without counting a retry

- [ ] **Step 1: Write failing tests**

```ts
it.each([['https://Ex.com:443/a/?utm_source=x&b=2&a=1#top', 'https://ex.com/a?a=1&b=2'], ['https://ex.com/', 'https://ex.com/']])('normalize %s', (i, o) => expect(normalizeCrawlUrl(i)).toBe(o));
it('parses urlset and sitemapindex', () => { … });
it('keeps the same registrable domain only', async () => { docs.ex.com + ex.com kept, other.com skipped other_domain });
it('applies include/exclude globs', async () => { include ['/docs/**'], exclude ['/docs/internal/**'] });
it('respects robots.txt unless disabled', async () => { Disallow: /private → skipped robots; respectRobots false → included });
it('dedupes equivalent URLs', async () => { … });
it('stops at maxPages and reports the rest as limit', async () => { … });
it('falls back from /sitemap.xml to robots Sitemap lines', async () => { … });
it('never runs more than 2 pages per domain at once', async () => { /* 6 page jobs, server counts concurrent requests → max 2 */ });
```

- [ ] **Step 2–4: Fail → implement → pass.**
- [ ] **Step 5: Commit** — `git commit -s -m "feat(knowledge): sitemap discovery, robots.txt and per-domain crawl limits"`

---

### Task 3.9: Source deletion and bot knowledge purge

**Files:**
- Create: `apps/api/src/modules/knowledge/{delete-source.processor.ts,purge-bot-knowledge.processor.ts}`
- Modify: `apps/api/src/modules/bots/bots.service.ts` (enqueue `PurgeBotKnowledge { workspaceId; botId }` on soft delete)
- Test: `apps/api/src/modules/knowledge/deletion.int.spec.ts`

**Interfaces:**
- Produces: `DeleteSource` processor removes chunks → versions → documents → file rows + blobs → source (batches of 1,000), then notifies `source.updated` with status `deleted` (add `deleted` to the shared event status union only, not the DB enum); `PurgeBotKnowledge` does the same for every source of a deleted bot. Traces keep `chunk_id` values (no FK), per spec §12.8.

- [ ] **Step 1: Write failing tests** — after deleting a source: 0 chunks/versions/documents for it, blob gone, other sources untouched, an existing trace's `retrieval` JSON still lists the old `chunk_id`; deleting during an in-flight `ingest.page` leaves no orphan rows; bot soft delete purges all its knowledge.
- [ ] **Step 2–4: Fail → implement → pass.**
- [ ] **Step 5: Commit** — `git commit -s -m "feat(knowledge): background deletion of sources and deleted-bot knowledge"`

---

### Task 3.10: Re-embedding on embedding-model change

**Files:**
- Create: `apps/api/src/modules/knowledge/reembed/{reembed.service.ts,reembed-bot.processor.ts}`, migration `<ts>-bots-reembed-generation.ts` (adds `bots.reembed_generation int not null default 0`)
- Modify: `apps/api/src/modules/bots/bots.service.ts` (replace `409 reembed_not_available`), `docs/spec.md` §12.7 (generation counter)
- Test: `apps/api/src/modules/knowledge/reembed/reembed.int.spec.ts`

**Interfaces:**
- Produces: `ReembedService.start(ws, botId, target: { credentialId; model }, actor): Promise<void>` — sets `pending_embedding_model`, increments `reembed_generation`, enqueues `ReembedBot` with that generation (singleton per bot); the processor re-embeds current-version chunks into new rows tagged with the target model in batches, **checking before each batch that `bots.reembed_generation` still equals its own generation** (else deletes its partial rows and exits), then in one transaction sets `embedding_model`, `embedding_credential_id`, `embedding_dim`, clears `pending_embedding_model`, deletes rows of other models, and notifies. Ingestion while `pending_embedding_model` is set writes rows for both models (update `EmbedChunks` producers).

- [ ] **Step 1: Write failing tests**

```ts
it('keeps retrieval on the old model until the swap', async () => { … during re-embed, search(model=old) returns results; after, model=new });
it('never mixes models with the same dimension', async () => { two 384-dim mock models; after swap only new-model rows remain });
it('cancels an older re-embed when the model changes again', async () => {
  await reembed.start(ws, bot, { credentialId: c, model: 'mock-a' }, actor);
  await runOneBatch(); await reembed.start(ws, bot, { credentialId: c, model: 'mock-b' }, actor); await drainJobs();
  expect(await modelsPresent(bot)).toEqual(['mock-b']); expect((await getBot(bot)).embeddingModel).toBe('mock-b');
});
it('leaves the bot on the old model and cleans up when re-embed fails', async () => { … error shown on bot (bots.last_error … add field to DTO) });
it('writes both models for content ingested during a re-embed', async () => { … });
```

- [ ] **Step 2–4: Fail → implement → pass.**
- [ ] **Step 5: Commit** — `git commit -s -m "feat(knowledge): safe re-embedding with generation-based cancellation"`

---

### Task 3.11: Document viewer endpoint

**Files:**
- Modify: `apps/api/src/modules/knowledge/sources.controller.ts`
- Test: `apps/api/test/e2e/documents.e2e.spec.ts`

**Interfaces:**
- Produces: `GET /api/v1/workspaces/:workspaceId/bots/:botId/sources/:sourceId` returns the source with its documents (`id, url, title, status, warnings, chunkCount, lastSyncedAt`, paginated `?cursor`); `GET …/bots/:botId/documents/:documentId` returns `{ document, currentVersion: { content, warnings, createdAt }, chunks: { ordinal, headingPath, content, tokenCount, metadata }[] }` (current version only; no embeddings).

- [ ] **Step 1: Write failing tests** — responses never include `embedding`; chunks ordered by ordinal; document from another bot of the same workspace → 404; agent → 403.
- [ ] **Step 2–4: Fail → implement → pass.**
- [ ] **Step 5: Commit** — `git commit -s -m "feat(knowledge): document and chunk viewer endpoints"`

---

### Task 3.12: Retrieval repository

**Files:**
- Create: `apps/api/src/modules/retrieval/{retrieval.repository.ts,retrieval.service.ts,retrieval.module.ts,index.ts}`
- Test: `apps/api/src/modules/retrieval/retrieval.int.spec.ts`

**Interfaces:**
- Produces:
  - `type RetrievedChunk = { chunkId: string; documentId: string; title: string; url: string | null; headingPath: string; content: string; metadata: { pages?: number[] }; score: number; rank: number }`
  - `RetrievalRepository.search(ws: WorkspaceId, q: { botId: BotId; embeddingModel: string; dim: number; vector: number[]; limit: number }): Promise<RetrievedChunk[]>` — the exact spec §13.1 SQL and `SET LOCAL` settings in one transaction; `halfvec(3072)` casts when `dim = 3072`; no cast-to-index path (exact scan) for dims without an index
  - `RetrievalRepository.countReadyChunks(ws, botId, embeddingModel): Promise<number>`
  - `RetrievalService.retrieve(ws, bot: BotEntity, query: string, signal): Promise<{ chunks: RetrievedChunk[]; topScore: number | null; embeddingTokens: number; queryVector: number[] }>` (embeds with `Llm.embed`, then searches with limit 8)

- [ ] **Step 1: Write failing tests**

```ts
it('does not starve small bots on a busy dimension', async () => {
  await seedBots({ bots: 30, chunksEach: 1000, dim: 384 }); const small = await seedBot({ chunks: 20, dim: 384 });
  expect(await repo.search(ws, { botId: small, embeddingModel: 'm', dim: 384, vector: q, limit: 8 })).toHaveLength(8);
});
it('would starve without iterative scan (guards the setting)', async () => { /* same query with iterative_scan off via a test-only flag → < 8 rows */ });
it('filters by embedding model', async () => { … rows of model B never returned for model A });
it('returns only current-version chunks', async () => { … });
it('never crosses workspaces', async () => { … });
it('scores are 1 - cosine distance, sorted descending', async () => { … });
it('works for 3072-dim bots via halfvec', async () => { … });
it('uses the matching HNSW index', async () => { /* EXPLAIN contains chunks_embedding_384_hnsw */ });
```

- [ ] **Step 2–4: Fail → implement → pass.**
- [ ] **Step 5: Commit** — `git commit -s -m "feat(retrieval): model-filtered iterative hnsw search"`

---

### Task 3.13: Test-retrieval endpoint

**Files:**
- Create: `apps/api/src/modules/retrieval/test-retrieval.controller.ts`, `packages/shared/src/retrieval.ts`
- Test: `apps/api/test/e2e/test-retrieval.e2e.spec.ts`

**Interfaces:**
- Produces: `POST /api/v1/workspaces/:workspaceId/bots/:botId/test-retrieval { query: string (1–2000) }` (admin) → `{ embeddingModel, threshold, results: { rank, score, used, chunkId, documentId, title, url, headingPath, preview /* first 300 chars */ }[] }` where `used` = rank ≤ 5 and score ≥ threshold (same rule the chat engine uses — export `selectUsedChunks(chunks, threshold, max = 5)` from `retrieval.service.ts` and unit-test it here). Embedding tokens are recorded in usage like any other embedding call.

- [ ] **Step 1: Write failing tests** — `selectUsedChunks` picks at most 5 chunks at or above the threshold in rank order; endpoint returns 8 results with correct `used` flags; a bot with no knowledge returns `results: []`; agent → 403; query of 2001 chars → 400.
- [ ] **Step 2–4: Fail → implement → pass.**
- [ ] **Step 5: Commit** — `git commit -s -m "feat(retrieval): test retrieval endpoint for threshold tuning"`

---

### Task 3.14: Admin — knowledge pages

**Files:**
- Create: `apps/admin/src/routes/_app/w/$workspaceId/bots/$botId/knowledge/{index.tsx,$sourceId.tsx,documents.$documentId.tsx}`, `apps/admin/src/features/knowledge/{api.ts,components/{sources-table.tsx,add-source-dialog.tsx,source-status.tsx,warning-list.tsx,document-viewer.tsx}}`
- Modify: `apps/admin/src/routes/_app/w/$workspaceId/route.tsx` (open `connectWorkspaceEvents` once per workspace)
- Test: `apps/admin/src/features/knowledge/*.spec.tsx`

**Interfaces:**
- Produces: hooks `useSources(ws, botId)`, `useSource`, `useAddSource`, `useUploadSource` (with upload progress), `useResync`, `useDeleteSource`, `useDocument`.

- [ ] **Step 1: Write failing component tests** — status badge text for each status and `pagesDone/pagesTotal` progress; a `source.updated` event updates the row without a reload (via `INVALIDATION_MAP`); each warning code renders its explanation and suggested fix from `strings.knowledge.warnings` (spec §12.3 wording); the add dialog validates URL scheme and text size client-side; upload rejects files over the limit before sending; delete asks for confirmation; the document viewer shows heading paths and token counts; agents see the list read-only.
- [ ] **Step 2–4: Fail → implement → pass.**
- [ ] **Step 5: Commit** — `git commit -s -m "feat(admin): knowledge sources with live status and document viewer"`

---

### Task 3.15: Admin — test-retrieval panel and isolation

**Files:**
- Create: `apps/admin/src/routes/_app/w/$workspaceId/bots/$botId/knowledge/test.tsx`, `apps/admin/src/features/knowledge/components/test-retrieval-panel.tsx`
- Modify: `apps/admin/src/features/bots/components/behavior-form.tsx` (link "Tune with test retrieval")
- Test: `apps/admin/src/features/knowledge/test-retrieval-panel.spec.tsx`; `apps/api/test/isolation` run

- [ ] **Step 1: Write failing component test** — results table shows rank, score (3 decimals), a "used" marker, and a horizontal line at the threshold position; changing the threshold slider recomputes `used` client-side with the same `selectUsedChunks` rule (import from `@app/shared` after moving the pure function there in this step) and offers "Save threshold".
- [ ] **Step 2–4: Fail → implement → pass.**
- [ ] **Step 5: Run the isolation suite** — `pnpm --filter @app/api test:e2e -- test/isolation` → PASS, 0 uncovered.
- [ ] **Step 6: Commit and tag**

```bash
git add -A
git commit -s -m "feat(admin): test retrieval panel with threshold tuning"
git tag m3-done
```
