// SPDX-License-Identifier: AGPL-3.0-only
import type { DataSource } from 'typeorm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getTestDataSource, resetDatabase } from '../../../test/helpers/db';
import { createUser, createWorkspace } from '../../../test/helpers/factories';
import { ConversationsRepository } from './conversations.repository';

let ds: DataSource;
let conversations: ConversationsRepository;

beforeAll(async () => {
  ds = await getTestDataSource();
  conversations = new ConversationsRepository(ds);
});

beforeEach(async () => {
  await resetDatabase(ds);
});

async function one(sql: string, params: unknown[]): Promise<string> {
  const rows = await ds.query<{ id: string }[]>(`${sql} RETURNING id`, params);
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`no row from ${sql}`);
  return id;
}

describe('conversation retention', () => {
  it('deletes only stale closed or AI-owned conversations', async () => {
    const { user } = await createUser({ ds }, { email: 'retention@example.com' });
    const workspace = await createWorkspace({ ds }, user, 'Retention');
    const credential = await one(
      `INSERT INTO provider_credentials (workspace_id, provider, label)
       VALUES ($1, 'mock', 'Retention fixture')`,
      [workspace.id],
    );
    const bot = await one(
      `INSERT INTO bots (workspace_id, name, public_key, chat_credential_id, chat_model,
                         embedding_credential_id, embedding_model, embedding_dim)
       VALUES ($1, 'Retention bot', 'pk_retention_fixture', $2, 'mock:model', $2, 'local:test', 384)`,
      [workspace.id, credential],
    );
    const contact = await one('INSERT INTO contacts (workspace_id) VALUES ($1)', [workspace.id]);
    const cutoff = new Date('2026-01-01T00:00:00.000Z');

    const seedConversation = async (
      status: 'ai' | 'closed' | 'human' | 'needs_human',
      lastMessageAt: Date,
    ): Promise<string> =>
      one(
        `INSERT INTO conversations (workspace_id, bot_id, contact_id, status, last_message_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [workspace.id, bot, contact, status, lastMessageAt],
      );

    const staleAi = await seedConversation('ai', new Date('2025-12-01T00:00:00.000Z'));
    const staleClosed = await seedConversation('closed', new Date('2025-11-01T00:00:00.000Z'));
    const recentAi = await seedConversation('ai', new Date('2026-01-02T00:00:00.000Z'));
    const staleHuman = await seedConversation('human', new Date('2025-10-01T00:00:00.000Z'));
    const staleNeedsHuman = await seedConversation(
      'needs_human',
      new Date('2025-09-01T00:00:00.000Z'),
    );

    await expect(conversations.deleteOlderThan(cutoff)).resolves.toBe(2);

    const remaining = await ds.query<{ id: string; status: string }[]>(
      'SELECT id, status FROM conversations WHERE workspace_id = $1 ORDER BY id',
      [workspace.id],
    );
    expect(remaining.map(({ status }) => status).sort()).toEqual(['ai', 'human', 'needs_human']);
    expect(remaining.map(({ id }) => id).sort()).toEqual(
      [recentAi, staleHuman, staleNeedsHuman].sort(),
    );
    expect(remaining.map(({ id }) => id)).not.toContain(staleAi);
    expect(remaining.map(({ id }) => id)).not.toContain(staleClosed);
  });
});
