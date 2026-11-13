// SPDX-License-Identifier: AGPL-3.0-only
import { SignJWT, decodeProtectedHeader } from 'jose';
import { describe, expect, it } from 'vitest';

import { FixedClock } from '../../common/clock';
import { type AppConfig, loadConfig } from '../../common/config';
import { asBotId, asContactId, asWorkspaceId } from '../../db/ids';
import { VISITOR_TOKEN_TTL_DAYS, VisitorTokenService } from './visitor-token.service';

const CONTACT_ID = asContactId('0190b000-0000-7000-8000-000000000001');
const BOT_ID = asBotId('0190b000-0000-7000-8000-000000000002');
const WORKSPACE_ID = asWorkspaceId('0190b000-0000-7000-8000-000000000003');
const CLAIMS = { contactId: CONTACT_ID, botId: BOT_ID, workspaceId: WORKSPACE_ID };
const NOW = new Date('2026-01-01T00:00:00Z');
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);
const DAY_SECONDS = 24 * 60 * 60;

function config(): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    PUBLIC_URL: 'https://support.example.com',
    DATABASE_URL: 'postgres://user:pass@localhost:5432/ailoom',
    AUTH_SECRET: 'a'.repeat(32),
    WIDGET_SECRET: 'w'.repeat(32),
    ENCRYPTION_KEYS: `v1:${'ab'.repeat(32)}`,
    LOG_LEVEL: 'error',
  });
}

describe('VisitorTokenService', () => {
  it('issues an HS256 token with aud widget and round trips the claims', async () => {
    const tokens = new VisitorTokenService(config(), new FixedClock(NOW));

    const jwt = await tokens.issue(CLAIMS);

    expect(decodeProtectedHeader(jwt).alg).toBe('HS256');
    await expect(tokens.verify(jwt)).resolves.toMatchObject({
      contactId: CONTACT_ID,
      botId: BOT_ID,
      workspaceId: WORKSPACE_ID,
    });
  });

  it('expires the token after 30 days', async () => {
    const clock = new FixedClock(NOW);
    const tokens = new VisitorTokenService(config(), clock);
    const jwt = await tokens.issue(CLAIMS);

    clock.advance(VISITOR_TOKEN_TTL_DAYS * DAY_SECONDS * 1000 - 60_000);
    await expect(tokens.verify(jwt)).resolves.toMatchObject({ contactId: CONTACT_ID });

    clock.advance(61_000);
    await expect(tokens.verify(jwt)).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('rejects a token without the widget audience', async () => {
    const tokens = new VisitorTokenService(config(), new FixedClock(NOW));
    const jwt = await new SignJWT({ bot: BOT_ID, ws: WORKSPACE_ID })
      .setProtectedHeader({ alg: 'HS256' })
      .setAudience('admin')
      .setSubject(CONTACT_ID)
      .setIssuedAt(NOW_SECONDS)
      .setExpirationTime(NOW_SECONDS + DAY_SECONDS)
      .sign(Buffer.from('w'.repeat(32)));

    await expect(tokens.verify(jwt)).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('rejects tampered tokens', async () => {
    const tokens = new VisitorTokenService(config(), new FixedClock(NOW));
    const jwt = await tokens.issue(CLAIMS);
    const [header, payload, signature = ''] = jwt.split('.');
    const last = signature.at(-1) === 'A' ? 'B' : 'A';
    const tampered = `${String(header)}.${String(payload)}.${signature.slice(0, -1)}${last}`;

    await expect(tokens.verify(tampered)).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('rejects tokens signed with AUTH_SECRET', async () => {
    const tokens = new VisitorTokenService(config(), new FixedClock(NOW));
    const jwt = await new SignJWT({ bot: BOT_ID, ws: WORKSPACE_ID })
      .setProtectedHeader({ alg: 'HS256' })
      .setAudience('widget')
      .setSubject(CONTACT_ID)
      .setIssuedAt(NOW_SECONDS)
      .setExpirationTime(NOW_SECONDS + DAY_SECONDS)
      .sign(Buffer.from('a'.repeat(32)));

    await expect(tokens.verify(jwt)).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('rejects malformed tokens', async () => {
    const tokens = new VisitorTokenService(config(), new FixedClock(NOW));

    await expect(tokens.verify('not-a-jwt')).rejects.toMatchObject({ code: 'unauthorized' });
  });
});
