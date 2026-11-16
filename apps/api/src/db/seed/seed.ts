// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto';

import { hash as hashPassword } from '@node-rs/argon2';
import type { DataSource } from 'typeorm';

import { DEMO_CONVERSATIONS } from './conversations';

export const DEMO_EMAIL = 'dev@example.com';
export const DEMO_PASSWORD = 'devpassword';
export const DEMO_WORKSPACE_SLUG = 'northwind-outfitters';
export const DEMO_BOT_PUBLIC_KEY = 'pk_live_northwind_demo';
export const DEMO_EMBEDDING_MODEL = 'bge-small-en-v1.5';
const EMBEDDING_DIM = 384;

export interface SeedDocument {
  title: string;
  markdown: string;
}

export interface SeedChunk {
  ordinal: number;
  headingPath: string;
  content: string;
  tokenCount: number;
  embedText: string;
}

export type ChunkFactory = (document: SeedDocument) => SeedChunk[];
export type EmbedTexts = (texts: string[], purpose: 'query' | 'document') => Promise<number[][]>;

export interface SeedOptions {
  dataSource: DataSource;
  documents: SeedDocument[];
  chunk: ChunkFactory;
  embed: EmbedTexts;
  /** Adds the Ollama credential used by the Docker demo profile. */
  seedOllama?: boolean;
  /** The instant the demo is anchored to; defaults to now. */
  now?: Date;
}

export interface SeedSummary {
  workspaceId: string;
  botId: string;
  conversations: number;
  traces: number;
  usageDays: number;
}

interface IdRow {
  id: string;
}

function daysAgo(now: Date, days: number, hour: number): Date {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() - days);
  date.setUTCHours(hour, 0, 0, 0);
  return date;
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function vectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}

/**
 * Creates the complete demo workspace. Everything the seed owns lives under the demo slug, so
 * a second run removes and recreates only that workspace; the demo user stays global and is
 * upserted. The caller supplies embeddings and chunking, keeping this file free of provider and
 * knowledge-module imports (the `db-only-common` dependency rule).
 */
