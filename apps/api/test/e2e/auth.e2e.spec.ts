// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { meResponseSchema } from '@app/shared';

import { PasswordHasher } from '../../src/modules/auth/password-hasher';
import { MembershipEntity } from '../../src/modules/workspaces/entities/membership.entity';
import { WorkspaceEntity } from '../../src/modules/workspaces/entities/workspace.entity';
import { createTestApp, type TestApp } from '../helpers/app';
import { resetDatabase } from '../helpers/db';
import { authed, cookieValue, createUser, loginAs, setCookies } from '../helpers/factories';

interface ErrorBody {
  error: { code: string };
}

function codeOf(body: unknown): string {
  return (body as ErrorBody).error.code;
}

function cookie(response: { headers: { 'set-cookie'?: string[] | string } }, name: string): string {
  const value = setCookies(response).find((entry) => entry.startsWith(`${name}=`));
  if (value === undefined) throw new Error(`no ${name} cookie`);
  return value;
}

async function seedWorkspace(t: TestApp, name: string): Promise<string> {
  const result = await t.ds
    .getRepository(WorkspaceEntity)
    .insert({ name, slug: name.toLowerCase() });
  return (result.identifiers[0] as { id: string }).id;
}

describe('auth endpoints', () => {
  let t: TestApp;
  const fetchHeaders = { 'X-Requested-With': 'fetch', Origin: 'http://localhost:3000' };

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  beforeEach(async () => {
    await resetDatabase(t.ds);
  });

  it('signs up the first user', async () => {
    const res = await t.http.post('/api/v1/auth/signup').set(fetchHeaders).send({
      email: 'first@example.com',
      password: 'a long enough password',
      name: 'First',
    });

    expect(res.status).toBe(201);
    const id: unknown = (res.body as { id?: unknown }).id;
    expect(typeof id).toBe('string');
  });

  it('login sets both cookies with exact attributes', async () => {
    const { user, password } = await createUser({ ds: t.ds });

    const res = await t.http
      .post('/api/v1/auth/login')
      .set(fetchHeaders)
      .send({ email: user.email, password });

    expect(res.status).toBe(200);
    expect(cookie(res, '__Host-at')).toMatch(
      /HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=900$/,
    );
    expect(cookie(res, '__Secure-rt')).toMatch(
      /HttpOnly; Secure; SameSite=Strict; Path=\/api\/v1\/auth\/refresh; Max-Age=2592000$/,
    );
    expect(res.body).not.toHaveProperty('token');
    expect(res.body).not.toHaveProperty('refreshToken');
  });

  it('wrong password and unknown email look identical', async () => {
    const { user } = await createUser({ ds: t.ds });
    const dummy = vi.spyOn(PasswordHasher.prototype, 'verifyDummy');

    const wrong = await t.http
      .post('/api/v1/auth/login')
      .set(fetchHeaders)
      .send({ email: user.email, password: 'wrong-password-123' });
    const unknown = await t.http
      .post('/api/v1/auth/login')
      .set(fetchHeaders)
      .send({ email: 'nobody@x.com', password: 'wrong-password-123' });

    expect([wrong.status, unknown.status]).toEqual([401, 401]);
    expect(codeOf(wrong.body)).toBe('invalid_credentials');
    expect(codeOf(unknown.body)).toBe('invalid_credentials');
    expect(dummy).toHaveBeenCalled();
    dummy.mockRestore();
  });

  it('refresh rotates both cookies', async () => {
    const { user, password } = await createUser({ ds: t.ds });
    const cookies = await loginAs(t, user, password);
    const oldRefresh = cookieValue(cookies, '__Secure-rt');

    const res = await t.http
      .post('/api/v1/auth/refresh')
      .set(fetchHeaders)
      .set('Cookie', oldRefresh);

    expect(res.status).toBe(200);
    expect(cookie(res, '__Host-at')).toMatch(/Max-Age=900$/);
    expect(cookieValue(setCookies(res), '__Secure-rt')).not.toBe(oldRefresh);
  });

  it('logout revokes the session and clears cookies', async () => {
    const { user, password } = await createUser({ ds: t.ds });
    const cookies = await loginAs(t, user, password);
    const refresh = cookieValue(cookies, '__Secure-rt');

    const res = await t.http.post('/api/v1/auth/logout').set(fetchHeaders).set('Cookie', refresh);

    expect(res.status).toBe(204);
    expect(cookie(res, '__Host-at')).toMatch(/Max-Age=0$/);
    expect(cookie(res, '__Secure-rt')).toMatch(/Max-Age=0$/);

    const after = await t.http
      .post('/api/v1/auth/refresh')
      .set(fetchHeaders)
      .set('Cookie', refresh);
    expect(after.status).toBe(401);
  });

  it('logout works with only the refresh cookie', async () => {
    const { user, password } = await createUser({ ds: t.ds });
    const cookies = await loginAs(t, user, password);

    const res = await t.http
      .post('/api/v1/auth/logout')
      .set(fetchHeaders)
      .set('Cookie', cookieValue(cookies, '__Secure-rt'));

    expect(res.status).toBe(204);
    expect(cookie(res, '__Secure-rt')).toMatch(/Max-Age=0$/);
  });

  it('logout-all invalidates other devices immediately', async () => {
    const { user, password } = await createUser({ ds: t.ds });
    const first = await loginAs(t, user, password);
    const second = await loginAs(t, user, password);

    const res = await authed(t, first).post('/api/v1/auth/logout-all');

    expect(res.status).toBe(204);
    expect((await authed(t, second).get('/api/v1/auth/me')).status).toBe(401);
  });

  it('me returns memberships', async () => {
    const { user, password } = await createUser({ ds: t.ds });
    const workspaceId = await seedWorkspace(t, 'Acme');
    await t.ds
      .getRepository(MembershipEntity)
      .insert({ workspaceId, userId: user.id, role: 'agent' });
    const cookies = await loginAs(t, user, password);

    const res = await authed(t, cookies).get('/api/v1/auth/me');

    expect(res.status).toBe(200);
    expect(meResponseSchema.parse(res.body)).toMatchObject({
      id: user.id,
      email: user.email,
      memberships: [{ workspaceId, workspaceName: 'Acme', role: 'agent' }],
    });
  });

  it('password change requires the current password, revokes other sessions and keeps this one', async () => {
    const { user, password } = await createUser({ ds: t.ds });
    const first = await loginAs(t, user, password);
    const second = await loginAs(t, user, password);

    const res = await authed(t, first)
      .patch('/api/v1/auth/me')
      .send({ currentPassword: 'not the password', newPassword: 'brand new password 1' });
    expect(res.status).toBe(401);
    expect(codeOf(res.body)).toBe('invalid_credentials');

    const changed = await authed(t, first)
      .patch('/api/v1/auth/me')
      .send({ currentPassword: password, newPassword: 'brand new password 1' });
    expect(changed.status).toBe(200);
    const fresh = setCookies(changed);
    expect(fresh).toHaveLength(2);

    expect((await authed(t, fresh).get('/api/v1/auth/me')).status).toBe(200);
    expect((await authed(t, second).get('/api/v1/auth/me')).status).toBe(401);

    const oldLogin = await t.http
      .post('/api/v1/auth/login')
      .set(fetchHeaders)
      .send({ email: user.email, password });
    expect(oldLogin.status).toBe(401);
    const newLogin = await t.http
      .post('/api/v1/auth/login')
      .set(fetchHeaders)
      .send({ email: user.email, password: 'brand new password 1' });
    expect(newLogin.status).toBe(200);
  });

  it('lists sessions with the current one flagged and revokes another', async () => {
    const { user, password } = await createUser({ ds: t.ds });
    const first = await loginAs(t, user, password);
    const second = await loginAs(t, user, password);

    const list = await authed(t, first).get('/api/v1/auth/sessions');
    expect(list.status).toBe(200);
    const sessions = list.body as { sessionId: string; current: boolean }[];
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((session) => session.current)).toHaveLength(1);

    const other = sessions.find((session) => !session.current);
    if (other === undefined) throw new Error('no other session');
    const revoked = await authed(t, first).delete(`/api/v1/auth/sessions/${other.sessionId}`);
    expect(revoked.status).toBe(204);

    const refresh = await t.http
      .post('/api/v1/auth/refresh')
      .set(fetchHeaders)
      .set('Cookie', cookieValue(second, '__Secure-rt'));
    expect(refresh.status).toBe(401);

    const after = await authed(t, first).get('/api/v1/auth/sessions');
    expect(after.body as unknown[]).toHaveLength(1);
  });

  it("cannot revoke someone else's session", async () => {
    const { user: alice, password } = await createUser(
      { ds: t.ds },
      { email: 'alice@example.com' },
    );
    const { user: bob } = await createUser({ ds: t.ds }, { email: 'bob@example.com' });
    await loginAs(t, alice, password);
    const bobCookies = await loginAs(t, bob, password);
    const bobSessions = await authed(t, bobCookies).get('/api/v1/auth/sessions');
    const bobSession = (bobSessions.body as { sessionId: string }[])[0];
    if (bobSession === undefined) throw new Error('no session');

    const res = await authed(t, await loginAs(t, alice, password)).delete(
      `/api/v1/auth/sessions/${bobSession.sessionId}`,
    );

    expect(res.status).toBe(404);
  });
});
