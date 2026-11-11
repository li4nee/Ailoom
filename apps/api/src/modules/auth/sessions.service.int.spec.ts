// SPDX-License-Identifier: AGPL-3.0-only
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { LoggerModule } from 'nestjs-pino';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from 'vitest';

import { getTestDataSource, resetDatabase } from '../../../test/helpers/db';
import { createUser } from '../../../test/helpers/factories';
import { WorkerAppModule } from '../../app/worker-app.module';
import { Clock, FixedClock } from '../../common/clock';
import { ConfigModule, loadConfig } from '../../common/config';
import { sha256Hex } from '../../common/crypto';
import { DatabaseModule } from '../../db';
import { asUserId } from '../../db/ids';
import { JobsModule } from '../../jobs';
import { EmailModule, MemoryMailer } from '../email';
import { AuthSessionEntity } from './entities/auth-session.entity';
import { SessionsRepository } from './sessions.repository';
import { SessionsService } from './sessions.service';
import { UsersRepository } from './users.repository';

const META = { ip: '203.0.113.5', userAgent: 'vitest' };
const NOW = new Date('2026-01-01T00:00:00Z');
const DAY_MS = 86_400_000;

let ds: DataSource;
let mailer: MemoryMailer;
let clock: FixedClock;
let worker: INestApplicationContext;
let sessions: SessionsService;
let module: INestApplicationContext;
let userId: string;

function config() {
  return loadConfig({
    NODE_ENV: 'test',
    PUBLIC_URL: 'https://support.example.com',
    DATABASE_URL: inject('databaseUrl'),
    AUTH_SECRET: 'a'.repeat(32),
    WIDGET_SECRET: 'w'.repeat(32),
    ENCRYPTION_KEYS: `v1:${'ab'.repeat(32)}`,
    LOG_LEVEL: 'error',
    EMAIL_TRANSPORT: 'smtp',
    SMTP_HOST: 'localhost',
    SMTP_PORT: '2525',
    EMAIL_FROM: 'AiLoom <no-reply@example.com>',
  });
}

async function rawRow(id: string): Promise<Record<string, unknown>> {
  const rows = await ds.query<Record<string, unknown>[]>(
    'SELECT * FROM auth_sessions WHERE id = $1',
    [id],
  );
  const [row] = rows;
  if (row === undefined) throw new Error(`no session ${id}`);
  return row;
}

async function tokenVersion(): Promise<number | undefined> {
  const rows = await ds.query<{ token_version: number }[]>(
    'SELECT token_version FROM users WHERE id = $1',
    [userId],
  );
  return rows[0]?.token_version;
}

beforeAll(async () => {
  ds = await getTestDataSource();
  mailer = new MemoryMailer();
  clock = new FixedClock(NOW);
  const cfg = config();
  worker = await NestFactory.createApplicationContext(
    WorkerAppModule.register(cfg, {
      dataSource: ds,
      mailer,
      jobs: { pollingIntervalSeconds: 0.5 },
    }),
    { logger: false },
  );
  module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot(cfg),
      DatabaseModule.forRoot(cfg, ds),
      {
        ...LoggerModule.forRoot({ pinoHttp: { level: 'silent' } }),
        global: true,
      },
      JobsModule.forApi(),
      EmailModule.forRoot({ mailer }),
    ],
    providers: [
      { provide: Clock, useValue: clock },
      UsersRepository,
      SessionsRepository,
      SessionsService,
    ],
  }).compile();
  await module.init();
  sessions = module.get(SessionsService);
});

afterAll(async () => {
  await module.close();
  await worker.close();
});

beforeEach(async () => {
  await resetDatabase(ds);
  mailer.sent.length = 0;
  clock.set(NOW);
  userId = (await createUser({ ds })).user.id;
});

