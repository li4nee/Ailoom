// SPDX-License-Identifier: AGPL-3.0-only
import { Test } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { getTestDataSource, resetDatabase } from '../../../test/helpers/db';
import { ConfigModule, loadConfig } from '../../common/config';
import { RequestContextService } from '../../common/context/request-context';
import { DatabaseModule } from '../../db';
import { AuditLogEntity } from './audit-log.entity';
import { AuditRepository } from './audit.repository';
import { AuditService } from './audit.service';

let ds: DataSource;
let audit: AuditService;
let cls: ClsService;
let module: Awaited<ReturnType<typeof buildModule>>;

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
  return Test.createTestingModule({
    imports: [
      ConfigModule.forRoot(config()),
      DatabaseModule.forRoot(config(), dataSource),
      ClsModule.forRoot({ global: true }),
    ],
    providers: [AuditRepository, AuditService, RequestContextService],
  }).compile();
}

async function rows(): Promise<AuditLogEntity[]> {
  return ds.getRepository(AuditLogEntity).find({ order: { id: 'DESC' } });
}

const BASE = {
  workspaceId: null,
  actorUserId: null,
  action: 'workspace.updated' as const,
  targetType: 'workspace',
  targetId: null,
};

beforeAll(async () => {
  ds = await getTestDataSource();
  module = await buildModule(ds);
  await module.init();
  audit = module.get(AuditService);
  cls = module.get(ClsService);
});

afterAll(async () => {
  await module.close();
});

beforeEach(async () => {
  await resetDatabase(ds);
});

describe('AuditService', () => {
  it('scrubs secret-looking metadata keys at any depth', async () => {
    await audit.record({
      ...BASE,
      metadata: {
        label: 'x',
        apiKey: 'sk',
        nested: { password: 'p', ok: 1 },
        list: [{ token: 't', keep: 2 }],
        authorization: 'Bearer abc',
      },
    });

    const [row] = await rows();
    expect(row?.metadata).toEqual({ label: 'x', nested: { ok: 1 }, list: [{ keep: 2 }] });
  });

  it('writes inside the caller transaction', async () => {
    await expect(
      ds.transaction(async (manager) => {
        await audit.record(BASE, manager);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');

    expect(await rows()).toHaveLength(0);
  });

  it('takes the ip from the request context when not given', async () => {
    await cls.run(async () => {
      cls.set('ip', '203.0.113.9');
      await audit.record(BASE);
    });

    const [row] = await rows();
    expect(row?.ip).toBe('203.0.113.9');
  });

  it('prefers an explicit ip', async () => {
    await cls.run(async () => {
      cls.set('ip', '203.0.113.9');
      await audit.record({ ...BASE, ip: '198.51.100.7' });
    });

    const [row] = await rows();
    expect(row?.ip).toBe('198.51.100.7');
  });
});
