// SPDX-License-Identifier: AGPL-3.0-only
import { Test } from '@nestjs/testing';
import { ClsModule } from 'nestjs-cls';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from 'vitest';

import { getTestDataSource, resetDatabase } from '../../../test/helpers/db';
import { createUser, createWorkspace } from '../../../test/helpers/factories';
import { ConfigModule, loadConfig } from '../../common/config';
import { DatabaseModule } from '../../db';
import {
  asCredentialId,
  asUserId,
  asWorkspaceId,
  type UserId,
  type WorkspaceId,
} from '../../db/ids';
import { AuditModule, AuditService } from '../audit';
import { toCredentialDto } from './credentials.mapper';
import { CredentialsModule } from './credentials.module';
import { CredentialsService } from './credentials.service';

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

async function buildModule(dataSource: DataSource) {
  const cfg = config();
  return Test.createTestingModule({
    imports: [
      ConfigModule.forRoot(cfg),
      DatabaseModule.forRoot(cfg, dataSource),
      ClsModule.forRoot({ global: true }),
      AuditModule,
      CredentialsModule,
    ],
  }).compile();
}

let ds: DataSource;
let module_: Awaited<ReturnType<typeof buildModule>>;
let svc: CredentialsService;
let audit: AuditService;

let ws: WorkspaceId;
let otherWs: WorkspaceId;
let actor: UserId;

beforeAll(async () => {
  ds = await getTestDataSource();
  module_ = await buildModule(ds);
  await module_.init();
  svc = module_.get(CredentialsService);
  audit = module_.get(AuditService);
});

afterAll(async () => {
  await module_.close();
});

beforeEach(async () => {
  await resetDatabase(ds);
  const { user: owner } = await createUser({ ds }, { email: 'owner@example.com' });
  const { user: stranger } = await createUser({ ds }, { email: 'stranger@example.com' });
  ws = asWorkspaceId((await createWorkspace({ ds }, owner, 'Acme')).id);
  otherWs = asWorkspaceId((await createWorkspace({ ds }, stranger, 'Globex')).id);
  actor = asUserId(owner.id);
});

