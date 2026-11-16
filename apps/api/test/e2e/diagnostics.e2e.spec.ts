// SPDX-License-Identifier: AGPL-3.0-only
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { LocalDiskStorage, MemoryStorage } from '../../src/common/storage';
import { createTestApp, type TestApp } from '../helpers/app';
import { resetDatabase } from '../helpers/db';
import { authed, createUser, loginAs } from '../helpers/factories';

interface DiagnosticsBody {
  version: string;
  checks: {
    email: { status: string; detail: string; fix: string | null };
    encryption: {
      status: string;
      keyVersions: number[];
      rowsNeedingReencrypt: number;
      fix: string | null;
    };
    storage: { status: string; fix: string | null };
    worker: { status: string; lastBeatAt: string | null; fix: string | null };
    pgvector: { status: string; version: string };
    localModel: { status: string };
    listen: { status: string };
  };
  queues: unknown[];
  signupMode: string;
}

describe('diagnostics', () => {
  let t: TestApp;
  let client: ReturnType<typeof authed>;
  let adminPassword: string;

  beforeAll(async () => {
    t = await createTestApp({
      config: { email: { transport: 'none' } },
      storage: new MemoryStorage(),
    });
  });

  afterAll(async () => {
    await t.close();
  });

  beforeEach(async () => {
    await resetDatabase(t.ds);
    const { user, password } = await createUser(
      { ds: t.ds },
      { email: 'admin@example.com', isInstanceAdmin: true },
    );
    adminPassword = password;
    client = authed(t, await loginAs(t, user, password));
  });

  it('requires an instance admin', async () => {
    const { user, password } = await createUser(
      { ds: t.ds },
      { email: 'user@example.com', isInstanceAdmin: false },
    );
    const regular = authed(t, await loginAs(t, user, password));

    const res = await regular.get('/api/health/diagnostics');

    expect(res.status).toBe(403);
  });

  it('reports each check, the email fix, and a stale worker', async () => {
    await t.ds.query(
      `INSERT INTO worker_heartbeats (worker_id, last_beat_at, version)
       VALUES ('worker-1', now() - interval '3 minutes', 'test')`,
    );

    const res = await client.get('/api/health/diagnostics');

    expect(res.status).toBe(200);
    const body = res.body as DiagnosticsBody;
    expect(body.signupMode).toBe('invite');
    expect(body.version).toEqual(expect.any(String));
    expect(body.checks.email.status).toBe('warn');
    expect(body.checks.email.fix).toContain('EMAIL_TRANSPORT');
    expect(body.checks.encryption).toMatchObject({
      status: 'ok',
      keyVersions: [1],
      rowsNeedingReencrypt: 0,
    });
    expect(body.checks.storage.status).toBe('ok');
    expect(body.checks.worker.status).toBe('error');
    expect(body.checks.worker.lastBeatAt).toEqual(expect.any(String));
    expect(body.checks.worker.fix).toContain('worker');
    expect(body.checks.pgvector.status).toBe('ok');
    expect(body.checks.pgvector.version).not.toBe('');
    expect(body.checks.localModel.status).toBe('ok');
    expect(body.checks.listen.status).toBe('ok');
    expect(Array.isArray(body.queues)).toBe(true);
  });

  it('turns an unwritable storage volume into an error with a fix', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'diagnostics-readonly-'));
    await chmod(dir, 0o500);
    const app = await createTestApp({
      config: { email: { transport: 'none' } },
      storage: new LocalDiskStorage(dir),
    });
    try {
      const login = await app.http
        .post('/api/v1/auth/login')
        .set({ 'X-Requested-With': 'fetch', Origin: app.config.publicUrl.origin })
        .send({ email: 'admin@example.com', password: adminPassword });
      expect(login.status).toBe(200);
      const cookies = login.headers['set-cookie'] as unknown as string[];
      const diagnostic = await app.http
        .get('/api/health/diagnostics')
        .set('Cookie', cookies.map((value) => value.split(';')[0]).join('; '))
        .set({ 'X-Requested-With': 'fetch', Origin: app.config.publicUrl.origin });
      expect(diagnostic.status).toBe(200);
      expect((diagnostic.body as DiagnosticsBody).checks.storage.status).toBe('error');
      expect((diagnostic.body as DiagnosticsBody).checks.storage.fix).toContain('STORAGE_DIR');
    } finally {
      await app.close();
      await chmod(dir, 0o700);
      await rm(dir, { recursive: true, force: true });
    }
  });
});
