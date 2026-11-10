// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { EmailTokensService } from '../../src/modules/auth/email-tokens.service';
import { createTestApp, type TestApp } from '../helpers/app';
import { resetDatabase } from '../helpers/db';
import { authed, createUser, loginAs } from '../helpers/factories';

interface ErrorBody {
  error: { code: string };
}

function codeOf(body: unknown): string {
  return (body as ErrorBody).error.code;
}

const FETCH = { 'X-Requested-With': 'fetch', Origin: 'http://localhost:3000' };

describe('email verification and password reset', () => {
  let t: TestApp;
  let tokens: EmailTokensService;

  beforeAll(async () => {
    t = await createTestApp({
      config: {
        email: {
          transport: 'smtp',
          host: '127.0.0.1',
          port: 2525,
          user: null,
          pass: null,
          secure: false,
          from: 'test@example.com',
        },
      },
    });
    tokens = t.app.get(EmailTokensService);
  });

  afterAll(async () => {
    await t.close();
  });

  beforeEach(async () => {
    await resetDatabase(t.ds);
  });

  async function issueVerify(userId: string): Promise<string> {
    return tokens.issue(userId, 'verify_email', 24);
  }

  async function issueReset(userId: string): Promise<string> {
    return tokens.issue(userId, 'reset_password', 1);
  }

  async function expire(userId: string, type: string): Promise<void> {
    await t.ds.query(
      `UPDATE email_tokens SET expires_at = now() - interval '1 second'
        WHERE user_id = $1 AND type = $2`,
      [userId, type],
    );
  }

  async function tokenCount(userId: string, type: string): Promise<number> {
    const rows = await t.ds.query<{ count: number }[]>(
      'SELECT count(*)::int AS count FROM email_tokens WHERE user_id = $1 AND type = $2',
      [userId, type],
    );
    return rows[0]?.count ?? 0;
  }

  it('verifies once', async () => {
    const { user } = await createUser(
      { ds: t.ds },
      { verified: false, email: 'verify@example.com' },
    );
    const token = await issueVerify(user.id);

    expect((await t.http.post('/api/v1/auth/verify-email').set(FETCH).send({ token })).status).toBe(
      200,
    );
    const rows = await t.ds.query<{ email_verified_at: Date | null }[]>(
      'SELECT email_verified_at FROM users WHERE id = $1',
      [user.id],
    );
    expect(rows[0]?.email_verified_at).not.toBeNull();

    const again = await t.http.post('/api/v1/auth/verify-email').set(FETCH).send({ token });
    expect(again.status).toBe(400);
    expect(codeOf(again.body)).toBe('invalid_token');
  });

  it('expires verify tokens after 24 h', async () => {
    const { user } = await createUser(
      { ds: t.ds },
      { verified: false, email: 'expired@example.com' },
    );
    const token = await issueVerify(user.id);
    await expire(user.id, 'verify_email');

    const res = await t.http.post('/api/v1/auth/verify-email').set(FETCH).send({ token });

    expect(res.status).toBe(401);
    expect(codeOf(res.body)).toBe('token_expired');
  });

  it('resends a verification email only while unverified', async () => {
    const { user, password } = await createUser(
      { ds: t.ds },
      { verified: false, email: 'resend@example.com' },
    );
    const cookies = await loginAs(t, user, password);
    expect(await tokenCount(user.id, 'verify_email')).toBe(0);

    const res = await authed(t, cookies).post('/api/v1/auth/resend-verification');

    expect(res.status).toBe(204);
    expect(await tokenCount(user.id, 'verify_email')).toBe(1);
  });

  it('forgot-password never reveals existence', async () => {
    const { user } = await createUser({ ds: t.ds }, { email: 'forgot@example.com' });

    const unknown = await t.http
      .post('/api/v1/auth/forgot-password')
      .set(FETCH)
      .send({ email: 'nobody@example.com' });
    const known = await t.http
      .post('/api/v1/auth/forgot-password')
      .set(FETCH)
      .send({ email: user.email });

    expect([unknown.status, known.status]).toEqual([200, 200]);
    expect(unknown.text).toBe(known.text);
    expect(await tokenCount(user.id, 'reset_password')).toBe(1);
  });

  it('reset sets the password and logs out everywhere', async () => {
    const { user, password } = await createUser({ ds: t.ds }, { email: 'reset@example.com' });
    const cookies = await loginAs(t, user, password);
    const token = await issueReset(user.id);

    const res = await t.http
      .post('/api/v1/auth/reset-password')
      .set(FETCH)
      .send({ token, password: 'brand new password 1' });

    expect(res.status).toBe(200);
    expect((await authed(t, cookies).get('/api/v1/auth/me')).status).toBe(401);

    const oldLogin = await t.http
      .post('/api/v1/auth/login')
      .set(FETCH)
      .send({ email: user.email, password });
    expect(oldLogin.status).toBe(401);
    const newLogin = await t.http
      .post('/api/v1/auth/login')
      .set(FETCH)
      .send({ email: user.email, password: 'brand new password 1' });
    expect(newLogin.status).toBe(200);
  });

  it('reset tokens expire after 1 h and are single use', async () => {
    const { user } = await createUser({ ds: t.ds }, { email: 'reset-once@example.com' });
    const token = await issueReset(user.id);

    const first = await t.http
      .post('/api/v1/auth/reset-password')
      .set(FETCH)
      .send({ token, password: 'brand new password 1' });
    expect(first.status).toBe(200);

    const again = await t.http
      .post('/api/v1/auth/reset-password')
      .set(FETCH)
      .send({ token, password: 'another new password 2' });
    expect(again.status).toBe(400);
    expect(codeOf(again.body)).toBe('invalid_token');

    const expiredToken = await issueReset(user.id);
    await expire(user.id, 'reset_password');
    const expired = await t.http
      .post('/api/v1/auth/reset-password')
      .set(FETCH)
      .send({ token: expiredToken, password: 'another new password 2' });
    expect(expired.status).toBe(401);
    expect(codeOf(expired.body)).toBe('token_expired');
  });

  it('reset enforces the password policy', async () => {
    const { user } = await createUser({ ds: t.ds }, { email: 'policy@example.com' });
    const token = await issueReset(user.id);

    const rejected = await t.http
      .post('/api/v1/auth/reset-password')
      .set(FETCH)
      .send({ token, password: 'password123' });

    expect(rejected.status).toBe(400);
    expect(codeOf(rejected.body)).toBe('password_policy');

    // A rejected password must not burn the link.
    const accepted = await t.http
      .post('/api/v1/auth/reset-password')
      .set(FETCH)
      .send({ token, password: 'brand new password 1' });
    expect(accepted.status).toBe(200);
  });
});