/** Inserts a bot row directly; the bots API arrives in Task 2.8. */
async function insertBot(input: {
  workspaceId: WorkspaceId;
  chatCredentialId: string;
  embeddingCredentialId: string;
  deleted?: boolean;
}): Promise<string> {
  const rows = await ds.query<{ id: string }[]>(
    `INSERT INTO bots (workspace_id, name, public_key, chat_credential_id, chat_model,
                       embedding_credential_id, embedding_model, embedding_dim, no_answer_behavior,
                       deleted_at)
     VALUES ($1, 'Help', $2, $3, 'mock-chat', $4, 'bge-small-en-v1.5', 384, 'offer_handoff',
             CASE WHEN $5 THEN now() ELSE NULL END)
     RETURNING id`,
    [
      input.workspaceId,
      `pk_live_${Math.random().toString(36).slice(2)}`,
      input.chatCredentialId,
      input.embeddingCredentialId,
      input.deleted === true,
    ],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('insertBot: insert returned no id');
  return id;
}

describe('CredentialsService', () => {
  it('seals the trimmed key and stores last4', async () => {
    const c = await svc.create(
      ws,
      { provider: 'openai', label: 'Prod', apiKey: '  sk-abc1234\n' },
      actor,
    );

    expect(c.secretLast4).toBe('1234');
    const raw = await ds.query<Record<string, unknown>[]>(
      'SELECT * FROM provider_credentials WHERE id=$1',
      [c.id],
    );
    expect(JSON.stringify(raw)).not.toContain('sk-abc1234');
    expect((await svc.resolveForUse(ws, asCredentialId(c.id))).apiKey).toBe('sk-abc1234');
  });

  it('never exposes secret fields in the dto', async () => {
    const c = await svc.create(ws, { provider: 'openai', label: 'Prod', apiKey: 'sk-x' }, actor);
    const dto = toCredentialDto(await svc.get(ws, c.id));
    expect(Object.keys(dto)).not.toEqual(
      expect.arrayContaining(['secretCiphertext', 'secretIv', 'secretTag', 'apiKey']),
    );
  });

  it('resolves a credential only inside its workspace', async () => {
    const c = await svc.create(ws, { provider: 'openai', label: 'Prod', apiKey: 'sk-x' }, actor);
    await expect(svc.resolveForUse(otherWs, asCredentialId(c.id))).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(svc.get(otherWs, c.id)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('stores no secret for ollama', async () => {
    const c = await svc.create(
      ws,
      { provider: 'ollama', label: 'Local', baseUrl: 'http://ollama:11434' },
      actor,
    );
    expect(c.secretLast4).toBeNull();
    expect(c.baseUrl).toBe('http://ollama:11434');
    expect((await svc.resolveForUse(ws, asCredentialId(c.id))).apiKey).toBeNull();
  });

  it('re-seals an updated key with the active key version and bumps updatedAt', async () => {
    const c = await svc.create(ws, { provider: 'openai', label: 'Prod', apiKey: 'sk-old' }, actor);
    const updated = await svc.update(ws, c.id, { apiKey: 'sk-new-9876' }, actor);

    expect(updated.secretLast4).toBe('9876');
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(c.updatedAt.getTime());
    const row = await ds.query<{ key_version: number }[]>(
      'SELECT key_version FROM provider_credentials WHERE id=$1',
      [c.id],
    );
    expect(row[0]?.key_version).toBe(1);
    expect((await svc.resolveForUse(ws, asCredentialId(c.id))).apiKey).toBe('sk-new-9876');
  });

  it('audits created, updated and deleted without the secret', async () => {
    const c = await svc.create(
      ws,
      { provider: 'openai', label: 'Prod', apiKey: 'sk-secret' },
      actor,
    );
    await svc.update(ws, c.id, { label: 'Renamed' }, actor);
    await svc.delete(ws, c.id, actor);

    const entries = await audit.list(ws, { limit: 10 });
    expect(entries.data.map((e) => e.action)).toEqual([
      'credential.deleted',
      'credential.updated',
      'credential.created',
    ]);
    expect(JSON.stringify(entries.data)).not.toContain('sk-secret');
  });

  it('refuses to delete a credential a live bot uses', async () => {
    const chat = await svc.create(ws, { provider: 'mock', label: 'Chat' }, actor);
    const embed = await svc.create(ws, { provider: 'mock', label: 'Embed' }, actor);
    await insertBot({
      workspaceId: ws,
      chatCredentialId: chat.id,
      embeddingCredentialId: embed.id,
    });

    await expect(svc.delete(ws, chat.id, actor)).rejects.toMatchObject({
      code: 'credential_in_use',
      status: 409,
    });
    await expect(svc.get(ws, chat.id)).resolves.toMatchObject({ id: chat.id });
  });

  it('deletes a credential only a soft-deleted bot used', async () => {
    const chat = await svc.create(ws, { provider: 'mock', label: 'Chat' }, actor);
    const embed = await svc.create(ws, { provider: 'mock', label: 'Embed' }, actor);
    const botId = await insertBot({
      workspaceId: ws,
      chatCredentialId: chat.id,
      embeddingCredentialId: embed.id,
      deleted: true,
    });

    await svc.delete(ws, chat.id, actor);

    await expect(svc.get(ws, chat.id)).rejects.toMatchObject({ code: 'not_found' });
    const bots = await ds.query<{ id: string }[]>('SELECT id FROM bots WHERE id=$1', [botId]);
    expect(bots).toEqual([]);
  });

  it('marks usage and the last normalized error', async () => {
    const c = await svc.create(ws, { provider: 'openai', label: 'Prod', apiKey: 'sk-x' }, actor);
    const used = await svc.markUsed(ws, c.id);
    expect(used.lastUsedAt).toBeInstanceOf(Date);

    const failed = await svc.markError(ws, c.id, 'auth_failed');
    expect(failed.lastError).toBe('auth_failed');
    expect(failed.lastErrorAt).toBeInstanceOf(Date);
  });

  it('records usage without touching updatedAt, and a success clears the last error', async () => {
    const c = await svc.create(ws, { provider: 'openai', label: 'Prod', apiKey: 'sk-x' }, actor);

    await svc.markError(ws, c.id, 'auth_failed');
    const recovered = await svc.markUsed(ws, c.id);

    expect(recovered.updatedAt).toEqual(c.updatedAt);
    expect(recovered.lastError).toBeNull();
    expect(recovered.lastErrorAt).toBeNull();
  });

  it('keeps soft-deleted bots when the credential delete rolls back', async () => {
    const chat = await svc.create(ws, { provider: 'mock', label: 'Chat' }, actor);
    const embed = await svc.create(ws, { provider: 'mock', label: 'Embed' }, actor);
    const botId = await insertBot({
      workspaceId: ws,
      chatCredentialId: chat.id,
      embeddingCredentialId: embed.id,
      deleted: true,
    });
    // Make the audit write, the last step of the transaction, fail.
    const record = vi.spyOn(audit, 'record').mockRejectedValueOnce(new Error('audit down'));

    await expect(svc.delete(ws, chat.id, actor)).rejects.toThrow('audit down');
    record.mockRestore();

    const bots = await ds.query<{ id: string }[]>('SELECT id FROM bots WHERE id=$1', [botId]);
    expect(bots).toEqual([{ id: botId }]);
    await expect(svc.get(ws, chat.id)).resolves.toMatchObject({ id: chat.id });
  });

  it('rejects creating a built-in local credential through the api', async () => {
    await expect(
      svc.create(ws, { provider: 'local', label: 'Local' } as never, actor),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });
});
