// SPDX-License-Identifier: AGPL-3.0-only
import { EventEmitterModule, EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { ClsModule } from 'nestjs-cls';
import { Client } from 'pg';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from 'vitest';

import type { Citation } from '@app/shared';

import { getTestDataSource, resetDatabase } from '../../../test/helpers/db';
import { Clock, FixedClock } from '../../common/clock';
import { ConfigModule, loadConfig } from '../../common/config';
import { DatabaseModule } from '../../db';
import { asWorkspaceId, type WorkspaceId } from '../../db/ids';
import { JobsService } from '../../jobs';
import { BotsRepository } from '../bots';
import { ConversationsModule } from '../conversations';
import { workspaceChannel } from '../realtime';
import { TracesModule } from '../traces';
import { UsageModule } from '../usage';
import { ChatPersistence, type FinalizeInput } from './chat-persistence.service';
import { CHAT_HANDOFF_REQUESTED, type ChatHandoffRequestedEvent } from './events';

function config() {
  return loadConfig({
    NODE_ENV: 'test',
    PUBLIC_URL: 'https://support.example.com',
    DATABASE_URL: inject('databaseUrl'),
    AUTH_SECRET: 'a'.repeat(32),
    WIDGET_SECRET: 'w'.repeat(32),
    ENCRYPTION_KEYS: `v1:${'ab'.repeat(32)}`,
    LOG_LEVEL: 'error',
  });
}

const clock = new FixedClock(new Date('2026-02-01T12:00:00Z'));

let ds: DataSource;
let module_: Awaited<ReturnType<typeof buildModule>>;
let persistence: ChatPersistence;
let events: EventEmitter2;

async function buildModule(dataSource: DataSource) {
  const cfg = config();
  return Test.createTestingModule({
    imports: [
      ConfigModule.forRoot(cfg),
      DatabaseModule.forRoot(cfg, dataSource),
      ClsModule.forRoot({ global: true }),
      EventEmitterModule.forRoot(),
      ConversationsModule,
      TracesModule,
      UsageModule,
    ],
    providers: [
      ChatPersistence,
      BotsRepository,
      { provide: JobsService, useValue: { enqueue: vi.fn(() => Promise.resolve('job')) } },
      { provide: Clock, useValue: clock },
    ],
  }).compile();
}

interface Seeded {
  workspaceId: WorkspaceId;
  botId: string;
  conversationId: string;
  contactId: string;
}

async function seed(status: 'ai' | 'human' = 'ai'): Promise<Seeded> {
  const rows = await ds.query<{ id: string }[]>(
    `INSERT INTO workspaces (name, slug) VALUES ('Chat', $1) RETURNING id`,
    [`chat-${Math.random().toString(36).slice(2, 8)}`],
  );
  const workspaceId = asWorkspaceId(rows[0]?.id ?? '');
  const credentials = await ds.query<{ id: string }[]>(
    `INSERT INTO provider_credentials (workspace_id, provider, label)
     VALUES ($1, 'mock', 'chat'), ($1, 'mock', 'embed') RETURNING id`,
    [workspaceId],
  );
  const [chat, embed] = credentials.map((row) => row.id);
  const bot = await ds.query<{ id: string }[]>(
    `INSERT INTO bots (workspace_id, name, public_key, chat_credential_id, chat_model,
                       embedding_credential_id, embedding_model, embedding_dim)
     VALUES ($1, 'Help', $2, $3, 'mock-chat', $4, 'mock-embed', 384) RETURNING id`,
    [workspaceId, `pk_live_${Math.random().toString(36).slice(2, 10)}`, chat, embed],
  );
  const botId = bot[0]?.id ?? '';
  const contact = await ds.query<{ id: string }[]>(
    `INSERT INTO contacts (workspace_id) VALUES ($1) RETURNING id`,
    [workspaceId],
  );
  const contactId = contact[0]?.id ?? '';
  const conversation = await ds.query<{ id: string }[]>(
    `INSERT INTO conversations (workspace_id, bot_id, contact_id, status)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [workspaceId, botId, contactId, status],
  );
  return { workspaceId, botId, conversationId: conversation[0]?.id ?? '', contactId };
}

function baseFinalize(seeded: Seeded, overrides: Partial<FinalizeInput> = {}): FinalizeInput {
  return {
    workspaceId: seeded.workspaceId,
    botId: seeded.botId,
    conversationId: seeded.conversationId,
    aiMessageId: null,
    triggerMessageId: null,
    origin: 'widget',
    content: 'Refunds take 30 days [1].',
    status: 'complete',
    citations: [],
    decision: 'answered',
    decisionReason: null,
    retrieval: [],
    topScore: 0.9,
    promptVersionId: null,
    platformPromptVersion: '2026.11.1',
    chat: { provider: 'openai', model: 'gpt-4o-mini', inputTokens: 1000, outputTokens: 500 },
    embedding: null,
    requestSnapshot: null,
    latencyMs: 120,
    ttftMs: 40,
    error: null,
    escalation: null,
    ...overrides,
  };
}

const citation: Citation = {
  n: 1,
  chunkId: 'c1',
  documentId: 'd1',
  title: 'Refunds',
  url: 'https://shop.example/refunds',
};

beforeAll(async () => {
  ds = await getTestDataSource();
  module_ = await buildModule(ds);
  await module_.init();
  persistence = module_.get(ChatPersistence);
  events = module_.get(EventEmitter2);
});

afterAll(async () => {
  await module_.close();
});

beforeEach(async () => {
  await resetDatabase(ds);
  clock.set(new Date('2026-02-01T12:00:00Z'));
});

describe('ChatPersistence.beginTurn', () => {
  it('rejects a second turn while one is streaming', async () => {
    const seeded = await seed();
    await persistence.beginTurn(seeded.workspaceId, seeded.conversationId, 'q1');

    await expect(
      persistence.beginTurn(seeded.workspaceId, seeded.conversationId, 'q2'),
    ).rejects.toMatchObject({ code: 'answer_in_progress' });
  });

  it('allows a new turn after 90 s of a stuck stream', async () => {
    const seeded = await seed();
    await persistence.beginTurn(seeded.workspaceId, seeded.conversationId, 'q1');
    clock.advance(91_000);

    const second = await persistence.beginTurn(seeded.workspaceId, seeded.conversationId, 'q2');
    expect(second.aiMessageId).toEqual(expect.any(String));
  });

  it('caps conversations at 200 messages', async () => {
    const seeded = await seed();
    await ds.query(
      `INSERT INTO messages (workspace_id, conversation_id, role, content, status)
       SELECT $1, $2, 'visitor', 'old', 'complete' FROM generate_series(1, 200)`,
      [seeded.workspaceId, seeded.conversationId],
    );

    await expect(
      persistence.beginTurn(seeded.workspaceId, seeded.conversationId, 'one more'),
    ).rejects.toMatchObject({ code: 'conversation_full' });
  });

  it('stores only the visitor message when a human owns the conversation', async () => {
    const seeded = await seed('human');
    const turn = await persistence.beginTurn(seeded.workspaceId, seeded.conversationId, 'hello');

    expect(turn.aiMessageId).toBeNull();
    const messages = await ds.query<{ role: string }[]>(
      `SELECT role FROM messages WHERE conversation_id = $1`,
      [seeded.conversationId],
    );
    expect(messages).toEqual([{ role: 'visitor' }]);
  });
});

describe('ChatPersistence.finalize', () => {
  it('is atomic', async () => {
    const seeded = await seed();
    const turn = await persistence.beginTurn(seeded.workspaceId, seeded.conversationId, 'q');
    const before = await ds.query<Record<string, unknown>[]>(`SELECT * FROM usage_daily`);

    await expect(
      persistence.finalize(
        baseFinalize(seeded, {
          aiMessageId: turn.aiMessageId,
          triggerMessageId: turn.visitorMessage.id,
          // Invalid enum value: the last write fails and must roll the message update back.
          decision: 'bogus' as never,
        }),
      ),
    ).rejects.toThrow();

    const message = await ds.query<{ content: string; status: string }[]>(
      `SELECT content, status FROM messages WHERE id = $1`,
      [turn.aiMessageId],
    );
    expect(message).toEqual([{ content: '', status: 'streaming' }]);
    expect(await ds.query(`SELECT * FROM usage_daily`)).toEqual(before);
    expect(await ds.query(`SELECT * FROM generation_traces`)).toEqual([]);
  });

  it('computes cost and updates usage', async () => {
    const seeded = await seed();
    const turn = await persistence.beginTurn(seeded.workspaceId, seeded.conversationId, 'q');

    const result = await persistence.finalize(
      baseFinalize(seeded, {
        aiMessageId: turn.aiMessageId,
        triggerMessageId: turn.visitorMessage.id,
        citations: [citation],
      }),
    );

    expect(result.costUsd).toBe('0.000450');
    const message = await ds.query<{ content: string; status: string; citations: unknown }[]>(
      `SELECT content, status, citations FROM messages WHERE id = $1`,
      [turn.aiMessageId],
    );
    expect(message[0]).toMatchObject({ status: 'complete' });
    expect(message[0]?.citations).toEqual([
      {
        n: 1,
        chunk_id: 'c1',
        document_id: 'd1',
        title: 'Refunds',
        url: 'https://shop.example/refunds',
      },
    ]);

    const usage = await ds.query<Record<string, string | number>[]>(
      `SELECT * FROM usage_daily WHERE workspace_id = $1 AND bot_id = $2`,
      [seeded.workspaceId, seeded.botId],
    );
    expect(usage[0]).toMatchObject({
      visitor_messages: 1,
      ai_messages: 1,
      input_tokens: '1000',
      output_tokens: '500',
      cost_usd: '0.000450',
    });

    const trace = await ds.query<Record<string, unknown>[]>(
      `SELECT * FROM generation_traces WHERE id = $1`,
      [result.traceId],
    );
    expect(trace[0]).toMatchObject({
      decision: 'answered',
      platform_prompt_version: '2026.11.1',
      message_id: turn.aiMessageId,
      trigger_message_id: turn.visitorMessage.id,
    });
  });

  it('auto handoff sets needs_human and emits after commit', async () => {
    const seeded = await seed();
    const turn = await persistence.beginTurn(seeded.workspaceId, seeded.conversationId, 'q');
    let seen: ChatHandoffRequestedEvent | null = null;
    events.on(CHAT_HANDOFF_REQUESTED, (event: ChatHandoffRequestedEvent) => {
      seen = event;
    });

    await persistence.finalize(
      baseFinalize(seeded, {
        aiMessageId: turn.aiMessageId,
        decision: 'escalated',
        decisionReason: 'handoff_intent',
        content: 'Connecting you.',
        escalation: { setsNeedsHuman: true, reason: 'handoff_intent' },
        chat: null,
      }),
    );

    const conversation = await ds.query<Record<string, unknown>[]>(
      `SELECT status, handoff_reason, handoff_requested_at FROM conversations WHERE id = $1`,
      [seeded.conversationId],
    );
    expect(conversation[0]).toMatchObject({
      status: 'needs_human',
      handoff_reason: 'handoff_intent',
    });
    expect(conversation[0]?.['handoff_requested_at']).not.toBeNull();
    expect(seen).toMatchObject({
      workspaceId: seeded.workspaceId,
      conversationId: seeded.conversationId,
    });
  });

  it('notifies only after commit', async () => {
    const seeded = await seed();
    const turn = await persistence.beginTurn(seeded.workspaceId, seeded.conversationId, 'q');

    const client = new Client({ connectionString: inject('databaseUrl') });
    await client.connect();
    const notes: string[] = [];
    client.on('notification', (notification) => {
      notes.push(notification.payload ?? '');
    });
    await client.query(`LISTEN ${workspaceChannel(seeded.workspaceId)}`);

    try {
      await persistence.finalize(
        baseFinalize(seeded, {
          aiMessageId: turn.aiMessageId,
          triggerMessageId: turn.visitorMessage.id,
        }),
      );
      // A notification is delivered at commit, so it can only arrive once the rows exist.
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(notes.some((payload) => payload.includes('message.created'))).toBe(true);
      expect(notes.some((payload) => payload.includes('conversation.updated'))).toBe(true);
      expect(
        await ds.query(`SELECT 1 FROM generation_traces WHERE message_id = $1`, [turn.aiMessageId]),
      ).toHaveLength(1);
    } finally {
      await client.end();
    }
  });

  it('playground finalize writes a trace without conversation or message', async () => {
    const seeded = await seed();

    const result = await persistence.finalize(
      baseFinalize(seeded, {
        conversationId: null,
        aiMessageId: null,
        triggerMessageId: null,
        origin: 'playground',
      }),
    );

    const trace = await ds.query<Record<string, unknown>[]>(
      `SELECT * FROM generation_traces WHERE id = $1`,
      [result.traceId],
    );
    expect(trace[0]).toMatchObject({
      origin: 'playground',
      conversation_id: null,
      message_id: null,
      cost_usd: '0.000450',
    });

    const usage = await ds.query<Record<string, string | number>[]>(
      `SELECT * FROM usage_daily WHERE workspace_id = $1 AND bot_id = $2`,
      [seeded.workspaceId, seeded.botId],
    );
    expect(usage[0]).toMatchObject({ ai_messages: 0, cost_usd: '0.000450' });
  });
});