describe('SessionsService', () => {
  it('stores only the hash of refresh tokens', async () => {
    const { refreshToken, session } = await sessions.create(asUserId(userId), META);

    expect(session.refreshTokenHash).toBe(sha256Hex(refreshToken));
    expect(JSON.stringify(await rawRow(session.id))).not.toContain(refreshToken);
  });

  it('rotates: old token stops working, new one works, same family', async () => {
    const first = await sessions.create(asUserId(userId), META);

    const second = await sessions.rotate(first.refreshToken, META);

    expect(second.session.familyId).toBe(first.session.familyId);
    expect(second.session.id).not.toBe(first.session.id);
    expect(second.refreshToken).not.toBe(first.refreshToken);
    await expect(sessions.rotate(first.refreshToken, META)).rejects.toMatchObject({
      code: 'refresh_race',
    });
    await expect(sessions.rotate(second.refreshToken, META)).resolves.toBeDefined();
  });

  it('revokes the whole family and emails the user on reuse', async () => {
    const first = await sessions.create(asUserId(userId), META);
    const second = await sessions.rotate(first.refreshToken, META);
    clock.advance(11_000);

    await expect(sessions.rotate(first.refreshToken, META)).rejects.toMatchObject({
      code: 'session_revoked',
    });
    await expect(sessions.rotate(second.refreshToken, META)).rejects.toMatchObject({
      code: 'session_revoked',
    });

    const family = await ds
      .getRepository(AuthSessionEntity)
      .find({ where: { familyId: first.session.familyId } });
    expect(family.every((row) => row.revokedAt !== null)).toBe(true);
    expect(family.find((row) => row.id === first.session.id)?.revokedReason).toBe('rotated');
    expect(family.find((row) => row.id === second.session.id)?.revokedReason).toBe(
      'reuse_detected',
    );
    await vi.waitFor(
      () => {
        expect(mailer.sent.some((message) => /security alert/i.test(message.subject))).toBe(true);
      },
      { timeout: 5_000 },
    );
  });

  it('on reuse signs out every session of the user and bumps token_version', async () => {
    const first = await sessions.create(asUserId(userId), META);
    await sessions.rotate(first.refreshToken, META);
    const otherDevice = await sessions.create(asUserId(userId), META);
    clock.advance(11_000);

    await expect(sessions.rotate(first.refreshToken, META)).rejects.toMatchObject({
      code: 'session_revoked',
    });

    await expect(sessions.rotate(otherDevice.refreshToken, META)).rejects.toMatchObject({
      code: 'session_revoked',
    });
    expect((await rawRow(otherDevice.session.id))['revoked_reason']).toBe('reuse_detected');
    expect(await tokenVersion()).toBe(1);
  });

  it('does not treat a token revoked by logout-all as reuse', async () => {
    const first = await sessions.create(asUserId(userId), META);
    await sessions.revokeAllForUser(asUserId(userId), 'logout_all');
    clock.advance(11_000);

    await expect(sessions.rotate(first.refreshToken, META)).rejects.toMatchObject({
      code: 'session_revoked',
    });

    // The reuse branch would rewrite nothing here but would bump token_version a second time.
    expect(await tokenVersion()).toBe(1);
    expect((await rawRow(first.session.id))['revoked_reason']).toBe('logout_all');
  });

  it('records password_change as the revocation reason', async () => {
    const { session } = await sessions.create(asUserId(userId), META);

    await sessions.revokeAllForUser(asUserId(userId), 'password_change');

    expect((await rawRow(session.id))['revoked_reason']).toBe('password_change');
  });

  it('treats a rotation within 10 s as a race, not theft', async () => {
    const first = await sessions.create(asUserId(userId), META);
    const second = await sessions.rotate(first.refreshToken, META);
    clock.advance(5_000);

    await expect(sessions.rotate(first.refreshToken, META)).rejects.toMatchObject({
      code: 'refresh_race',
    });
    await expect(sessions.rotate(second.refreshToken, META)).resolves.toBeDefined();
  });

  it('expires after 30 days', async () => {
    const { refreshToken } = await sessions.create(asUserId(userId), META);
    clock.advance(30 * DAY_MS + 1);

    await expect(sessions.rotate(refreshToken, META)).rejects.toMatchObject({
      code: 'session_expired',
    });
  });

  it('revokeAllForUser bumps token_version', async () => {
    const first = await sessions.create(asUserId(userId), META);
    const second = await sessions.create(asUserId(userId), META);

    await sessions.revokeAllForUser(asUserId(userId), 'logout_all');

    const rows = await ds.query<{ token_version: number }[]>(
      'SELECT token_version FROM users WHERE id = $1',
      [userId],
    );
    expect(rows[0]?.token_version).toBe(1);
    await expect(sessions.rotate(first.refreshToken, META)).rejects.toMatchObject({
      code: 'session_revoked',
    });
    await expect(sessions.rotate(second.refreshToken, META)).rejects.toMatchObject({
      code: 'session_revoked',
    });
  });

  it('lists sessions and revokes only the owner’s session', async () => {
    const mine = await sessions.create(asUserId(userId), META);
    const other = await createUser({ ds }, { email: 'other@example.com' });
    const theirs = await sessions.create(asUserId(other.user.id), META);

    expect((await sessions.listForUser(asUserId(userId))).map((row) => row.id)).toEqual([
      mine.session.id,
    ]);
    await expect(sessions.revokeOne(asUserId(userId), theirs.session.id)).rejects.toMatchObject({
      code: 'not_found',
    });
    await sessions.revokeOne(asUserId(userId), mine.session.id);
    expect(await sessions.listForUser(asUserId(userId))).toEqual([]);
  });
});
