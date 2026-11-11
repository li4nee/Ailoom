// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestApp, type TestApp } from '../helpers/app';
import { resetDatabase } from '../helpers/db';
import { authed, createUser, createWorkspace, loginAs } from '../helpers/factories';

interface ErrorBody {
  error: { code: string };
}

function codeOf(body: unknown): string {
  return (body as ErrorBody).error.code;
}

const FETCH = { 'X-Requested-With': 'fetch', Origin: 'http://localhost:3000' };

describe('instance settings', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ config: { signupMode: 'invite' } });
  });

  afterAll(async () => {
    await t.close();
  });

  beforeEach(async () => {
    await resetDatabase(t.ds);
  });

  it('non-admins get 403 forbidden', async () => {
    const { user, password } = await createUser({ ds: t.ds }, { email: 'user@example.com' });
    const client = authed(t, await loginAs(t, user, password));

    const read = await client.get('/api/v1/instance/settings');
    const write = await client.put('/api/v1/instance/settings').send({ signupMode: 'open' });

    expect(read.status).toBe(403);
    expect(codeOf(read.body)).toBe('forbidden');
    expect(write.status).toBe(403);
  });

  it('reports the environment value until an admin overrides it', async () => {
    const { user, password } = await createUser(
      { ds: t.ds },
      { email: 'admin@example.com', isInstanceAdmin: true },
    );
    const client = authed(t, await loginAs(t, user, password));

    const res = await client.get('/api/v1/instance/settings');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      signupMode: 'invite',
      signupModeSource: 'env',
      emailEnabled: false,
    });
  });

  it('admin sets open; the next signup is allowed and the change is audited', async () => {
    const { user, password } = await createUser(
      { ds: t.ds },
      { email: 'admin@example.com', isInstanceAdmin: true },
    );
    const client = authed(t, await loginAs(t, user, password));

    const res = await client.put('/api/v1/instance/settings').send({ signupMode: 'open' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      signupMode: 'open',
      signupModeSource: 'override',
      emailEnabled: false,
    });
    const signup = await t.http
      .post('/api/v1/auth/signup')
      .set(FETCH)
      .send({ email: 'new@example.com', password: 'a much longer passphrase' });
    expect(signup.status).toBe(201);
    const audit = await t.ds.query<
      { workspace_id: string | null; actor_user_id: string; metadata: unknown }[]
    >(
      `SELECT workspace_id, actor_user_id, metadata FROM audit_log
        WHERE action = 'instance.signup_mode_changed'`,
    );
    expect(audit).toEqual([
      { workspace_id: null, actor_user_id: user.id, metadata: { from: 'invite', to: 'open' } },
    ]);
  });

  it('rejects an unknown signup mode', async () => {
    const { user, password } = await createUser(
      { ds: t.ds },
      { email: 'admin@example.com', isInstanceAdmin: true },
    );
    const client = authed(t, await loginAs(t, user, password));

    const res = await client.put('/api/v1/instance/settings').send({ signupMode: 'everyone' });

    expect(res.status).toBe(400);
    expect(codeOf(res.body)).toBe('validation_failed');
  });

  it('instance admins get no access to other workspaces', async () => {
    const { user: admin, password } = await createUser(
      { ds: t.ds },
      { email: 'admin@example.com', isInstanceAdmin: true },
    );
    const { user: other } = await createUser({ ds: t.ds }, { email: 'other@example.com' });
    const ws = await createWorkspace(t, other);

    const res = await authed(t, await loginAs(t, admin, password)).get(
      `/api/v1/workspaces/${ws.id}`,
    );

    expect(res.status).toBe(404);
  });
});
