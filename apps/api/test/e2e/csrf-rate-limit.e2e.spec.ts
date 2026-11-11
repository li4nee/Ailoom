// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestApp, type TestApp } from '../helpers/app';
import { resetDatabase } from '../helpers/db';
import { authed, createUser, loginAs } from '../helpers/factories';

interface ErrorBody {
  error: { code: string };
}

function codeOf(body: unknown): string {
  return (body as ErrorBody).error.code;
}

const ORIGIN = 'http://localhost:3000';
const FETCH = { 'X-Requested-With': 'fetch', Origin: ORIGIN };

describe('csrf and rate limits', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ config: { signupMode: 'open' } });
  });

  afterAll(async () => {
    await t.close();
  });

  beforeEach(async () => {
    await resetDatabase(t.ds);
  });

  it('rejects mutating requests without X-Requested-With', async () => {
    const { user, password } = await createUser({ ds: t.ds });

    const res = await t.http
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: user.email, password });

    expect(res.status).toBe(403);
    expect(codeOf(res.body)).toBe('csrf_failed');
  });

  it('rejects a foreign Origin', async () => {
    const { user, password } = await createUser({ ds: t.ds });

    const res = await t.http
      .post('/api/v1/auth/login')
      .set({ 'X-Requested-With': 'fetch', Origin: 'https://evil.test' })
      .send({ email: user.email, password });

    expect(res.status).toBe(403);
    expect(codeOf(res.body)).toBe('csrf_failed');
  });

  it('allows GET without the header', async () => {
    const { user, password } = await createUser({ ds: t.ds });
    const cookies = await loginAs(t, user, password);

    const res = await authed(t, cookies).get('/api/v1/auth/me').unset('X-Requested-With');

    expect(res.status).toBe(200);
  });

  it('limits login attempts per ip+email', async () => {
    const { user } = await createUser({ ds: t.ds });
    const attempt = (email: string) =>
      t.http
        .post('/api/v1/auth/login')
        .set(FETCH)
        .set('X-Forwarded-For', '203.0.113.50')
        .send({ email, password: 'bad-password-123' });

    for (let i = 0; i < 10; i += 1) {
      expect((await attempt(user.email)).status).toBe(401);
    }
    const blocked = await attempt(user.email);

    expect(blocked.status).toBe(429);
    expect(codeOf(blocked.body)).toBe('rate_limited');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect((await attempt('other@example.com')).status).toBe(401);
  });

  it('uses the client ip from the last proxy hop', async () => {
    const { user } = await createUser({ ds: t.ds });
    const attempt = (forwarded: string) =>
      t.http
        .post('/api/v1/auth/login')
        .set(FETCH)
        .set('X-Forwarded-For', forwarded)
        .send({ email: user.email, password: 'bad-password-123' });

    for (let i = 0; i < 10; i += 1) await attempt('198.51.100.1, 203.0.113.10');
    expect((await attempt('198.51.100.1, 203.0.113.10')).status).toBe(429);
    // Same spoofed first hop, different real client: a separate bucket.
    expect((await attempt('198.51.100.1, 203.0.113.11')).status).toBe(401);
  });

  it('limits signup to 5 per hour per ip', async () => {
    const signup = (email: string) =>
      t.http
        .post('/api/v1/auth/signup')
        .set(FETCH)
        .set('X-Forwarded-For', '203.0.113.60')
        .send({ email, password: 'a long enough password' });

    for (let i = 0; i < 5; i += 1) {
      expect((await signup(`user${String(i)}@example.com`)).status).toBe(201);
    }

    const blocked = await signup('one-too-many@example.com');
    expect(blocked.status).toBe(429);
    expect(codeOf(blocked.body)).toBe('rate_limited');
  });
});
