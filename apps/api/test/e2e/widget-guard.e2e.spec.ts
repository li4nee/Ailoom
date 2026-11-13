// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, randomUUID } from 'node:crypto';

import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { RateLimit } from '../../src/common/security/rate-limit';
import { asBotId, asContactId, asWorkspaceId } from '../../src/db/ids';
import { Public } from '../../src/modules/auth';
import {
  CurrentVisitor,
  type CurrentVisitorData,
  VisitorTokenService,
} from '../../src/modules/widget';
import { createTestApp, type TestApp } from '../helpers/app';
import { resetDatabase } from '../helpers/db';
import {
  authed,
  type AuthedClient,
  createUser,
  createWorkspace,
  loginAs,
} from '../helpers/factories';

/**
 * The routes 5.4 will hang off the widget module, stubbed so this suite can exercise the
 * guard and the rate limits through real routes. `createSession` is the `POST /sessions`
 * shape (bot resolved from the public key in the body); `createMessage` is every
 * token-authenticated widget route (visitor resolved from the bearer token).
 */
@Controller('widget/v1/__t')
export class WidgetProbeController {
  @Post()
  @Public()
  @HttpCode(HttpStatus.OK)
  @RateLimit('widgetSession')
  createSession(@CurrentVisitor() visitor: CurrentVisitorData): {
    botId: string;
    contactId: string | null;
  } {
    return { botId: visitor.bot.id, contactId: visitor.claims?.contactId ?? null };
  }

  @Post('messages')
  @Public()
  @HttpCode(HttpStatus.OK)
  @RateLimit('visitorMessage')
  createMessage(@CurrentVisitor() visitor: CurrentVisitorData): {
    botId: string;
    contactId: string;
  } {
    return { botId: visitor.bot.id, contactId: visitor.claims?.contactId ?? '' };
  }
}

interface ErrorBody {
  error: { code: string };
}

interface ProbeBot {
  id: string;
  publicKey: string;
}

const ALLOWED = 'https://shop.com';

let emailSeq = 0;

