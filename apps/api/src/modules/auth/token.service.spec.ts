// SPDX-License-Identifier: AGPL-3.0-only
import { SignJWT, decodeProtectedHeader } from 'jose';
import { describe, expect, it } from 'vitest';

import { FixedClock } from '../../common/clock';
import { type AppConfig, loadConfig } from '../../common/config';
import { asUserId } from '../../db/ids';
import { TokenService } from './token.service';

const USER_ID = asUserId('0190a000-0000-7000-8000-000000000001');
const SECOND_SECRET = Buffer.from('b'.repeat(32));
const NOW = new Date('2026-01-01T00:00:00Z');
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);

function config(authSecret = 'a'.repeat(32)): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    PUBLIC_URL: 'https://support.example.com',
    DATABASE_URL: 'postgres://user:pass@localhost:5432/ailoom',
    AUTH_SECRET: authSecret,
    WIDGET_SECRET: 'w'.repeat(32),
    ENCRYPTION_KEYS: `v1:${'ab'.repeat(32)}`,
    LOG_LEVEL: 'error',
  });
}

describe('TokenService', () => {
  it('issues HS256 tokens with the expected claims and 15 min ttl', async () => {
    const tokens = new TokenService(config(), new FixedClock(NOW));

    const jwt = await tokens.issueAccess({ userId: USER_ID, sessionId: 's1', tokenVersion: 3 });

    expect(decodeProtectedHeader(jwt).alg).toBe('HS256');
    expect(await tokens.verifyAccess(jwt)).toMatchObject({
      sub: USER_ID,
      sid: 's1',
      tv: 3,
      iat: NOW_SECONDS,
      exp: NOW_SECONDS + 900,
    });
  });

  it('accepts tokens signed with an older secret', async () => {
    const tokens = new TokenService(
      config(`${'a'.repeat(32)},${'b'.repeat(32)}`),
      new FixedClock(NOW),
    );
    const jwt = await new SignJWT({ sid: 's1', tv: 1 })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(USER_ID)
      .setIssuedAt(NOW_SECONDS)
      .setExpirationTime(NOW_SECONDS + 900)
      .sign(SECOND_SECRET);

    await expect(tokens.verifyAccess(jwt)).resolves.toMatchObject({ sub: USER_ID, tv: 1 });
  });

  it('rejects expired tokens with token_expired', async () => {
    const clock = new FixedClock(NOW);
    const tokens = new TokenService(config(), clock);
    const jwt = await tokens.issueAccess({ userId: USER_ID, sessionId: 's1', tokenVersion: 0 });

    clock.advance(901_000);

    await expect(tokens.verifyAccess(jwt)).rejects.toMatchObject({ code: 'token_expired' });
  });

  it('rejects tampered tokens', async () => {
    const tokens = new TokenService(config(), new FixedClock(NOW));
    const jwt = await tokens.issueAccess({ userId: USER_ID, sessionId: 's1', tokenVersion: 0 });
    const [header, payload, signature = ''] = jwt.split('.');
    const last = signature.at(-1) === 'A' ? 'B' : 'A';
    const tampered = `${String(header)}.${String(payload)}.${signature.slice(0, -1)}${last}`;

    await expect(tokens.verifyAccess(tampered)).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('rejects tokens signed with an unknown secret', async () => {
    const tokens = new TokenService(config(), new FixedClock(NOW));
    const jwt = await new SignJWT({ sid: 's1', tv: 0 })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(USER_ID)
      .setIssuedAt(NOW_SECONDS)
      .setExpirationTime(NOW_SECONDS + 900)
      .sign(Buffer.from('z'.repeat(32)));

    await expect(tokens.verifyAccess(jwt)).rejects.toMatchObject({ code: 'unauthorized' });
  });
});
