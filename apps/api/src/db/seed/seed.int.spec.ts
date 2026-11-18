// SPDX-License-Identifier: AGPL-3.0-only
import { beforeAll, afterAll, describe, expect, it } from 'vitest';

import { createTestApp, type TestApp } from '../../../test/helpers/app';
import { resetDatabase } from '../../../test/helpers/db';
import { authed, loginAs } from '../../../test/helpers/factories';
import { chunkMarkdown } from '../../modules/knowledge/domain/chunker';
import { DEFAULT_MODELS_DIR, localModelStatus } from '../../providers/local/catalog';
import { createLocalEmbeddingModel } from '../../providers/local/local-embedding-model';
import { loadSeedDocuments } from './fixtures';
import { DEMO_EMAIL, DEMO_EMBEDDING_MODEL, DEMO_PASSWORD, seedDemo } from './seed';

interface CountRow {
  count: number;
}

interface IdBody {
  id: string;
}

interface SourceBody {
  id: string;
  status: string;
}

interface UsageBody {
  days: unknown[];
  totals: { conversations: number };
}

interface PageBody {
  data: unknown[];
}

interface TraceBody {
  retrieval: unknown[];
}

interface ProductivityDetail {
  conversation: { id: string; priority: string };
  contactHistory: unknown[];
  crmLinks: { provider: string; url: string | null }[];
  handoffSummary: { state: string; content: { issue: string } } | null;
  suggestedReply: { state: string; content: { citations: unknown[] } } | null;
}

const model = createLocalEmbeddingModel({
  modelsDir: DEFAULT_MODELS_DIR,
  id: DEMO_EMBEDDING_MODEL,
});

async function embed(texts: string[], purpose: 'query' | 'document'): Promise<number[][]> {
  const vectors: number[][] = [];
  for (const text of texts) {
    const result = await model.doEmbed({
      values: [text],
      providerOptions: { local: { purpose } },
    });
    const vector = result.embeddings[0];
    if (vector === undefined) throw new Error('The local model returned no vector.');
    vectors.push(vector);
  }
  return vectors;
}

function seedOptions(ds: TestApp['ds']) {
  return {
    dataSource: ds,
    documents: loadSeedDocuments(),
    chunk: (document: { title: string; markdown: string }) => chunkMarkdown(document),
    embed,
    now: new Date('2026-11-15T12:00:00.000Z'),
  };
}

async function counts(ds: TestApp['ds'], workspaceId: string): Promise<number[]> {
  const tables = [
    'conversations',
    'messages',
    'generation_traces',
    'usage_daily',
    'knowledge_sources',
    'documents',
    'document_versions',
    'chunks',
    'saved_replies',
    'conversation_internal_notes',
    'conversation_ai_artifacts',
    'contact_external_links',
  ];
  const values: number[] = [];
  for (const table of tables) {
    const rows = await ds.query<CountRow[]>(
      `SELECT count(*)::int AS count FROM ${table} WHERE workspace_id = $1`,
      [workspaceId],
    );
    values.push(rows[0]?.count ?? 0);
  }
  return values;
}