export async function seedDemo(opts: SeedOptions): Promise<SeedSummary> {
  const { dataSource: ds } = opts;
  const now = opts.now ?? new Date();
  const passwordHash = await hashPassword(DEMO_PASSWORD, {
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });

  return ds.transaction(async (manager) => {
    const existing = await manager.query<IdRow[]>(`SELECT id FROM workspaces WHERE slug = $1`, [
      DEMO_WORKSPACE_SLUG,
    ]);
    const oldWorkspaceId = existing[0]?.id;
    if (oldWorkspaceId !== undefined) {
      await manager.query(`DELETE FROM audit_log WHERE workspace_id = $1`, [oldWorkspaceId]);
      await manager.query(`DELETE FROM workspaces WHERE id = $1`, [oldWorkspaceId]);
    }

    const users = await manager.query<IdRow[]>(
      `INSERT INTO users (email, password_hash, name, email_verified_at, is_instance_admin)
       VALUES ($1, $2, 'Demo Admin', $3, true)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash,
         name = EXCLUDED.name, email_verified_at = EXCLUDED.email_verified_at,
         is_instance_admin = true
       RETURNING id`,
      [DEMO_EMAIL, passwordHash, daysAgo(now, 90, 9)],
    );
    const userId = users[0]?.id ?? '';

    const workspaces = await manager.query<IdRow[]>(
      `INSERT INTO workspaces (name, slug, settings)
       VALUES ('Northwind Outfitters', $1, '{"demo":true}'::jsonb) RETURNING id`,
      [DEMO_WORKSPACE_SLUG],
    );
    const workspaceId = workspaces[0]?.id ?? '';

    await manager.query(
      `INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [workspaceId, userId],
    );

    const credentials = await manager.query<IdRow[]>(
      `INSERT INTO provider_credentials (workspace_id, provider, label)
       VALUES ($1, 'local', 'Built-in embeddings') RETURNING id`,
      [workspaceId],
    );
    const localCredentialId = credentials[0]?.id ?? '';
    const mockCredentials = await manager.query<IdRow[]>(
      `INSERT INTO provider_credentials (workspace_id, provider, label)
       VALUES ($1, 'mock', 'Demo model') RETURNING id`,
      [workspaceId],
    );
    const mockCredentialId = mockCredentials[0]?.id ?? '';
    if (opts.seedOllama === true) {
      await manager.query(
        `INSERT INTO provider_credentials (workspace_id, provider, label, base_url)
         VALUES ($1, 'ollama', 'Local Ollama', 'http://ollama:11434')`,
        [workspaceId],
      );
    }

    await manager.query(`UPDATE provider_credentials SET last_used_at = $2 WHERE id = $1`, [
      mockCredentialId,
      daysAgo(now, 0, 10),
    ]);

    const bots = await manager.query<IdRow[]>(
      `INSERT INTO bots (workspace_id, name, public_key, allowed_origins, chat_credential_id,
         chat_model, embedding_credential_id, embedding_model, embedding_dim, retrieval_threshold,
         temperature, max_output_tokens, no_answer_behavior, handoff_enabled,
         monthly_spend_cap_usd, appearance, fallback_message, handoff_message, allowed_link_domains)
       VALUES ($1, 'Help Center', $2, $3, $4, 'mock-chat', $5, $6, $7, 0.35, 0.2, 600,
         'offer_handoff', true, 50.00, $8::jsonb, $9, $10, $11)
       RETURNING id`,
      [
        workspaceId,
        DEMO_BOT_PUBLIC_KEY,
        ['http://localhost:8090', 'http://shop.localhost:8090'],
        mockCredentialId,
        localCredentialId,
        DEMO_EMBEDDING_MODEL,
        EMBEDDING_DIM,
        JSON.stringify({
          displayName: 'Northwind Support',
          themeColor: '#2f6b4f',
          position: 'right',
          welcomeMessage: 'Hi! Ask me about orders, returns, shipping, or gear.',
          avatarUrl: null,
          privacyUrl: 'https://northwindoutfitters.example/privacy',
        }),
        'I do not have that answer yet. Would you like to talk with our team?',
        'Thanks — a Northwind teammate will reply shortly.',
        ['northwindoutfitters.example'],
      ],
    );
    const botId = bots[0]?.id ?? '';

    const prompt = await manager.query<IdRow[]>(
      `INSERT INTO prompt_versions (workspace_id, bot_id, version, system_prompt, note, created_by, created_at)
       VALUES ($1, $2, 1, $3, 'Demo prompt', $4, $5) RETURNING id`,
      [
        workspaceId,
        botId,
        'Answer only from the provided Northwind Outfitters knowledge. If the answer is not there, offer a handoff.',
        userId,
        daysAgo(now, 60, 9),
      ],
    );
    await manager.query(`UPDATE bots SET active_prompt_version_id = $2 WHERE id = $1`, [
      botId,
      prompt[0]?.id,
    ]);

    const sources = await manager.query<IdRow[]>(
      `INSERT INTO knowledge_sources (workspace_id, bot_id, type, title, status, pages_total,
         pages_done, last_synced_at, created_at)
       VALUES ($1, $2, 'text', 'Northwind help center', 'ready', $3, $3, $4, $4) RETURNING id`,
      [workspaceId, botId, opts.documents.length, daysAgo(now, 45, 9)],
    );
    const sourceId = sources[0]?.id ?? '';

    interface IndexedChunk {
      id: string;
      title: string;
      url: string | null;
    }
    const indexed: IndexedChunk[] = [];
    for (const document of opts.documents) {
      const slug = document.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const url = `https://northwindoutfitters.example/help/${slug}`;
      const docs = await manager.query<IdRow[]>(
        `INSERT INTO documents (workspace_id, bot_id, source_id, url, title, status, created_at)
         VALUES ($1, $2, $3, $4, $5, 'active', $6) RETURNING id`,
        [workspaceId, botId, sourceId, url, document.title, daysAgo(now, 45, 9)],
      );
      const documentId = docs[0]?.id ?? '';
      const versions = await manager.query<IdRow[]>(
        `INSERT INTO document_versions (workspace_id, document_id, content_hash, content, created_at)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [
          workspaceId,
          documentId,
          createHash('sha256').update(document.markdown).digest('hex'),
          document.markdown,
          daysAgo(now, 45, 9),
        ],
      );
      const versionId = versions[0]?.id ?? '';
      await manager.query(`UPDATE documents SET current_version_id = $2 WHERE id = $1`, [
        documentId,
        versionId,
      ]);

      const chunks = opts.chunk(document);
      const embeddings = await opts.embed(
        chunks.map((chunk) => chunk.embedText),
        'document',
      );
      for (const [index, chunk] of chunks.entries()) {
        const vector = embeddings[index];
        if (vector === undefined) throw new Error('The embedding model returned too few vectors.');
        const rows = await manager.query<IdRow[]>(
          `INSERT INTO chunks (workspace_id, bot_id, document_version_id, ordinal, heading_path,
             content, metadata, token_count, embedding, embedding_model, embedding_dim, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, '{}'::jsonb, $7, $8::vector, $9, $10, $11)
           RETURNING id`,
          [
            workspaceId,
            botId,
            versionId,
            chunk.ordinal,
            chunk.headingPath,
            chunk.content,
            chunk.tokenCount,
            vectorLiteral(vector),
            DEMO_EMBEDDING_MODEL,
            EMBEDDING_DIM,
            daysAgo(now, 45, 9),
          ],
        );
        indexed.push({ id: rows[0]?.id ?? '', title: document.title, url });
      }
    }

    let traceCount = 0;
    for (const [index, conversation] of DEMO_CONVERSATIONS.entries()) {
      const created = daysAgo(now, conversation.ageDays, 10 + (index % 8));
      const lastMessage = new Date(created.getTime() + (index + 1) * 60_000);
      const contactRows = await manager.query<IdRow[]>(
        `INSERT INTO contacts (workspace_id, name, email, first_seen_at, last_seen_at)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [
          workspaceId,
          `Visitor ${String(index + 1)}`,
          `visitor${String(index + 1)}@example.com`,
          created,
          lastMessage,
        ],
      );
      const contactId = contactRows[0]?.id ?? '';
      const convoRows = await manager.query<IdRow[]>(
        `INSERT INTO conversations (workspace_id, bot_id, contact_id, channel, status,
           assigned_user_id, handoff_reason, handoff_requested_at, priority, last_message_at,
           closed_at, metadata, created_at)
         VALUES ($1, $2, $3, 'web', $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12) RETURNING id`,
        [
          workspaceId,
          botId,
          contactId,
          conversation.status,
          conversation.assigned ? userId : null,
          conversation.handoffReason,
          conversation.handoffReason === null ? null : created,
          conversation.decision === 'escalated' ? 'high' : 'normal',
          lastMessage,
          conversation.closed ? new Date(lastMessage.getTime() + 3_600_000) : null,
          JSON.stringify({
            pageUrl: 'http://localhost:8090/',
            locale: 'en-US',
            userAgent: 'Mozilla/5.0 (demo seed)',
          }),
          created,
        ],
      );
      const conversationId = convoRows[0]?.id ?? '';

      const visitorRows = await manager.query<IdRow[]>(
        `INSERT INTO messages (workspace_id, conversation_id, role, content, status, created_at)
         VALUES ($1, $2, 'visitor', $3, 'complete', $4) RETURNING id`,
        [workspaceId, conversationId, conversation.visitor, created],
      );
      const visitorMessageId = visitorRows[0]?.id ?? '';

      const answerRows = await manager.query<IdRow[]>(
        `INSERT INTO messages (workspace_id, conversation_id, role, content, citations, status,
           feedback, feedback_at, created_at)
         VALUES ($1, $2, 'ai', $3, $4::jsonb, 'complete', $5, $6, $7) RETURNING id`,
        [
          workspaceId,
          conversationId,
          conversation.answer,
          JSON.stringify(
            conversation.decision === 'answered' && indexed[0] !== undefined
              ? [
                  {
                    n: 1,
                    chunk_id: indexed[index % indexed.length]?.id ?? '',
                    document_id: '',
                    title: indexed[index % indexed.length]?.title ?? null,
                    url: indexed[index % indexed.length]?.url ?? null,
                  },
                ]
              : [],
          ),
          conversation.feedback,
          conversation.feedback === null ? null : new Date(lastMessage.getTime() + 60_000),
          new Date(created.getTime() + 30_000),
        ],
      );
      const answerMessageId = answerRows[0]?.id ?? '';

      if (conversation.assigned) {
        await manager.query(
          `INSERT INTO messages (workspace_id, conversation_id, role, author_user_id, content,
             status, created_at)
           VALUES ($1, $2, 'agent', $3, $4, 'complete', $5)`,
          [
            workspaceId,
            conversationId,
            userId,
            `Hi, I'm on the Northwind team. ${conversation.answer}`,
            new Date(created.getTime() + 120_000),
          ],
        );
      }

      const candidates = indexed.slice(
        index % Math.max(1, indexed.length - 4),
        (index % Math.max(1, indexed.length - 4)) + 5,
      );
      const retrieval = candidates.map((chunk, rank) => ({
        chunk_id: chunk.id,
        score: Number((0.82 - rank * 0.09).toFixed(3)),
        rank: rank + 1,
        used: conversation.decision === 'answered' && rank === 0,
      }));
      const topScore = retrieval[0]?.score ?? null;
      const traceMessageId =
        conversation.decision === 'escalated' || conversation.decision === 'error'
          ? null
          : answerMessageId;
      await manager.query(
        `INSERT INTO generation_traces (workspace_id, bot_id, conversation_id, message_id,
           trigger_message_id, prompt_version_id, platform_prompt_version, origin, chat_provider,
           chat_model, embedding_provider, embedding_model, retrieval, top_score, decision,
           decision_reason, request_snapshot, input_tokens, output_tokens, embedding_tokens,
           cost_usd, latency_ms, ttft_ms, error, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'v1', 'widget', 'mock', 'mock-chat', 'local', $7,
           $8::jsonb, $9, $10, $11, $12::jsonb, $13, $14, 24, $15, $16, $17, $18, $19)`,
        [
          workspaceId,
          botId,
          conversationId,
          traceMessageId,
          visitorMessageId,
          prompt[0]?.id,
          DEMO_EMBEDDING_MODEL,
          JSON.stringify(retrieval),
          topScore,
          conversation.decision,
          conversation.decisionReason,
          JSON.stringify({
            messages: [
              { role: 'system', content: 'Northwind help center prompt' },
              { role: 'user', content: conversation.visitor },
            ],
            topK: 5,
          }),
          120 + index * 11,
          40 + index * 7,
          0.00042 + index * 0.00003,
          380 + index * 41,
          120 + index * 3,
          conversation.error,
          created,
        ],
      );
      traceCount += 1;
    }

    // An explicit playground example makes the trace list useful before a visitor arrives.
    await manager.query(
      `INSERT INTO generation_traces (workspace_id, bot_id, origin, chat_provider, chat_model,
         embedding_provider, embedding_model, retrieval, top_score, decision, request_snapshot,
         input_tokens, output_tokens, embedding_tokens, cost_usd, latency_ms, ttft_ms, created_at)
       VALUES ($1, $2, 'playground', 'mock', 'mock-chat', 'local', $3, $4::jsonb, 0.81,
         'answered', '{"topK":5}'::jsonb, 118, 31, 19, 0.00038, 355, 101, $5)`,
      [
        workspaceId,
        botId,
        DEMO_EMBEDDING_MODEL,
        JSON.stringify(
          indexed.slice(0, 3).map((chunk, rank) => ({
            chunk_id: chunk.id,
            score: 0.81 - rank * 0.1,
            rank: rank + 1,
            used: rank === 0,
          })),
        ),
        daysAgo(now, 1, 15),
      ],
    );
    traceCount += 1;

    // Usage is a full 30-day series, so the dashboard always has a complete chart.
    for (let age = 0; age < 30; age += 1) {
      const day = dateOnly(daysAgo(now, age, 0));
      const wave = (age * 7) % 5;
      await manager.query(
        `INSERT INTO usage_daily (workspace_id, bot_id, day, conversations, visitor_messages,
           ai_messages, escalations, input_tokens, output_tokens, embedding_tokens, cost_usd)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          workspaceId,
          botId,
          day,
          1 + wave,
          2 + wave * 2,
          1 + wave,
          age % 4 === 0 ? 1 : 0,
          220 + age * 17,
          90 + wave * 31,
          40 + wave * 9,
          0.001 + age * 0.00007,
        ],
      );
    }

    const auditActions = [
      ['workspace.created', 'workspace', workspaceId],
      ['credential.created', 'provider_credential', mockCredentialId],
      ['knowledge.source.created', 'knowledge_source', sourceId],
      ['bot.created', 'bot', botId],
    ] as const;
    for (const [action, targetType, targetId] of auditActions) {
      await manager.query(
        `INSERT INTO audit_log (workspace_id, actor_user_id, action, target_type, target_id,
           metadata, ip, created_at)
         VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, '127.0.0.1', $6)`,
        [workspaceId, userId, action, targetType, targetId, daysAgo(now, 60, 9)],
      );
    }

    return {
      workspaceId,
      botId,
      conversations: DEMO_CONVERSATIONS.length,
      traces: traceCount,
      usageDays: 30,
    };
  });
}