describe('widget guard, cors and rate limits', () => {
  let t: TestApp;
  let owner: AuthedClient;
  let workspaceId: string;
  let chatCredentialId: string;

  beforeAll(async () => {
    t = await createTestApp({ controllers: [WidgetProbeController] });
  });

  afterAll(async () => {
    await t.close();
  });

  beforeEach(async () => {
    await resetDatabase(t.ds);
    emailSeq += 1;
    const { user, password } = await createUser(
      { ds: t.ds },
      { email: `w${String(emailSeq)}@example.com` },
    );
    workspaceId = (await createWorkspace(t, user, 'Acme')).id;
    owner = authed(t, await loginAs(t, user, password));

    // The factory inserts the workspace directly, so `workspace.created` never fired: create
    // the built-in row the listener would have provisioned.
    await t.ds.query(
      `INSERT INTO provider_credentials (workspace_id, provider, label)
       VALUES ($1, 'local', 'Built-in (local)')`,
      [workspaceId],
    );
    chatCredentialId = await createCredential();
  });

  async function createCredential(): Promise<string> {
    const res = await owner
      .post(`/api/v1/workspaces/${workspaceId}/credentials`)
      .send({ provider: 'mock', label: 'Chat' });
    expect(res.status).toBe(201);
    return (res.body as { id: string }).id;
  }

  function codeOf(body: unknown): string {
    return (body as ErrorBody).error.code;
  }

  async function createBot(allowedOrigins: string[]): Promise<ProbeBot> {
    const res = await owner.post(`/api/v1/workspaces/${workspaceId}/bots`).send({
      name: 'Help',
      chatCredentialId,
      chatModel: 'mock-chat',
      allowedOrigins,
    });
    expect(res.status).toBe(201);
    const body = res.body as ProbeBot;
    return { id: body.id, publicKey: body.publicKey };
  }

  /** A real visitor token from the real service, for a fresh contact of `botId`. */
  async function issueToken(botId: string): Promise<string> {
    const tokens = t.app.get(VisitorTokenService);
    return tokens.issue({
      contactId: asContactId(randomUUID()),
      botId: asBotId(botId),
      workspaceId: asWorkspaceId(workspaceId),
    });
  }

  /** The `POST /sessions` shape: bot from the public key in the body. `null` sends no Origin. */
  function postSession(publicKey: string, origin: string | null) {
    const request = t.http.post('/api/widget/v1/__t').send({ publicKey });
    return origin === null ? request : request.set('Origin', origin);
  }

  /** Every token-authenticated widget route: bearer token plus the widget page's origin. */
  function postMessage(token: string) {
    return t.http
      .post('/api/widget/v1/__t/messages')
      .set('Origin', ALLOWED)
      .set('Authorization', `Bearer ${token}`)
      .send({});
  }

  it('preflight echoes the origin without credentials', async () => {
    const r = await t.http
      .options('/api/widget/v1/sessions')
      .set('Origin', 'https://shop.com')
      .set('Access-Control-Request-Method', 'POST');

    expect(r.status).toBe(204);
    expect(r.headers['access-control-allow-origin']).toBe('https://shop.com');
    expect(r.headers['access-control-allow-methods']).toBe('GET, POST');
    expect(r.headers['access-control-allow-headers']).toBe(
      'Authorization, Content-Type, Last-Event-ID',
    );
    expect(r.headers['access-control-max-age']).toBe('600');
    expect(r.headers['vary']).toBe('Origin');
    expect(r.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('rejects a non-allowed origin without CORS headers', async () => {
    const bot = await createBot([ALLOWED]);

    const r = await postSession(bot.publicKey, 'https://evil.test');

    expect(r.status).toBe(403);
    expect(codeOf(r.body)).toBe('origin_not_allowed');
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects when allowed origins are empty (widget disabled)', async () => {
    const bot = await createBot([]);

    const r = await postSession(bot.publicKey, ALLOWED);

    expect(r.status).toBe(403);
    expect(codeOf(r.body)).toBe('origin_not_allowed');
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('accepts wildcard subdomains', async () => {
    const bot = await createBot(['https://*.shop.com']);

    const r = await postSession(bot.publicKey, 'https://docs.shop.com');

    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ botId: bot.id, contactId: null });
    expect(r.headers['access-control-allow-origin']).toBe('https://docs.shop.com');
    expect(r.headers['vary']).toBe('Origin');
    expect(r.headers['cross-origin-resource-policy']).toBe('cross-origin');

    // `*.shop.com` covers subdomains only: the bare domain must be listed separately.
    const bare = await postSession(bot.publicKey, ALLOWED);
    expect(bare.status).toBe(403);
    expect(codeOf(bare.body)).toBe('origin_not_allowed');
  });

  it('rejects a token for a deleted bot', async () => {
    const bot = await createBot([ALLOWED]);
    const token = await issueToken(bot.id);
    await owner.delete(`/api/v1/workspaces/${workspaceId}/bots/${bot.id}`);

    const r = await postMessage(token);

    expect(r.status).toBe(404);
    expect(codeOf(r.body)).toBe('bot_not_found');
  });

  it('rejects a token whose workspace is deleted', async () => {
    const bot = await createBot([ALLOWED]);
    const token = await issueToken(bot.id);
    await t.ds.query('UPDATE workspaces SET deleted_at = now() WHERE id = $1', [workspaceId]);

    const r = await postMessage(token);

    expect(r.status).toBe(404);
    expect(codeOf(r.body)).toBe('bot_not_found');
  });

  it('keeps working after key rotation for existing tokens', async () => {
    const bot = await createBot([ALLOWED]);
    const token = await issueToken(bot.id);
    expect((await postMessage(token)).status).toBe(200);

    const rotated = await owner.post(`/api/v1/workspaces/${workspaceId}/bots/${bot.id}/rotate-key`);
    expect(rotated.status).toBe(200);

    // The token binds the bot id, not the public key, so the old token keeps working...
    expect((await postMessage(token)).status).toBe(200);
    // ...while the old key no longer resolves a bot.
    const oldKey = await postSession(bot.publicKey, ALLOWED);
    expect(oldKey.status).toBe(404);
    expect(codeOf(oldKey.body)).toBe('bot_not_found');
  });

  it('limits messages per contact per minute', async () => {
    const bot = await createBot([ALLOWED]);
    const token = await issueToken(bot.id);

    for (let i = 0; i < 20; i += 1) {
      expect((await postMessage(token)).status).toBe(200);
    }
    const blocked = await postMessage(token);

    expect(blocked.status).toBe(429);
    expect(codeOf(blocked.body)).toBe('rate_limited');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);

    // Another contact has its own buckets.
    expect((await postMessage(await issueToken(bot.id))).status).toBe(200);
  });

  it('limits messages per contact per day', async () => {
    const bot = await createBot([ALLOWED]);
    const token = await issueToken(bot.id);

    // 200 honest requests take a day: seed the day bucket through the throttler storage the
    // guard itself uses, with the key the guard derives (sha256 of class-handler-name-tracker).
    const contactId = (await t.app.get(VisitorTokenService).verify(token)).contactId;
    const key = createHash('sha256')
      .update(`${WidgetProbeController.name}-createMessage-visitorMessageDay-visitor:${contactId}`)
      .digest('hex');
    const storage = t.app.get<ThrottlerStorage>(ThrottlerStorage);
    const DAY_MS = 24 * 60 * 60 * 1000;
    for (let i = 0; i < 200; i += 1) {
      await storage.increment(key, DAY_MS, 200, DAY_MS, 'visitorMessageDay');
    }

    const blocked = await postMessage(token);

    expect(blocked.status).toBe(429);
    expect(codeOf(blocked.body)).toBe('rate_limited');
  });
});
