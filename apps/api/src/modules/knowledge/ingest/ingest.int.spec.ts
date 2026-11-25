// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';

import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from 'vitest';

import type { RecrawlInterval, RealtimeEvent } from '@app/shared';

import { getTestDataSource, resetDatabase } from '../../../../test/helpers/db';
import { WorkerAppModule } from '../../../app/worker-app.module';
import { loadConfig, type AppConfig } from '../../../common/config';
import { crawlPolicy, type FetchPolicy } from '../../../common/safe-fetch';
import { MemoryStorage } from '../../../common/storage';
import { asSourceId, asWorkspaceId } from '../../../db/ids';
import { JobsService } from '../../../jobs';
import { Llm, ProviderError } from '../../../providers';
import { FreshnessRepository } from '../freshness/freshness.repository';
import { EMBED_CHUNKS_JOB, INGEST_SOURCE_JOB } from '../knowledge.jobs';
import { SourcesService } from '../sources.service';

const FIXTURES = join(__dirname, '..', '..', '..', '..', 'test', 'fixtures', 'files');
const HTML_FIXTURES = join(__dirname, '..', '..', '..', '..', 'test', 'fixtures', 'html');
const UA = 'AiLoomTestCrawler/1.0';

let ds: DataSource;
let worker: INestApplicationContext;
let server: Server;
let port: number;
let config: AppConfig;
let storage: MemoryStorage;
let jobs: JobsService;
let workspaceId: string;
let botId: string;
const events: RealtimeEvent[] = [];

const userAgents: string[] = [];
let articleStatus = 200;
let sitemapPaths: string[] = ['/login'];

function fixture(name: string): Buffer {
  return readFileSync(join(FIXTURES, name));
}

function htmlFixture(name: string): string {
  return readFileSync(join(HTML_FIXTURES, name), 'utf8');
}

async function countJobs(): Promise<number> {
  const rows = await ds.query<{ count: number }[]>(
    `SELECT count(*)::int AS count FROM pgboss.job
      WHERE state IN ('created', 'retry', 'active')`,
  );
  return rows[0]?.count ?? 0;
}

async function drainJobs(): Promise<void> {
  await vi.waitFor(
    async () => {
      expect(await countJobs()).toBe(0);
    },
    { timeout: 25_000, interval: 150 },
  );
}

async function seedBot(): Promise<void> {
  const slug = `ingest-${Math.random().toString(36).slice(2, 8)}`;
  const workspaces = await ds.query<{ id: string }[]>(
    `INSERT INTO workspaces (name, slug) VALUES ('Ingest', $1) RETURNING id`,
    [slug],
  );
  workspaceId = workspaces[0]?.id ?? '';
  const credentials = await ds.query<{ id: string }[]>(
    `INSERT INTO provider_credentials (workspace_id, provider, label)
     VALUES ($1, 'mock', 'chat'), ($1, 'mock', 'embed')
     RETURNING id`,
    [workspaceId],
  );
  const [chat, embed] = credentials.map((row) => row.id);
  const bots = await ds.query<{ id: string }[]>(
    `INSERT INTO bots (workspace_id, name, public_key, chat_credential_id, chat_model,
                       embedding_credential_id, embedding_model, embedding_dim)
     VALUES ($1, 'Help', $2, $3, 'mock-chat', $4, 'mock-embed', 384)
     RETURNING id`,
    [workspaceId, `pk_live_ingest_${slug}`, chat, embed],
  );
  botId = bots[0]?.id ?? '';
}

async function addSource(
  type: 'text' | 'url' | 'sitemap' | 'file',
  input: {
    title?: string;
    body?: string;
    url?: string;
    options?: Record<string, unknown>;
    recrawlInterval?: RecrawlInterval | null;
  },
): Promise<string> {
  const options = input.body === undefined ? (input.options ?? {}) : { body: input.body };
  const rows = await ds.query<{ id: string }[]>(
    `INSERT INTO knowledge_sources
       (workspace_id, bot_id, type, title, source_url, options, recrawl_interval)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7) RETURNING id`,
    [
      workspaceId,
      botId,
      type,
      input.title ?? 'Source',
      input.url ?? null,
      JSON.stringify(options),
      input.recrawlInterval ?? null,
    ],
  );
  const id = rows[0]?.id ?? '';
  await jobs.enqueue(INGEST_SOURCE_JOB, { workspaceId, sourceId: id });
  return id;
}

