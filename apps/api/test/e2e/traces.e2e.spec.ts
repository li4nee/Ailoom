// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestApp, type TestApp } from '../helpers/app';
import { resetDatabase } from '../helpers/db';
import {
  authed,
  type AuthedClient,
  createUser,
  createWorkspace,
  loginAs,
} from '../helpers/factories';

interface TraceBody {
  id: string;
  decision: string;
  decisionReason: string | null;
  origin: string;
  createdAt: string;
  promptVersion: { id: string; version: number; systemPrompt: string } | null;
  platformPromptVersion: string | null;
  chat: { provider: string; model: string } | null;
  embedding: { provider: string; model: string } | null;
  retrieval: {
    rank: number;
    score: number;
    used: boolean;
    chunkId: string;
    documentId: string | null;
    sourceTitle: string | null;
    preview: string | null;
    sourceDeleted: boolean;
  }[];
  requestSnapshot: unknown;
  inputTokens: number;
  outputTokens: number;
  embeddingTokens: number;
  costUsd: string;
  priceKnown: boolean;
  latencyMs: number | null;
  ttftMs: number | null;
  error: string | null;
  feedback: number | null;
}

let emailSeq = 0;

describe('trace replay', () => {
  let t: TestApp;
  let owner: AuthedClient;
  let workspaceId: string;
  let botId: string;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  beforeEach(async () => {
    await resetDatabase(t.ds);
    emailSeq += 1;
    const account = await createUser(
      { ds: t.ds },
      { email: `trace${String(emailSeq)}@example.com`, name: 'Olivia Owner' },
    );
    workspaceId = (await createWorkspace(t, account.user, 'Acme')).id;
    owner = authed(t, await loginAs(t, account.user, account.password));

    const credentials = await t.ds.query<{ id: string }[]>(
      `INSERT INTO provider_credentials (workspace_id, provider, label)
       VALUES ($1, 'mock', 'Chat'), ($1, 'mock', 'Embed') RETURNING id`,
      [workspaceId],
    );
    const [chat, embed] = credentials.map((row) => row.id);
    const bots = await t.ds.query<{ id: string }[]>(
      `INSERT INTO bots (workspace_id, name, public_key, chat_credential_id, chat_model,
                         embedding_credential_id, embedding_model, embedding_dim,
                         no_answer_behavior)
       VALUES ($1, 'Help', $2, $3, 'mock-chat', $4, 'mock-embed', 384, 'offer_handoff')
       RETURNING id`,
      [workspaceId, `pk_trace_${String(emailSeq)}`, chat, embed],
    );
    botId = bots[0]?.id ?? '';
  });

  interface Seeded {
    traceId: string;
    messageId: string;
    chunkId: string;
    deletedChunkId: string;
  }

  async function seedTrace(decision: 'answered' | 'escalated'): Promise<Seeded> {
    const contacts = await t.ds.query<{ id: string }[]>(
      `INSERT INTO contacts (workspace_id, email) VALUES ($1, 'visitor@example.com') RETURNING id`,
      [workspaceId],
    );
    const conversations = await t.ds.query<{ id: string }[]>(
      `INSERT INTO conversations (workspace_id, bot_id, contact_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [workspaceId, botId, contacts[0]?.id],
    );
    const conversationId = conversations[0]?.id ?? '';
    const messages = await t.ds.query<{ id: string }[]>(
      `INSERT INTO messages (workspace_id, conversation_id, role, content, feedback, feedback_at)
       VALUES ($1, $2, 'ai', 'Refunds take 30 days.', -1, now()) RETURNING id`,
      [workspaceId, conversationId],
    );
    const messageId = messages[0]?.id ?? '';
    const sources = await t.ds.query<{ id: string }[]>(
      `INSERT INTO knowledge_sources (workspace_id, bot_id, type, title)
       VALUES ($1, $2, 'text', 'Help centre') RETURNING id`,
      [workspaceId, botId],
    );
    const documents = await t.ds.query<{ id: string }[]>(
      `INSERT INTO documents (workspace_id, bot_id, source_id, title)
       VALUES ($1, $2, $3, 'Refund policy') RETURNING id`,
      [workspaceId, botId, sources[0]?.id],
    );
    const versions = await t.ds.query<{ id: string }[]>(
      `INSERT INTO document_versions (workspace_id, document_id, content_hash, content)
       VALUES ($1, $2, 'hash', 'Refunds are accepted within 30 days.') RETURNING id`,
      [workspaceId, documents[0]?.id],
    );
    const versionId = versions[0]?.id ?? '';
    await t.ds.query(`UPDATE documents SET current_version_id = $2 WHERE id = $1`, [
      documents[0]?.id,
      versionId,
    ]);
    const chunks = await t.ds.query<{ id: string }[]>(
      `INSERT INTO chunks (workspace_id, bot_id, document_version_id, ordinal, heading_path,
                           content, token_count, embedding, embedding_model, embedding_dim)
       VALUES ($1, $2, $3, 0, '# Refunds', 'Refunds are accepted within 30 days.', 7,
               $4::vector, 'mock-embed', 384) RETURNING id`,
      [workspaceId, botId, versionId, `[1,${Array<number>(383).fill(0).join(',')}]`],
    );
    const chunkId = chunks[0]?.id ?? '';
    const missingChunkId = '00000000-0000-4000-8000-000000000099';
    const prompts =
      decision === 'answered'
        ? await t.ds.query<{ id: string }[]>(
            `INSERT INTO prompt_versions (workspace_id, bot_id, version, system_prompt)
             VALUES ($1, $2, 2, 'Be concise.') RETURNING id`,
            [workspaceId, botId],
          )
        : [];
    const traces = await t.ds.query<{ id: string }[]>(
      `INSERT INTO generation_traces
         (workspace_id, bot_id, conversation_id, message_id, origin, decision, decision_reason,
          prompt_version_id, platform_prompt_version, chat_provider, chat_model,
          embedding_provider, embedding_model, retrieval, top_score, request_snapshot,
          input_tokens, output_tokens, embedding_tokens, cost_usd, latency_ms, ttft_ms)
       VALUES ($1, $2, $3, $4, 'widget', $5, $6, $7, '2026.11.1', $8, $9, $10, $11, $12,
               $13, $14, $15, $16, $17, $18, $19, $20)
       RETURNING id`,
      [
        workspaceId,
        botId,
        conversationId,
        messageId,
        decision,
        decision === 'answered' ? null : 'no_knowledge',
        prompts[0]?.id ?? null,
        decision === 'answered' ? 'mock' : null,
        decision === 'answered' ? 'mock-chat' : null,
        decision === 'answered' ? 'mock' : null,
        decision === 'answered' ? 'mock-embed' : null,
        JSON.stringify([
          { chunk_id: chunkId, score: 0.87, rank: 1, used: true },
          { chunk_id: missingChunkId, score: 0.12, rank: 2, used: false },
        ]),
        decision === 'answered' ? 0.87 : null,
        JSON.stringify({ model: 'mock-chat', messages: [{ role: 'user', content: 'refund?' }] }),
        decision === 'answered' ? 42 : 0,
        decision === 'answered' ? 8 : 0,
        decision === 'answered' ? 5 : 0,
        decision === 'answered' ? '0.001234' : '0.000000',
        decision === 'answered' ? 900 : 12,
        decision === 'answered' ? 250 : null,
      ],
    );
    return {
      traceId: traces[0]?.id ?? '',
      messageId,
      chunkId,
      deletedChunkId: missingChunkId,
    };
  }

  it('returns the full replay of an answered trace, including a deleted source row', async () => {
    const seeded = await seedTrace('answered');

    const res = await owner.get(`/api/v1/workspaces/${workspaceId}/traces/${seeded.traceId}`);

    expect(res.status).toBe(200);
    const body = res.body as TraceBody;
    expect(body).toMatchObject({
      id: seeded.traceId,
      decision: 'answered',
      origin: 'widget',
      platformPromptVersion: '2026.11.1',
      promptVersion: { version: 2, systemPrompt: 'Be concise.' },
      chat: { provider: 'mock', model: 'mock-chat' },
      embedding: { provider: 'mock', model: 'mock-embed' },
      inputTokens: 42,
      outputTokens: 8,
      embeddingTokens: 5,
      costUsd: '0.001234',
      priceKnown: true,
      latencyMs: 900,
      ttftMs: 250,
      feedback: -1,
    });
    expect(body.retrieval).toHaveLength(2);
    expect(body.retrieval[0]).toMatchObject({
      rank: 1,
      score: 0.87,
      used: true,
      chunkId: seeded.chunkId,
      sourceTitle: 'Refund policy',
      preview: 'Refunds are accepted within 30 days.',
      sourceDeleted: false,
    });
    expect(body.retrieval[0]?.documentId).toEqual(expect.any(String));
    expect(body.retrieval[1]).toMatchObject({
      rank: 2,
      used: false,
      chunkId: seeded.deletedChunkId,
      documentId: null,
      sourceTitle: null,
      preview: null,
      sourceDeleted: true,
    });
    expect(JSON.stringify(body.requestSnapshot)).not.toContain('secret');
  });

  it('still renders after the cited chunk is deleted', async () => {
    const seeded = await seedTrace('answered');
    await t.ds.query(`DELETE FROM chunks WHERE id = $1`, [seeded.chunkId]);

    const res = await owner.get(`/api/v1/workspaces/${workspaceId}/traces/${seeded.traceId}`);

    expect(res.status).toBe(200);
    expect((res.body as TraceBody).retrieval[0]).toMatchObject({
      chunkId: seeded.chunkId,
      sourceDeleted: true,
      documentId: null,
      sourceTitle: null,
      preview: null,
    });
  });

  it('returns a trace by AI message id', async () => {
    const seeded = await seedTrace('answered');

    const res = await owner.get(
      `/api/v1/workspaces/${workspaceId}/messages/${seeded.messageId}/trace`,
    );

    expect(res.status).toBe(200);
    expect((res.body as TraceBody).id).toBe(seeded.traceId);
  });

  it('keeps an escalated trace with no chat usage', async () => {
    const seeded = await seedTrace('escalated');

    const res = await owner.get(`/api/v1/workspaces/${workspaceId}/traces/${seeded.traceId}`);

    expect(res.status).toBe(200);
    const body = res.body as TraceBody;
    expect(body).toMatchObject({
      decision: 'escalated',
      decisionReason: 'no_knowledge',
      chat: null,
      embedding: null,
      promptVersion: null,
      inputTokens: 0,
      outputTokens: 0,
      priceKnown: true,
    });
  });

  it('404s a message that never got a trace', async () => {
    const contacts = await t.ds.query<{ id: string }[]>(
      `INSERT INTO contacts (workspace_id) VALUES ($1) RETURNING id`,
      [workspaceId],
    );
    const conversations = await t.ds.query<{ id: string }[]>(
      `INSERT INTO conversations (workspace_id, bot_id, contact_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [workspaceId, botId, contacts[0]?.id],
    );
    const messages = await t.ds.query<{ id: string }[]>(
      `INSERT INTO messages (workspace_id, conversation_id, role, content)
       VALUES ($1, $2, 'ai', 'No trace') RETURNING id`,
      [workspaceId, conversations[0]?.id],
    );

    const res = await owner.get(
      `/api/v1/workspaces/${workspaceId}/messages/${messages[0]?.id ?? ''}/trace`,
    );

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: { code: 'not_found' } });
  });
});
