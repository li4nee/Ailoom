// SPDX-License-Identifier: AGPL-3.0-only
import type { DataSource } from 'typeorm';
import { PostgresQueryRunner } from 'typeorm/driver/postgres/PostgresQueryRunner.js';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDataSource, resetDatabase } from '../../../test/helpers/db';
import { createUser } from '../../../test/helpers/factories';
import { asUserId, asWorkspaceId, type UserId, type WorkspaceId } from '../../db/ids';
import { InboxQuery } from './inbox.repository';

let ds: DataSource;
let inbox: InboxQuery;

beforeAll(async () => {
  ds = await getTestDataSource();
  inbox = new InboxQuery(ds);
});

beforeEach(async () => {
  await resetDatabase(ds);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const rows = await ds.query<T[]>(sql, params);
  const row = rows[0];
  if (row === undefined) throw new Error(`no row from ${sql}`);
  return row;
}

/** One workspace with `count` handoff conversations, each from its own contact. */
async function seed(
  count: number,
): Promise<{ workspaceId: WorkspaceId; userId: UserId; contactId: string }> {
  const { user } = await createUser({ ds }, { email: 'inbox-query@example.com' });
  const { id: workspaceId } = await one<{ id: string }>(
    `INSERT INTO workspaces (name, slug) VALUES ('Inbox', 'inbox') RETURNING id`,
  );
  const { id: credentialId } = await one<{ id: string }>(
    `INSERT INTO provider_credentials (workspace_id, provider, label)
     VALUES ($1, 'local', 'Built-in') RETURNING id`,
    [workspaceId],
  );
  const { id: botId } = await one<{ id: string }>(
    `INSERT INTO bots (workspace_id, name, public_key, chat_credential_id, chat_model,
                       embedding_credential_id, embedding_model, embedding_dim, no_answer_behavior)
     VALUES ($1, 'Support', 'pk_live_inbox', $2, 'mock-chat', $2, 'bge-small-en-v1.5', 384,
             'offer_handoff')
     RETURNING id`,
    [workspaceId, credentialId],
  );
  const { id: contactId } = await one<{ id: string }>(
    `INSERT INTO contacts (workspace_id) VALUES ($1) RETURNING id`,
    [workspaceId],
  );
  await ds.query(
    `INSERT INTO conversations
       (workspace_id, bot_id, contact_id, channel, status, handoff_requested_at, last_message_at)
     SELECT $1, $2, $3, 'web', 'needs_human', now(), now() - (n * interval '1 minute')
       FROM generate_series(1, $4::int) AS n`,
    [workspaceId, botId, contactId, count],
  );
  return { workspaceId: asWorkspaceId(workspaceId), userId: asUserId(user.id), contactId };
}

function inboxStatements(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls
    .map((call) => call[0])
    .filter(
      (sql): sql is string => typeof sql === 'string' && sql.includes('"last_message_preview"'),
    );
}

describe('InboxQuery', () => {
  it('limits the inbox page in SQL instead of loading every matching conversation', async () => {
    const { workspaceId, userId } = await seed(30);
    const spy = vi.spyOn(PostgresQueryRunner.prototype, 'query');

    const page = await inbox.search(workspaceId, { limit: 10, status: 'needs_human' }, userId);

    expect(page.data).toHaveLength(10);
    expect(page.nextCursor).not.toBeNull();
    const statements = inboxStatements(spy);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/\bLIMIT 11\b/u);
  });

  it('walks every page once without duplicates', async () => {
    const { workspaceId, userId } = await seed(25);
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await inbox.search(
        workspaceId,
        { limit: 10, status: 'needs_human', ...(cursor === undefined ? {} : { cursor }) },
        userId,
      );
      seen.push(...page.data.map((row) => row.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);

    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);
  });

  it('limits contact history in SQL', async () => {
    const { workspaceId, contactId } = await seed(15);
    const spy = vi.spyOn(PostgresQueryRunner.prototype, 'query');

    const history = await inbox.contactHistory(workspaceId, contactId, crypto.randomUUID());

    expect(history).toHaveLength(10);
    const statements = inboxStatements(spy);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/\bLIMIT 10\b/u);
  });
});
