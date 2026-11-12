// SPDX-License-Identifier: AGPL-3.0-only
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { ClsModule } from 'nestjs-cls';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

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
import { BackfillLocalCredentials1794410000000 } from '../../db/migrations/1794410000000-backfill-local-credentials';
import { ProvidersModule, ProviderOps } from '../../providers';
import { AuditModule } from '../audit';
import { WORKSPACE_CREATED, type WorkspaceCreatedEvent } from '../workspaces';
import { CredentialsModule } from './credentials.module';
import { CredentialsRepository } from './credentials.repository';
import { CredentialsService } from './credentials.service';
import { LocalCredentialListener } from './local-credential.listener';

function config(overrides: Record<string, string> = {}) {
  return loadConfig({
    NODE_ENV: 'test',
    PUBLIC_URL: 'https://support.example.com',
    DATABASE_URL: inject('databaseUrl'),
    AUTH_SECRET: 'a'.repeat(32),
    WIDGET_SECRET: 'w'.repeat(32),
    ENCRYPTION_KEYS: `v1:${'ab'.repeat(32)}`,
    LOG_LEVEL: 'error',
    ...overrides,
  });
}

async function buildModule(dataSource: DataSource) {
  const cfg = config();
  return Test.createTestingModule({
    imports: [
      ConfigModule.forRoot(cfg),
      DatabaseModule.forRoot(cfg, dataSource),
      ClsModule.forRoot({ global: true }),
      EventEmitterModule.forRoot(),
      AuditModule,
      CredentialsModule,
      ProvidersModule.forRoot({ imports: [CredentialsModule], resolver: CredentialsService }),
    ],
  }).compile();
}

let ds: DataSource;
let module_: Awaited<ReturnType<typeof buildModule>>;
let svc: CredentialsService;
let ops: ProviderOps;
let events: EventEmitter2;
let repository: CredentialsRepository;

let ws: WorkspaceId;
let otherWs: WorkspaceId;
let actor: UserId;

beforeAll(async () => {
  ds = await getTestDataSource();
  module_ = await buildModule(ds);
  await module_.init();
  svc = module_.get(CredentialsService);
  ops = module_.get(ProviderOps);
  events = module_.get(EventEmitter2);
  repository = module_.get(CredentialsRepository);
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

/** What `WorkspacesService.create` emits once the workspace and its owner membership commit. */
async function emitCreated(workspaceId: WorkspaceId): Promise<void> {
  const event: WorkspaceCreatedEvent = { workspaceId, ownerId: actor };
  await events.emitAsync(WORKSPACE_CREATED, event);
}

describe('built-in local credential', () => {
  it('provisions exactly one local credential when a workspace is created', async () => {
    await emitCreated(ws);

    const mine = await svc.list(ws);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      provider: 'local',
      label: 'Built-in (local)',
      baseUrl: null,
      secretLast4: null,
      secretCiphertext: null,
      keyVersion: null,
    });
    // The other workspace's event never fired, so it has none.
    expect(await svc.list(otherWs)).toEqual([]);
  });

  it('does not provision anything when local embeddings are disabled', async () => {
    const disabled = new LocalCredentialListener(
      ds,
      repository,
      config({ LOCAL_EMBEDDINGS: 'false' }),
    );

    await disabled.handle({ workspaceId: ws, ownerId: actor });

    expect(await svc.list(ws)).toEqual([]);
  });

  it('refuses to update or delete the built-in credential', async () => {
    await emitCreated(ws);
    const local = await svc.getLocal(ws);
    if (local === null) throw new Error('expected a built-in local credential');

    await expect(svc.update(ws, local.id, { label: 'Renamed' }, actor)).rejects.toMatchObject({
      code: 'credential_builtin',
      status: 409,
    });
    await expect(svc.delete(ws, local.id, actor)).rejects.toMatchObject({
      code: 'credential_builtin',
      status: 409,
    });
    await expect(svc.get(ws, local.id)).resolves.toMatchObject({ id: local.id });
  });

  it('lists the single embedding model this instance ships', async () => {
    await emitCreated(ws);
    const local = await svc.getLocal(ws);
    if (local === null) throw new Error('expected a built-in local credential');

    await expect(ops.listModels(ws, asCredentialId(local.id))).resolves.toEqual([
      { id: 'bge-small-en-v1.5', kind: 'embedding' },
    ]);
  });

  it('backfills a local credential for workspaces that predate it, once', async () => {
    const runner = ds.createQueryRunner();
    await runner.connect();
    try {
      const migration = new BackfillLocalCredentials1794410000000();
      await migration.up(runner);
      await migration.up(runner);
    } finally {
      await runner.release();
    }

    const rows = await ds.query<{ id: string }[]>(
      `SELECT id FROM provider_credentials WHERE workspace_id = $1 AND provider = 'local'`,
      [ws],
    );
    expect(rows).toHaveLength(1);
    const all = await ds.query<{ count: number }[]>(
      `SELECT count(*)::int AS count FROM provider_credentials WHERE provider = 'local'`,
    );
    expect(all[0]?.count).toBe(2);
  });
});
