// SPDX-License-Identifier: AGPL-3.0-only
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { DataSource } from 'typeorm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDataSource, resetDatabase } from '../../../test/helpers/db';
import { createUser } from '../../../test/helpers/factories';
import { FixedClock } from '../../common/clock';
import { asWorkspaceId, type WorkspaceId } from '../../db/ids';
import { type JobsService } from '../../jobs';
import { BotsRepository } from '../bots';
import { ChatPersistence } from '../chat/chat-persistence.service';
import { ConversationsRepository, MessagesRepository } from '../conversations';
import { type EmailService } from '../email';
import { TracesRepository } from '../traces';
import { ModelPricesRepository } from './model-prices.repository';
import { PricingService } from './pricing.service';
import { SpendAlertsProcessor } from './spend-alerts.processor';
import { UsageRepository } from './usage.repository';
import { utcDay } from './utc';

const clock = new FixedClock(new Date('2026-02-01T12:00:00Z'));

let ds: DataSource;
let usage: UsageRepository;
let bots: BotsRepository;
let enqueued: { payload: Record<string, unknown>; key: string | undefined }[];
let persistence: ChatPersistence;

interface Seeded {
  workspaceId: WorkspaceId;
  botId: string;
}

async function seedBot(cap: string | null = '10.00'): Promise<Seeded> {
  const rows = await ds.query<{ id: string }[]>(
    `INSERT INTO workspaces (name, slug) VALUES ('Alerts', $1) RETURNING id`,
    [`alert-${Math.random().toString(36).slice(2, 8)}`],
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
                       embedding_credential_id, embedding_model, embedding_dim, monthly_spend_cap_usd)
     VALUES ($1, 'Help', $2, $3, 'mock-chat', $4, 'mock-embed', 384, $5) RETURNING id`,
    [workspaceId, `pk_live_${Math.random().toString(36).slice(2, 10)}`, chat, embed, cap],
  );
  return { workspaceId, botId: bot[0]?.id ?? '' };
}

async function putUsage(seeded: Seeded, day: Date, costUsd: string): Promise<void> {
  await ds.query(
    `INSERT INTO usage_daily (workspace_id, bot_id, day, cost_usd) VALUES ($1, $2, $3, $4)`,
    [seeded.workspaceId, seeded.botId, utcDay(day), costUsd],
  );
}

/** One playground finalize: a $0.000450 chat call, no message or conversation. */
async function answer(seeded: Seeded): Promise<void> {
  await persistence.finalize({
    workspaceId: seeded.workspaceId,
    botId: seeded.botId,
    conversationId: null,
    aiMessageId: null,
    triggerMessageId: null,
    origin: 'playground',
    content: 'answer',
    status: 'complete',
    citations: [],
    decision: 'answered',
    decisionReason: null,
    retrieval: [],
    topScore: null,
    promptVersionId: null,
    platformPromptVersion: '2026.11.1',
    chat: { provider: 'openai', model: 'gpt-4o-mini', inputTokens: 1000, outputTokens: 500 },
    embedding: null,
    requestSnapshot: null,
    latencyMs: 1,
    ttftMs: 1,
    error: null,
    escalation: null,
  });
}

beforeAll(async () => {
  ds = await getTestDataSource();
});

beforeEach(async () => {
  await resetDatabase(ds);
  clock.set(new Date('2026-02-01T12:00:00Z'));
  usage = new UsageRepository(ds);
  bots = new BotsRepository(ds);
  enqueued = [];
  const jobs = {
    enqueue: (
      def: { name: string },
      payload: Record<string, unknown>,
      opts: { singletonKey?: string },
    ) => {
      enqueued.push({ payload: { ...payload, job: def.name }, key: opts.singletonKey });
      return Promise.resolve('job');
    },
  };
  persistence = new ChatPersistence(
    ds,
    new ConversationsRepository(ds),
    new MessagesRepository(ds),
    new TracesRepository(ds),
    usage,
    new PricingService(new ModelPricesRepository(ds)),
    bots,
    jobs as unknown as JobsService,
    new EventEmitter2(),
    clock,
  );
});

describe('spend alert enqueueing', () => {
  it('enqueues the 80% alert once, even across ten more answers', async () => {
    const seeded = await seedBot('10.00');
    await putUsage(seeded, clock.now(), '7.999900');

    await answer(seeded);
    for (let i = 0; i < 10; i += 1) await answer(seeded);

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]?.payload).toMatchObject({
      threshold: 80,
      month: '2026-02',
      botId: seeded.botId,
    });
    expect(enqueued[0]?.key).toBe(`${seeded.botId}:2026-02:80`);
  });

  it('enqueues the 100% alert on crossing the cap', async () => {
    const seeded = await seedBot('10.00');
    await putUsage(seeded, clock.now(), '9.999900');

    await answer(seeded);

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]?.payload).toMatchObject({ threshold: 100 });
  });

  it('allows new alerts in a new month', async () => {
    const seeded = await seedBot('10.00');
    await putUsage(seeded, clock.now(), '7.999900');
    await answer(seeded);

    clock.set(new Date('2026-03-01T00:00:00Z'));
    await putUsage(seeded, clock.now(), '7.999900');
    await answer(seeded);

    expect(enqueued.map((entry) => entry.payload['month'])).toEqual(['2026-02', '2026-03']);
  });

  it('does nothing when the bot has no cap', async () => {
    const seeded = await seedBot(null);
    await putUsage(seeded, clock.now(), '999.000000');

    await answer(seeded);

    expect(enqueued).toEqual([]);
  });
});

describe('SpendAlertsProcessor', () => {
  interface TraceSeed {
    contactEmail: string | null;
    costUsd: string;
  }

  async function seedTraces(seeded: Seeded, rows: TraceSeed[]): Promise<void> {
    for (const row of rows) {
      const contact = await ds.query<{ id: string }[]>(
        `INSERT INTO contacts (workspace_id, email) VALUES ($1, $2) RETURNING id`,
        [seeded.workspaceId, row.contactEmail],
      );
      const contactId = contact[0]?.id ?? '';
      const conversation = await ds.query<{ id: string }[]>(
        `INSERT INTO conversations (workspace_id, bot_id, contact_id) VALUES ($1, $2, $3)
         RETURNING id`,
        [seeded.workspaceId, seeded.botId, contactId],
      );
      await ds.query(
        `INSERT INTO generation_traces
           (workspace_id, bot_id, conversation_id, origin, decision, cost_usd, created_at)
         VALUES ($1, $2, $3, 'widget', 'answered', $4, '2026-02-10T12:00:00Z')`,
        [seeded.workspaceId, seeded.botId, conversation[0]?.id, row.costUsd],
      );
    }
  }

  it('emails the configured addresses with top contacts sorted by cost', async () => {
    const seeded = await seedBot('10.00');
    await ds.query(`UPDATE workspaces SET settings = $2 WHERE id = $1`, [
      seeded.workspaceId,
      JSON.stringify({ notificationEmails: ['ops@example.com'] }),
    ]);
    await seedTraces(seeded, [
      { contactEmail: 'small@example.com', costUsd: '0.100000' },
      { contactEmail: 'big@example.com', costUsd: '2.000000' },
      { contactEmail: null, costUsd: '0.500000' },
    ]);
    await putUsage(seeded, new Date('2026-02-10T00:00:00Z'), '2.600000');

    const email = { send: vi.fn(() => Promise.resolve()) };
    const processor = new SpendAlertsProcessor(bots, usage, email as unknown as EmailService);
    await processor.handle({
      workspaceId: seeded.workspaceId,
      botId: seeded.botId,
      threshold: 80,
      month: '2026-02',
    });

    expect(email.send).toHaveBeenCalledTimes(1);
    const [template, to, data] = email.send.mock.calls[0] as unknown as [
      string,
      string,
      {
        topContacts: { contact: string; costUsd: string; conversations: number }[];
        mtdUsd: string;
      },
    ];
    expect(template).toBe('spend_alert');
    expect(to).toBe('ops@example.com');
    expect(data.mtdUsd).toBe('2.600000');
    const contacts = data.topContacts.map((row) => row.contact);
    expect(contacts[0]).toBe('big@example.com');
    // The anonymous contact falls back to its id: no email, and IPs are never stored.
    expect(contacts[1]).toMatch(/^[0-9a-f-]{36}$/);
    expect(contacts[2]).toBe('small@example.com');
    expect(data.topContacts[0]).toMatchObject({ costUsd: '2.000000', conversations: 1 });
  });

  it('falls back to owners and admins when no addresses are configured', async () => {
    const real = await seedBot('10.00');
    const { user: owner } = await createUser({ ds }, { email: 'owner@example.com' });
    const { user: agent } = await createUser({ ds }, { email: 'agent@example.com' });
    await ds.query(
      `INSERT INTO memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'owner'), ($1, $3, 'agent')`,
      [real.workspaceId, owner.id, agent.id],
    );
    const email = { send: vi.fn(() => Promise.resolve()) };
    const processor = new SpendAlertsProcessor(bots, usage, email as unknown as EmailService);
    await processor.handle({
      workspaceId: real.workspaceId,
      botId: real.botId,
      threshold: 100,
      month: '2026-02',
    });

    expect(email.send).toHaveBeenCalledWith(
      'spend_alert',
      'owner@example.com',
      expect.objectContaining({ threshold: 100 }),
    );
  });
});
