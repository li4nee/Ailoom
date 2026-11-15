// SPDX-License-Identifier: AGPL-3.0-only
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from 'vitest';

import { getTestDataSource, resetDatabase } from '../../../test/helpers/db';
import { createUser, createWorkspace } from '../../../test/helpers/factories';
import { WorkerAppModule } from '../../app/worker-app.module';
import { loadConfig } from '../../common/config';
import { asWorkspaceId } from '../../db/ids';
import { EmailService } from '../email';
import { MemoryMailer } from '../email/memory.mailer';
import { AgentReplyEmailProcessor } from './agent-reply-email.processor';
import { HandoffNotifierListener } from './handoff-notifier.listener';
import { VisitorPresence } from './visitor-presence';

const BASE_ENV = {
  NODE_ENV: 'test',
  PUBLIC_URL: 'https://support.example.com',
  AUTH_SECRET: 'a'.repeat(32),
  WIDGET_SECRET: 'w'.repeat(32),
  ENCRYPTION_KEYS: `v1:${'ab'.repeat(32)}`,
  LOG_LEVEL: 'error',
  EMAIL_TRANSPORT: 'resend',
  RESEND_API_KEY: 're_test',
  EMAIL_FROM: 'Support <support@example.com>',
};

let ds: DataSource;
let worker: INestApplicationContext;
let mailer: MemoryMailer;
let listener: HandoffNotifierListener;
let processor: AgentReplyEmailProcessor;
let presence: VisitorPresence;
let email: EmailService;

interface Seeded {
  workspaceId: string;
  botId: string;
  contactId: string;
  conversationId: string;
}

async function seed(t: DataSource, contactEmail: string | null): Promise<Seeded> {
  const account = await createUser({ ds: t }, { email: 'owner@example.com', name: 'Olivia Owner' });
  const workspace = await createWorkspace({ ds: t }, account.user, 'Acme');
  const credentials = await t.query<{ id: string }[]>(
    `INSERT INTO provider_credentials (workspace_id, provider, label)
     VALUES ($1, 'mock', 'Chat'), ($1, 'mock', 'Embed') RETURNING id`,
    [workspace.id],
  );
  const [chat, embed] = credentials.map((row) => row.id);
  const bot = await t.query<{ id: string }[]>(
    `INSERT INTO bots (workspace_id, name, public_key, chat_credential_id, chat_model,
                       embedding_credential_id, embedding_model, embedding_dim,
                       no_answer_behavior)
     VALUES ($1, 'Help', $2, $3, 'mock-chat', $4, 'mock-embed', 384, 'offer_handoff')
     RETURNING id`,
    [workspace.id, `pk_notify_${Math.random().toString(36).slice(2, 10)}`, chat, embed],
  );
  const botId = bot[0]?.id ?? '';
  const contact = await t.query<{ id: string }[]>(
    `INSERT INTO contacts (workspace_id, email, name) VALUES ($1, $2, 'Bea Buyer') RETURNING id`,
    [workspace.id, contactEmail],
  );
  const contactId = contact[0]?.id ?? '';
  const conversation = await t.query<{ id: string }[]>(
    `INSERT INTO conversations
       (workspace_id, bot_id, contact_id, status, handoff_reason, handoff_requested_at)
     VALUES ($1, $2, $3, 'needs_human', 'visitor_request', now()) RETURNING id`,
    [workspace.id, botId, contactId],
  );
  const conversationId = conversation[0]?.id ?? '';
  await t.query(
    `INSERT INTO messages (workspace_id, conversation_id, role, content)
     VALUES ($1, $2, 'visitor', 'I need a person for my refund.')`,
    [workspace.id, conversationId],
  );
  return { workspaceId: workspace.id, botId, contactId, conversationId };
}

beforeAll(async () => {
  ds = await getTestDataSource();
  const config = loadConfig({ ...BASE_ENV, DATABASE_URL: inject('databaseUrl') });
  mailer = new MemoryMailer();
  worker = await NestFactory.createApplicationContext(
    WorkerAppModule.register(config, {
      dataSource: ds,
      mailer,
      jobs: { pollingIntervalSeconds: 0.5 },
    }),
    { logger: false },
  );
  listener = worker.get(HandoffNotifierListener);
  processor = worker.get(AgentReplyEmailProcessor);
  presence = worker.get(VisitorPresence);
  email = worker.get(EmailService);
});

afterAll(async () => {
  await worker.close();
});

beforeEach(async () => {
  await resetDatabase(ds);
  mailer.sent.length = 0;
});