async function source(id: string): Promise<Record<string, unknown>> {
  const rows = await ds.query<Record<string, unknown>[]>(
    `SELECT status, error, pages_total AS "pagesTotal", pages_done AS "pagesDone",
            pages_failed AS "pagesFailed", warning_count AS "warningCount"
       FROM knowledge_sources WHERE id = $1`,
    [id],
  );
  return rows[0] ?? {};
}

async function chunkCount(): Promise<number> {
  const rows = await ds.query<{ count: number }[]>(
    `SELECT count(*)::int AS count FROM chunks WHERE workspace_id = $1 AND bot_id = $2`,
    [workspaceId, botId],
  );
  return rows[0]?.count ?? 0;
}

beforeAll(async () => {
  ds = await getTestDataSource();
  storage = new MemoryStorage();
  config = loadConfig({
    NODE_ENV: 'test',
    PUBLIC_URL: 'http://localhost:3000',
    DATABASE_URL: inject('databaseUrl'),
    AUTH_SECRET: 'a'.repeat(32),
    WIDGET_SECRET: 'w'.repeat(32),
    ENCRYPTION_KEYS: `v1:${'ab'.repeat(32)}`,
    LOG_LEVEL: 'error',
    CRAWL_USER_AGENT: UA,
  });

  server = createServer((request, response) => {
    const path = request.url ?? '/';
    userAgents.push(request.headers['user-agent'] ?? '');
    const send = (type: string, body: string): void => {
      response.writeHead(200, { 'Content-Type': type });
      response.end(body);
    };
    if (path === '/robots.txt') {
      send('text/plain', 'User-agent: *\nAllow: /\n');
      return;
    }
    if (path === '/sitemap.xml') {
      const urls = sitemapPaths
        .map((item) => `<url><loc>http://site.test:${String(port)}${item}</loc></url>`)
        .join('');
      send('application/xml', `<?xml version="1.0"?><urlset>${urls}</urlset>`);
      return;
    }
    if (path === '/login') {
      send('text/html', htmlFixture('login-wall.html'));
      return;
    }
    if (path === '/article') {
      response.writeHead(articleStatus, { 'Content-Type': 'text/html' });
      response.end(htmlFixture('article.html'));
      return;
    }
    response.writeHead(404, { 'Content-Type': 'text/html' });
    response.end('<p>not found</p>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  port = typeof address === 'object' && address !== null ? address.port : 0;

  const policy: FetchPolicy = {
    ...crawlPolicy(config),
    allowPrivate: true,
    allowHosts: ['site.test', '127.0.0.1'],
    allowedPorts: 'any',
  };
  const app = WorkerAppModule.register(config, {
    dataSource: ds,
    storage,
    jobs: { pollingIntervalSeconds: 0.5 },
    knowledge: {
      fetchPolicy: policy,
      fetchDeps: { lookup: () => Promise.resolve([{ address: '127.0.0.1', family: 4 }]) },
    },
  });
  worker = await NestFactory.createApplicationContext(app, { logger: false });
  jobs = worker.get(JobsService);
});

/** The listener connects in `beforeEach`, once the workspace (and its channel) exists. */
let listener: Client | undefined;

async function connectListener(channel: string): Promise<void> {
  await listener?.end().catch(() => undefined);
  listener = new Client({ connectionString: inject('databaseUrl') });
  await listener.connect();
  listener.on('notification', (message) => {
    if (message.payload !== undefined) events.push(JSON.parse(message.payload) as RealtimeEvent);
  });
  await listener.query(`LISTEN "${channel}"`);
}

afterAll(async () => {
  await listener?.end().catch(() => undefined);
  await worker.close();
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

beforeEach(async () => {
  await resetDatabase(ds);
  storage.blobs.clear();
  userAgents.length = 0;
  events.length = 0;
  articleStatus = 200;
  sitemapPaths = ['/login'];
  await seedBot();
  await connectListener(`ws_${workspaceId.replaceAll('-', '')}`);
});

describe('knowledge ingestion', () => {
  it('ingests a text source end to end', async () => {
    const id = await addSource('text', {
      title: 'Refunds',
      body: '# Refunds\nYou can return items within 30 days of delivery.',
    });

    await drainJobs();

    expect(await source(id)).toMatchObject({ status: 'ready', pagesTotal: 1, pagesDone: 1 });
    expect(await chunkCount()).toBeGreaterThan(0);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'source.updated', status: 'ready' }),
    );
  });

  it('ingests a URL with the crawl user agent', async () => {
    const id = await addSource('url', { url: `http://site.test:${String(port)}/article` });

    await drainJobs();

    expect(await source(id)).toMatchObject({ status: 'ready', pagesDone: 1 });
    expect(userAgents).toContain(UA);
  });

  it('skips re-embedding unchanged content on resync', async () => {
    const body = '# Refunds\nYou can return items within 30 days.';
    await addSource('text', { title: 'Refunds', body });
    await drainJobs();
    const before = await chunkCount();
    const versions = await ds.query<{ count: number }[]>(
      `SELECT count(*)::int AS count FROM document_versions WHERE workspace_id = $1`,
      [workspaceId],
    );

    const id = (
      await ds.query<{ id: string }[]>(
        `SELECT id FROM knowledge_sources WHERE workspace_id = $1 LIMIT 1`,
        [workspaceId],
      )
    )[0]?.id;
    if (id === undefined) throw new Error('the seeded source is missing');
    await ds.query(`DELETE FROM pgboss.job`);
    await jobs.enqueue(INGEST_SOURCE_JOB, { workspaceId, sourceId: id });
    await drainJobs();

    expect(await chunkCount()).toBe(before);
    expect(
      (
        await ds.query<{ count: number }[]>(
          `SELECT count(*)::int AS count FROM document_versions WHERE workspace_id = $1`,
          [workspaceId],
        )
      )[0]?.count,
    ).toBe(versions[0]?.count);
    expect(await source(id)).toMatchObject({ status: 'ready' });
  });

  it('records unchanged URL checks, keeps 404 pages searchable, and clears unreachable on recovery', async () => {
    const id = await addSource('url', { url: `http://site.test:${String(port)}/article` });
    await drainJobs();
    const before = await ds.query<
      { id: string; current_version_id: string; last_checked_at: Date; status: string }[]
    >(
      `SELECT id, current_version_id, last_checked_at, status FROM documents
        WHERE workspace_id = $1 AND source_id = $2`,
      [workspaceId, id],
    );
    expect(before[0]?.status).toBe('active');
    if (before[0] === undefined) throw new Error('the crawled document is missing');

    await ds.query(
      `UPDATE knowledge_sources SET recrawl_interval = '1 day',
          last_synced_at = now() - interval '2 days' WHERE id = $1`,
      [id],
    );
    articleStatus = 404;
    await worker.get(SourcesService).resyncDueSource(asWorkspaceId(workspaceId), asSourceId(id));
    await drainJobs();

    const unreachable = await ds.query<
      {
        current_version_id: string;
        last_checked_at: Date;
        status: string;
        unreachable_since: Date;
      }[]
    >(
      `SELECT current_version_id, last_checked_at, status, unreachable_since FROM documents
        WHERE workspace_id = $1 AND source_id = $2`,
      [workspaceId, id],
    );
    expect(unreachable[0]).toMatchObject({
      current_version_id: before[0].current_version_id,
      status: 'unreachable',
    });
    expect(unreachable[0]?.unreachable_since).toBeInstanceOf(Date);
    expect(unreachable[0]?.last_checked_at.getTime()).toBeGreaterThan(
      before[0].last_checked_at.getTime(),
    );
    expect(await chunkCount()).toBeGreaterThan(0);

    articleStatus = 200;
    await worker.get(SourcesService).resyncDueSource(asWorkspaceId(workspaceId), asSourceId(id));
    await drainJobs();
    const recovered = await ds.query<{ status: string; unreachable_since: Date | null }[]>(
      `SELECT status, unreachable_since FROM documents
        WHERE workspace_id = $1 AND source_id = $2`,
      [workspaceId, id],
    );
    expect(recovered[0]).toEqual({ status: 'active', unreachable_since: null });
    expect(
      await ds.query(`SELECT id FROM document_versions WHERE document_id = $1`, [before[0].id]),
    ).toHaveLength(1);
  });

  it('caps due recrawl claims at 25 and ignores sources that are not ready', async () => {
    await ds.query(
      `INSERT INTO knowledge_sources
         (workspace_id, bot_id, type, title, source_url, status, recrawl_interval, last_synced_at)
       SELECT $1, $2, 'url', 'Due ' || n::text, 'http://site.test/article', 'ready', '1 day',
              now() - interval '2 days'
         FROM generate_series(1, 27) AS n`,
      [workspaceId, botId],
    );
    await ds.query(
      `INSERT INTO knowledge_sources
         (workspace_id, bot_id, type, title, source_url, status, recrawl_interval, last_synced_at)
       VALUES ($1, $2, 'url', 'Pending', 'http://site.test/article', 'pending', '1 day',
               now() - interval '2 days')`,
      [workspaceId, botId],
    );

    const due = await worker.get(FreshnessRepository).claimDueSources(new Date(), 25);
    expect(due).toHaveLength(25);
  });

  it('marks sitemap pages that disappeared as removed while keeping their versions', async () => {
    sitemapPaths = ['/article', '/login'];
    const id = await addSource('sitemap', { url: `http://site.test:${String(port)}/sitemap.xml` });
    await drainJobs();
    const missing = await ds.query<{ id: string }[]>(
      `SELECT id FROM documents WHERE source_id = $1 AND url LIKE '%/login'`,
      [id],
    );
    if (missing[0] === undefined) throw new Error('the sitemap login document is missing');
    const versionsBefore = await ds.query<{ count: number }[]>(
      `SELECT count(*)::int AS count FROM document_versions WHERE document_id = $1`,
      [missing[0].id],
    );

    await ds.query(
      `UPDATE knowledge_sources SET recrawl_interval = '1 day',
          last_synced_at = now() - interval '2 days' WHERE id = $1`,
      [id],
    );
    sitemapPaths = ['/article'];
    await worker.get(SourcesService).resyncDueSource(asWorkspaceId(workspaceId), asSourceId(id));
    await drainJobs();

    const removed = await ds.query<{ status: string; current_version_id: string | null }[]>(
      `SELECT status, current_version_id FROM documents WHERE id = $1`,
      [missing[0].id],
    );
    expect(removed[0]).toEqual({ status: 'removed', current_version_id: null });
    const versionsAfter = await ds.query<{ count: number }[]>(
      `SELECT count(*)::int AS count FROM document_versions WHERE document_id = $1`,
      [missing[0].id],
    );
    expect(versionsAfter[0]?.count).toBe(versionsBefore[0]?.count);
  });

  it('creates a new version and swaps chunks when content changes', async () => {
    const id = await addSource('text', { title: 'Refunds', body: 'first version' });
    await drainJobs();
    const firstChunks = await chunkCount();

    await ds.query(`UPDATE knowledge_sources SET options = $2::jsonb WHERE id = $1`, [
      id,
      JSON.stringify({ body: 'second version with different words entirely' }),
    ]);
    await jobs.enqueue(INGEST_SOURCE_JOB, { workspaceId, sourceId: id });
    await drainJobs();

    const versions = await ds.query<{ count: number }[]>(
      `SELECT count(*)::int AS count FROM document_versions WHERE workspace_id = $1`,
      [workspaceId],
    );
    expect(versions[0]?.count).toBe(2);
    expect(await chunkCount()).toBe(firstChunks);
    const current = await ds.query<{ content: string }[]>(
      `SELECT v.content FROM documents d JOIN document_versions v ON v.id = d.current_version_id
        WHERE d.workspace_id = $1`,
      [workspaceId],
    );
    expect(current[0]?.content).toContain('second version');
  });

  it('keeps low-text pages out of the index but counts the warning', async () => {
    const id = await addSource('sitemap', { url: `http://site.test:${String(port)}/sitemap.xml` });

    await drainJobs();

    expect(await source(id)).toMatchObject({
      status: 'ready',
      pagesTotal: 1,
      pagesDone: 1,
      warningCount: 1,
    });
    expect(await chunkCount()).toBe(0);
  });

  it('fails a source with a clear error when the embedding key is rejected', async () => {
    vi.spyOn(worker.get(Llm), 'embed').mockRejectedValueOnce(new ProviderError('auth_failed'));
    const id = await addSource('text', { title: 'Refunds', body: '# Refunds\nSomething useful.' });

    await drainJobs();

    expect(await source(id)).toMatchObject({
      status: 'failed',
      error: 'The embedding provider rejected the API key. Update the credential and resync.',
    });
  });

  it('records embedding tokens and cost in usage_daily', async () => {
    await addSource('text', { title: 'Refunds', body: '# Refunds\nSomething useful to embed.' });
    await drainJobs();

    const rows = await ds.query<{ embedding_tokens: string; cost_usd: string }[]>(
      `SELECT embedding_tokens, cost_usd FROM usage_daily WHERE workspace_id = $1`,
      [workspaceId],
    );
    expect(Number(rows[0]?.embedding_tokens)).toBeGreaterThan(0);
    expect(rows[0]?.cost_usd).toBe('0.000000');
  });

  it('is idempotent when embed.chunks runs twice', async () => {
    await addSource('text', { title: 'Refunds', body: '# Refunds\nSomething useful to embed.' });
    await drainJobs();
    const before = await chunkCount();
    const payload = await ds.query<{ document_version_id: string }[]>(
      `SELECT document_version_id FROM chunks WHERE workspace_id = $1 LIMIT 1`,
      [workspaceId],
    );
    await jobs.enqueue(EMBED_CHUNKS_JOB, {
      workspaceId,
      botId,
      documentVersionId: payload[0]?.document_version_id ?? '',
      embeddingModel: 'mock-embed',
    });
    await drainJobs();

    expect(await chunkCount()).toBe(before);
  });

  it('stops quietly if the source was deleted mid-flight', async () => {
    const id = await addSource('text', { title: 'Refunds', body: 'content' });
    await ds.query(`UPDATE knowledge_sources SET status = 'deleting' WHERE id = $1`, [id]);
    await ds.query('DELETE FROM pgboss.job');
    await jobs.enqueue(INGEST_SOURCE_JOB, { workspaceId, sourceId: id });
    await drainJobs();

    expect(await chunkCount()).toBe(0);
    expect(await source(id)).toMatchObject({ status: 'deleting' });
  });

  it('marks a scanned PDF failed with the user-facing message', async () => {
    const key = `${workspaceId}/scanned`;
    await storage.put(key, fixture('scanned.pdf'));
    const id = await addSource('file', {
      title: 'Scan',
      options: { fileId: null, detectedType: 'pdf' },
    });
    await ds.query(`UPDATE knowledge_sources SET file_key = $2 WHERE id = $1`, [id, key]);
    await ds.query('DELETE FROM pgboss.job');
    await jobs.enqueue(INGEST_SOURCE_JOB, { workspaceId, sourceId: id });
    await drainJobs();

    expect(await source(id)).toMatchObject({
      status: 'failed',
      error: "This PDF has no text layer (it's probably scanned). OCR is not supported yet.",
    });
  });
});
