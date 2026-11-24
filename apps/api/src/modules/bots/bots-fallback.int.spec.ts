// SPDX-License-Identifier: AGPL-3.0-only
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { getTestDataSource, resetDatabase } from '../../../test/helpers/db';
import { createUser } from '../../../test/helpers/factories';
import { WorkerAppModule } from '../../app/worker-app.module';
import { loadConfig } from '../../common/config';
import { asBotId, asUserId, asWorkspaceId } from '../../db/ids';
import { CredentialsService } from '../credentials';
import { toBotDto } from './bots.mapper';
import { BotsService } from './bots.service';

let ds: DataSource;
let worker: INestApplicationContext;
let bots: BotsService;
let credentials: CredentialsService;
let workspaceId: string;
let actorId: string;
let botId: string;
let primaryId: string;
let embeddingId: string;
let fallbackId: string;

beforeAll(async () => {
  ds = await getTestDataSource();
  const config = loadConfig({
    NODE_ENV: 'test',
    PUBLIC_URL: 'http://localhost:3000',
    DATABASE_URL: inject('databaseUrl'),
    AUTH_SECRET: 'a'.repeat(32),
    WIDGET_SECRET: 'w'.repeat(32),
    ENCRYPTION_KEYS: `v1:${'ab'.repeat(32)}`,
    LOG_LEVEL: 'error',
  });
  worker = await NestFactory.createApplicationContext(
    WorkerAppModule.register(config, { dataSource: ds }),
    { logger: false },
  );
  bots = worker.get(BotsService);
  credentials = worker.get(CredentialsService);
});

afterAll(async () => {
  await worker.close();
});

beforeEach(async () => {
  await resetDatabase(ds);
  const { user } = await createUser(
    { ds },
    { email: `fallback-${Math.random().toString(36).slice(2, 8)}@example.com` },
  );
  actorId = user.id;
  const slug = `fallback-${Math.random().toString(36).slice(2, 8)}`;
  workspaceId =
    (
      await ds.query<{ id: string }[]>(
        `INSERT INTO workspaces (name, slug) VALUES ('Fallback', $1) RETURNING id`,
        [slug],
      )
    )[0]?.id ?? '';
  const rows = await ds.query<{ id: string }[]>(
    `INSERT INTO provider_credentials (workspace_id, provider, label)
     VALUES ($1, 'mock', 'chat'), ($1, 'mock', 'embed'), ($1, 'mock', 'fallback') RETURNING id`,
    [workspaceId],
  );
  primaryId = rows[0]!.id;
  embeddingId = rows[1]!.id;
  fallbackId = rows[2]!.id;
  botId =
    (
      await ds.query<{ id: string }[]>(
        `INSERT INTO bots (workspace_id, name, public_key, chat_credential_id, chat_model,
                         embedding_credential_id, embedding_model, embedding_dim, appearance)
       VALUES ($1, 'Help', $2, $3, 'mock-chat', $4, 'mock-embed', 384,
               '{"displayName":"Help","themeColor":"#112233","position":"right",
                 "welcomeMessage":"Welcome","avatarUrl":null,"privacyUrl":null}'::jsonb)
       RETURNING id`,
        [workspaceId, `pk_live_${slug}`, primaryId, embeddingId],
      )
    )[0]?.id ?? '';
});

describe('bot fallback model settings', () => {
  it('sets the fallback and returns both fields in the bot DTO', async () => {
    const updated = await bots.update(
      asWorkspaceId(workspaceId),
      asBotId(botId),
      { fallback: { chatCredentialId: fallbackId, chatModel: 'mock-backup' } },
      asUserId(actorId),
    );

    expect(toBotDto(updated)).toMatchObject({
      fallbackChatCredentialId: fallbackId,
      fallbackChatModel: 'mock-backup',
    });
  });

  it('clears the fallback with null', async () => {
    await bots.update(
      asWorkspaceId(workspaceId),
      asBotId(botId),
      { fallback: { chatCredentialId: fallbackId, chatModel: 'mock-backup' } },
      asUserId(actorId),
    );
    const updated = await bots.update(
      asWorkspaceId(workspaceId),
      asBotId(botId),
      { fallback: null },
      asUserId(actorId),
    );

    expect(toBotDto(updated)).toMatchObject({
      fallbackChatCredentialId: null,
      fallbackChatModel: null,
    });
  });

  it('rejects a credential from another workspace', async () => {
    const foreignWorkspaceId =
      (
        await ds.query<{ id: string }[]>(
          `INSERT INTO workspaces (name, slug) VALUES ('Foreign', $1) RETURNING id`,
          [`foreign-${Math.random().toString(36).slice(2, 8)}`],
        )
      )[0]?.id ?? '';
    const foreignCredentialId =
      (
        await ds.query<{ id: string }[]>(
          `INSERT INTO provider_credentials (workspace_id, provider, label)
         VALUES ($1, 'mock', 'foreign') RETURNING id`,
          [foreignWorkspaceId],
        )
      )[0]?.id ?? '';

    await expect(
      bots.update(
        asWorkspaceId(workspaceId),
        asBotId(botId),
        { fallback: { chatCredentialId: foreignCredentialId, chatModel: 'mock-backup' } },
        asUserId(actorId),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('rejects the same credential and model as the primary', async () => {
    await expect(
      bots.update(
        asWorkspaceId(workspaceId),
        asBotId(botId),
        { fallback: { chatCredentialId: primaryId, chatModel: 'mock-chat' } },
        asUserId(actorId),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('blocks deletion of a credential used by a live bot fallback', async () => {
    await bots.update(
      asWorkspaceId(workspaceId),
      asBotId(botId),
      { fallback: { chatCredentialId: fallbackId, chatModel: 'mock-backup' } },
      asUserId(actorId),
    );

    await expect(
      credentials.delete(asWorkspaceId(workspaceId), fallbackId, asUserId(actorId)),
    ).rejects.toMatchObject({ code: 'credential_in_use' });
  });
});