describe('demo seed', () => {
  let t: TestApp;

  beforeAll(async () => {
    if (localModelStatus(DEFAULT_MODELS_DIR, DEMO_EMBEDDING_MODEL) !== 'ready') {
      throw new Error(
        'The local embedding model is missing: run pnpm --filter @app/api fetch-model.',
      );
    }
    t = await createTestApp();
  }, 60_000);

  afterAll(async () => {
    await t.close();
  });

  it('creates every admin list and a complete 30-day usage report', async () => {
    await resetDatabase(t.ds);
    const summary = await seedDemo(seedOptions(t.ds));
    const client = authed(t, await loginAs(t, { email: DEMO_EMAIL }, DEMO_PASSWORD));

    const bots = await client.get(`/api/v1/workspaces/${summary.workspaceId}/bots`);
    expect(bots.status).toBe(200);
    expect((bots.body as IdBody[]).length).toBe(1);

    const credentials = await client.get(`/api/v1/workspaces/${summary.workspaceId}/credentials`);
    expect(credentials.status).toBe(200);
    expect((credentials.body as IdBody[]).length).toBeGreaterThanOrEqual(2);

    const conversations = await client.get(
      `/api/v1/workspaces/${summary.workspaceId}/conversations`,
    );
    expect(conversations.status).toBe(200);
    expect((conversations.body as PageBody).data).toHaveLength(summary.conversations);

    const urgentRows = await t.ds.query<{ id: string }[]>(
      `SELECT id FROM conversations WHERE workspace_id = $1 AND priority = 'urgent'`,
      [summary.workspaceId],
    );
    expect(urgentRows).toHaveLength(1);
    const productivity = await client.get(
      `/api/v1/workspaces/${summary.workspaceId}/conversations/${urgentRows[0]?.id ?? ''}`,
    );
    expect(productivity.status).toBe(200);
    expect(productivity.body).toMatchObject({
      conversation: { priority: 'urgent' },
      contactHistory: [expect.any(Object)],
      crmLinks: [
        {
          provider: 'hubspot',
          url: 'https://app.hubspot.com/contacts/12345678/record/0-1/demo-contact-1042',
        },
      ],
      handoffSummary: { state: 'ready' },
      suggestedReply: { state: 'ready' },
    });
    expect(
      (productivity.body as ProductivityDetail).suggestedReply?.content.citations,
    ).toHaveLength(1);
    const notes = await client.get(
      `/api/v1/workspaces/${summary.workspaceId}/conversations/${urgentRows[0]?.id ?? ''}/internal-notes`,
    );
    expect(notes.status).toBe(200);
    expect(notes.body).toMatchObject([
      { body: 'Urgent handoff: check the carrier scan before replying.' },
    ]);

    const savedReplies = await client.get(
      `/api/v1/workspaces/${summary.workspaceId}/saved-replies`,
    );
    const seededReplies = savedReplies.body as { title: string; body: string }[];
    expect(seededReplies[0]?.title).toBe('Return follow-up');
    expect(seededReplies[0]?.body).toContain('secure form');

    const sources = await client.get(
      `/api/v1/workspaces/${summary.workspaceId}/bots/${summary.botId}/sources`,
    );
    expect(sources.status).toBe(200);
    expect((sources.body as SourceBody[]).length).toBe(1);
    expect((sources.body as SourceBody[])[0]?.status).toBe('ready');

    const usage = await client.get(
      `/api/v1/workspaces/${summary.workspaceId}/usage?from=2026-10-17&to=2026-11-15`,
    );
    expect(usage.status).toBe(200);
    expect((usage.body as UsageBody).days).toHaveLength(30);
    expect((usage.body as UsageBody).totals.conversations).toBeGreaterThan(0);

    const audit = await client.get(`/api/v1/workspaces/${summary.workspaceId}/audit-log`);
    expect(audit.status).toBe(200);
    expect((audit.body as PageBody).data.length).toBeGreaterThan(0);

    const decisions = await t.ds.query<{ decision: string }[]>(
      `SELECT DISTINCT decision FROM generation_traces WHERE workspace_id = $1 ORDER BY decision`,
      [summary.workspaceId],
    );
    expect(decisions.map((row) => row.decision)).toEqual([
      'answered',
      'escalated',
      'refused',
      'error',
    ]);

    const traceRows = await t.ds.query<{ id: string; message_id: string | null }[]>(
      `SELECT id, message_id FROM generation_traces
        WHERE workspace_id = $1 AND message_id IS NOT NULL LIMIT 1`,
      [summary.workspaceId],
    );
    const trace = await client.get(
      `/api/v1/workspaces/${summary.workspaceId}/traces/${traceRows[0]?.id ?? ''}`,
    );
    expect(trace.status).toBe(200);
    expect((trace.body as TraceBody).retrieval.length).toBeGreaterThan(0);
  }, 120_000);

  it('resets only the demo workspace on a second run', async () => {
    await resetDatabase(t.ds);
    const first = await seedDemo(seedOptions(t.ds));
    const before = await counts(t.ds, first.workspaceId);
    const second = await seedDemo(seedOptions(t.ds));
    const after = await counts(t.ds, second.workspaceId);

    expect(second.workspaceId).not.toBe(first.workspaceId);
    expect(after).toEqual(before);
    const old = await t.ds.query<CountRow[]>(
      `SELECT count(*)::int AS count FROM conversations WHERE workspace_id = $1`,
      [first.workspaceId],
    );
    expect(old[0]?.count).toBe(0);
    const users = await t.ds.query<CountRow[]>(`SELECT count(*)::int AS count FROM users`);
    expect(users[0]?.count).toBe(1);
  }, 120_000);
});
