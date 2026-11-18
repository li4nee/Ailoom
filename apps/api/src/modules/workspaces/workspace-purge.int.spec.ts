// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from 'node:crypto';

import type { PinoLogger } from 'nestjs-pino';
import type { DataSource } from 'typeorm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getTestDataSource, resetDatabase } from '../../../test/helpers/db';
import { createUser, createWorkspace } from '../../../test/helpers/factories';
import { newId } from '../../common/ids';
import { MemoryStorage } from '../../common/storage';
import { PURGE_ORDER } from './workspace-purge.job';
import { WorkspacePurgeProcessor } from './workspace-purge.processor';
import { WorkspacePurgeRepository } from './workspace-purge.repository';

const logger = {
  setContext: () => undefined,
  info: () => undefined,
  warn: () => undefined,
} as unknown as PinoLogger;

let ds: DataSource;
let purge: WorkspacePurgeRepository;

beforeAll(async () => {
  ds = await getTestDataSource();
  purge = new WorkspacePurgeRepository(ds);
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

/** One row in every tenant table that exists so far, all belonging to `workspaceId`. */
async function seed(workspaceId: string, userId: string): Promise<void> {
  const tag = randomBytes(4).toString('hex');
  const credential = await one(
    `INSERT INTO provider_credentials (workspace_id, provider, label) VALUES ($1, 'mock', 'Mock')`,
    [workspaceId],
  );
  const bot = await one(
    `INSERT INTO bots (workspace_id, name, public_key, chat_credential_id, chat_model,
                       embedding_credential_id, embedding_model, embedding_dim)
     VALUES ($1, 'Bot', $2, $3, 'm', $3, 'e', 384)`,
    [workspaceId, `pk_${tag}`, credential],
  );
  await ds.query(
    `INSERT INTO prompt_versions (workspace_id, bot_id, version, system_prompt)
     VALUES ($1, $2, 1, 'You help.')`,
    [workspaceId, bot],
  );
  const contact = await one('INSERT INTO contacts (workspace_id) VALUES ($1)', [workspaceId]);
  const conversation = await one(
    'INSERT INTO conversations (workspace_id, bot_id, contact_id) VALUES ($1, $2, $3)',
    [workspaceId, bot, contact],
  );
  await ds.query(
    `INSERT INTO conversation_internal_notes (workspace_id, conversation_id, author_user_id, body)
     VALUES ($1, $2, $3, 'private purge fixture')`,
    [workspaceId, conversation, userId],
  );
  await ds.query(
    `INSERT INTO messages (workspace_id, conversation_id, role, content)
     VALUES ($1, $2, 'visitor', 'hello')`,
    [workspaceId, conversation],
  );
  const integration = await one(
    `INSERT INTO integrations
       (workspace_id, provider, name, status, scopes, transcript_sharing)
     VALUES ($1, 'hubspot', $2, 'active', $3, false)`,
    [workspaceId, `CRM ${tag}`, ['contacts.read']],
  );
  await ds.query(
    `INSERT INTO integration_credentials
       (workspace_id, integration_id, ciphertext, iv, tag, key_version)
     VALUES ($1, $2, $3, $4, $5, 1)`,
    [workspaceId, integration, Buffer.from('ciphertext'), randomBytes(12), randomBytes(16)],
  );
  await ds.query(
    `INSERT INTO contact_external_links
       (workspace_id, integration_id, contact_id, object_type, external_object_id, idempotency_key)
     VALUES ($1, $2, $3, 'contact', $4, $5)`,
    [workspaceId, integration, contact, `external-${tag}`, `event-${tag}`],
  );
  const eventId = newId();
  await ds.query(
    `INSERT INTO integration_events
       (id, workspace_id, type, aggregate_id, idempotency_key, data, occurred_at)
     VALUES ($1, $2, 'contact.created', $3, $4, $5::jsonb, now())`,
    [eventId, workspaceId, contact, `outbox-${tag}`, JSON.stringify({ contactId: contact })],
  );
  const webhook = await one(
    `INSERT INTO webhooks
       (workspace_id, url, events, status, secret_ciphertext, secret_iv, secret_tag, key_version)
     VALUES ($1, 'https://hooks.example.test/purge', $2, 'active', $3, $4, $5, 1)`,
    [workspaceId, ['contact.created'], Buffer.from('secret'), randomBytes(12), randomBytes(16)],
  );
  await ds.query(
    `INSERT INTO webhook_deliveries
       (workspace_id, webhook_id, event_id, event_type, status, attempt_count)
     VALUES ($1, $2, $3, 'contact.created', 'failed', 1)`,
    [workspaceId, webhook, eventId],
  );
  await ds.query(
    `INSERT INTO api_keys
       (workspace_id, name, key_hash, key_prefix, scopes, created_by_user_id)
     VALUES ($1, $2, $3, 'ak_live_purge', $4, $5)`,
    [workspaceId, `Key ${tag}`, `hash-${tag}`, ['conversations:read'], userId],
  );
  await ds.query(
    `INSERT INTO knowledge_sources (workspace_id, bot_id, type, title) VALUES ($1, $2, 'text', 'T')`,
    [workspaceId, bot],
  );
  await ds.query(
    `INSERT INTO usage_daily (workspace_id, bot_id, day) VALUES ($1, $2, '2026-01-01')`,
    [workspaceId, bot],
  );
  await ds.query(
    `INSERT INTO model_prices (workspace_id, provider, model, input_per_mtok_usd, output_per_mtok_usd)
     VALUES ($1, 'mock', $2, 1, 1)`,
    [workspaceId, `m-${tag}`],
  );
  await ds.query(
    `INSERT INTO files (workspace_id, storage_key, filename, mime_type, size_bytes, sha256)
     VALUES ($1, $2, 'a.txt', 'text/plain', 1, 'x')`,
    [workspaceId, `key-${tag}`],
  );
  await ds.query(
    `INSERT INTO invitations (workspace_id, email, role, token_hash, invited_by, expires_at)
     VALUES ($1, $2, 'agent', $3, $4, now())`,
    [workspaceId, `i-${tag}@example.com`, `hash-${tag}`, userId],
  );
  await ds.query(`INSERT INTO audit_log (workspace_id, action) VALUES ($1, 'workspace.created')`, [
    workspaceId,
  ]);
}

async function count(table: string, workspaceId: string): Promise<number> {
  const rows = await ds.query<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM "${table}" WHERE workspace_id = $1`,
    [workspaceId],
  );
  return rows[0]?.n ?? 0;
}

describe('workspace purge', () => {
  it('PURGE_ORDER covers every tenant table', async () => {
    const rows = await ds.query<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.columns
        WHERE column_name = 'workspace_id' AND table_schema = 'public'`,
    );
    expect([...PURGE_ORDER].sort()).toEqual(rows.map((row) => row.table_name).sort());
  });

  it('removes every row with that workspace_id and nothing else', async () => {
    const { user: alice } = await createUser({ ds }, { email: 'alice@example.com' });
    const { user: bob } = await createUser({ ds }, { email: 'bob@example.com' });
    const wsA = await createWorkspace({ ds }, alice, 'A');
    const wsB = await createWorkspace({ ds }, bob, 'B');
    // Two rows per table with a batch size of 1: every table needs more than one statement.
    await seed(wsA.id, alice.id);
    await seed(wsA.id, alice.id);
    await seed(wsB.id, bob.id);
    await ds.query('UPDATE workspaces SET deleted_at = now() WHERE id = $1', [wsA.id]);

    await purge.purge(wsA.id, 1);

    for (const table of PURGE_ORDER) expect(await count(table, wsA.id)).toBe(0);
    const workspaces = await ds.query<{ id: string }[]>('SELECT id FROM workspaces');
    expect(workspaces.map((row) => row.id)).toEqual([wsB.id]);
    for (const table of ['memberships', 'bots', 'messages', 'audit_log']) {
      expect(await count(table, wsB.id)).toBeGreaterThan(0);
    }
  });

  it('never purges a workspace that is not marked deleted', async () => {
    const { user } = await createUser({ ds }, { email: 'alice@example.com' });
    const ws = await createWorkspace({ ds }, user, 'Live');

    await purge.purge(ws.id, 1000);

    expect(await count('memberships', ws.id)).toBe(1);
  });

  it('purge deletes blobs of the workspace before its rows', async () => {
    const { user: alice } = await createUser({ ds }, { email: 'alice@example.com' });
    const { user: bob } = await createUser({ ds }, { email: 'bob@example.com' });
    const wsA = await createWorkspace({ ds }, alice, 'A');
    const wsB = await createWorkspace({ ds }, bob, 'B');
    const storage = new MemoryStorage();
    const processor = new WorkspacePurgeProcessor(purge, storage, logger);

    const keyA = `${wsA.id}/blob-a`;
    const keyB = `${wsB.id}/blob-b`;
    await storage.put(keyA, Buffer.from('a'));
    await storage.put(keyB, Buffer.from('b'));
    for (const [workspaceId, key] of [
      [wsA.id, keyA],
      [wsB.id, keyB],
    ] as const) {
      await ds.query(
        `INSERT INTO files (workspace_id, storage_key, filename, mime_type, size_bytes, sha256)
         VALUES ($1, $2, 'a.txt', 'text/plain', 1, 'x')`,
        [workspaceId, key],
      );
    }
    await ds.query('UPDATE workspaces SET deleted_at = now() WHERE id = $1', [wsA.id]);

    await processor.handle({ workspaceId: wsA.id });

    expect(await storage.exists(keyA)).toBe(false);
    expect(await storage.exists(keyB)).toBe(true);
    expect(await count('files', wsB.id)).toBe(1);
  });

  it('never deletes the blobs of a workspace that is not marked deleted', async () => {
    const { user } = await createUser({ ds }, { email: 'alice@example.com' });
    const ws = await createWorkspace({ ds }, user, 'Live');
    const storage = new MemoryStorage();
    const processor = new WorkspacePurgeProcessor(purge, storage, logger);
    const key = `${ws.id}/blob`;
    await storage.put(key, Buffer.from('a'));
    await ds.query(
      `INSERT INTO files (workspace_id, storage_key, filename, mime_type, size_bytes, sha256)
       VALUES ($1, $2, 'a.txt', 'text/plain', 1, 'x')`,
      [ws.id, key],
    );

    await processor.handle({ workspaceId: ws.id });

    expect(await storage.exists(key)).toBe(true);
    expect(await count('files', ws.id)).toBe(1);
  });

  it('is idempotent', async () => {
    const { user } = await createUser({ ds }, { email: 'alice@example.com' });
    const ws = await createWorkspace({ ds }, user, 'A');
    await seed(ws.id, user.id);
    await ds.query('UPDATE workspaces SET deleted_at = now() WHERE id = $1', [ws.id]);

    await purge.purge(ws.id, 1000);
    await expect(purge.purge(ws.id, 1000)).resolves.toBeUndefined();
  });
});