describe('handoff notifications and agent reply emails', () => {
  it('emails the notification recipients with the conversation link and context', async () => {
    const seeded = await seed(ds, 'visitor@example.com');
    await ds.query(
      `UPDATE workspaces SET settings = '{"notificationEmails":["inbox@example.com"]}'::jsonb
        WHERE id = $1`,
      [seeded.workspaceId],
    );

    await listener.handle({
      workspaceId: asWorkspaceId(seeded.workspaceId),
      botId: seeded.botId,
      conversationId: seeded.conversationId,
    });

    await vi.waitFor(() => {
      expect(mailer.sent).toHaveLength(1);
    });
    const sent = mailer.sent[0];
    expect(sent?.to).toBe('inbox@example.com');
    expect(sent?.subject).toContain('Help');
    expect(sent?.text).toContain('visitor_request');
    expect(sent?.text).toContain('visitor@example.com');
    expect(sent?.text).toContain('I need a person for my refund.');
    expect(sent?.text).toContain(
      `https://support.example.com/w/${seeded.workspaceId}/conversations/${seeded.conversationId}`,
    );
  });

  it('does nothing when email is not configured', async () => {
    const seeded = await seed(ds, 'visitor@example.com');
    const disabledMailer = new MemoryMailer();
    const disabledConfig = loadConfig({
      ...BASE_ENV,
      EMAIL_TRANSPORT: 'none',
      RESEND_API_KEY: undefined,
      EMAIL_FROM: undefined,
      DATABASE_URL: inject('databaseUrl'),
    });
    const disabled = await NestFactory.createApplicationContext(
      WorkerAppModule.register(disabledConfig, {
        dataSource: ds,
        mailer: disabledMailer,
        jobs: { pollingIntervalSeconds: 0.5 },
      }),
      { logger: false },
    );
    try {
      await disabled.get(HandoffNotifierListener).handle({
        workspaceId: asWorkspaceId(seeded.workspaceId),
        botId: seeded.botId,
        conversationId: seeded.conversationId,
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(disabledMailer.sent).toHaveLength(0);
    } finally {
      await disabled.close();
    }
  });

  it('sends one email containing every reply while the visitor is away', async () => {
    const seeded = await seed(ds, 'visitor@example.com');
    await ds.query(
      `INSERT INTO messages (workspace_id, conversation_id, role, author_user_id, content,
                             created_at)
       VALUES
         ($1, $2, 'agent', NULL, 'First reply', now() - interval '3 minutes'),
         ($1, $2, 'agent', NULL, 'Second reply', now() - interval '2 minutes'),
         ($1, $2, 'agent', NULL, 'Third reply', now() - interval '1 minute')`,
      [seeded.workspaceId, seeded.conversationId],
    );

    await processor.handle({
      workspaceId: seeded.workspaceId,
      conversationId: seeded.conversationId,
    });

    await vi.waitFor(() => {
      expect(mailer.sent).toHaveLength(1);
    });
    const sent = mailer.sent[0];
    expect(sent?.subject).toContain('Help');
    expect(sent?.text).toContain('First reply');
    expect(sent?.text).toContain('Second reply');
    expect(sent?.text).toContain('Third reply');
    expect(sent?.text.match(/Support agent wrote:/g)).toHaveLength(3);
  });

  it('sends no email while the visitor is connected, and does not repeat sent replies', async () => {
    const seeded = await seed(ds, 'visitor@example.com');
    await ds.query(
      `INSERT INTO messages (workspace_id, conversation_id, role, content)
       VALUES ($1, $2, 'agent', 'I can help.')`,
      [seeded.workspaceId, seeded.conversationId],
    );
    const disconnect = presence.connect(seeded.conversationId);

    await processor.handle({
      workspaceId: seeded.workspaceId,
      conversationId: seeded.conversationId,
    });
    expect(mailer.sent).toHaveLength(0);

    disconnect();
    await processor.handle({
      workspaceId: seeded.workspaceId,
      conversationId: seeded.conversationId,
    });
    await vi.waitFor(() => {
      expect(mailer.sent).toHaveLength(1);
    });

    // A second run finds nothing newer than the high-water mark.
    await processor.handle({
      workspaceId: seeded.workspaceId,
      conversationId: seeded.conversationId,
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(mailer.sent).toHaveLength(1);
  });

  it('sends no email for a contact without an address', async () => {
    const seeded = await seed(ds, null);

    await processor.handle({
      workspaceId: seeded.workspaceId,
      conversationId: seeded.conversationId,
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(mailer.sent).toHaveLength(0);
    expect(email.isEnabled()).toBe(true);
  });
});
