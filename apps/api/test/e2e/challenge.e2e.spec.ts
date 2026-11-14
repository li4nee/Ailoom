// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';

import { solveChallenge } from 'altcha-lib/v1';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ChallengeService } from '../../src/modules/widget';
import { createTestApp, type TestApp } from '../helpers/app';
import { resetDatabase } from '../helpers/db';
import {
  authed,
  type AuthedClient,
  createUser,
  createWorkspace,
  loginAs,
} from '../helpers/factories';

interface ErrorBody {
  error: { code: string };
}

interface Bot {
  id: string;
  publicKey: string;
}

const ALLOWED = 'https://shop.com';
const CHALLENGE_SECRET = Buffer.from('c'.repeat(32));

let emailSeq = 0;

describe('widget proof-of-work challenge', () => {
  let t: TestApp;
  let owner: AuthedClient;
  let workspaceId: string;
  let chatCredentialId: string;

  beforeAll(async () => {
    t = await createTestApp({ config: { challengeSecret: CHALLENGE_SECRET } });
  });

  afterAll(async () => {
    await t.close();
  });

  beforeEach(async () => {
    await resetDatabase(t.ds);
    emailSeq += 1;
    const { user, password } = await createUser(
      { ds: t.ds },
      { email: `c${String(emailSeq)}@example.com` },
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

  async function createBot(allowedOrigins: string[], requireChallenge = false): Promise<Bot> {
    const res = await owner.post(`/api/v1/workspaces/${workspaceId}/bots`).send({
      name: 'Help',
      chatCredentialId,
      chatModel: 'mock-chat',
      allowedOrigins,
      requireChallenge,
    });
    expect(res.status).toBe(201);
    const body = res.body as Bot;
    return { id: body.id, publicKey: body.publicKey };
  }

  /** The challenge endpoint as the widget calls it: public key in `k`, page origin. */
  function getChallenge(publicKey: string, origin: string | null) {
    const request = t.http.get(`/api/widget/v1/challenge?k=${encodeURIComponent(publicKey)}`);
    return origin === null ? request : request.set('Origin', origin);
  }

  it('answers 204 No Content for a bot that does not require a challenge', async () => {
    const bot = await createBot([ALLOWED]);

    const r = await getChallenge(bot.publicKey, ALLOWED);

    expect(r.status).toBe(204);
    expect(r.text).toBe('');
    expect(r.headers['access-control-allow-origin']).toBe(ALLOWED);
    expect(r.headers['vary']).toBe('Origin');
    expect(r.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  it('solves and verifies a challenge for a bot that requires one', async () => {
    const bot = await createBot([ALLOWED], true);

    const r = await getChallenge(bot.publicKey, ALLOWED);

    expect(r.status).toBe(200);
    const challenge = r.body as {
      algorithm: string;
      challenge: string;
      maxnumber: number;
      salt: string;
      signature: string;
    };
    expect(challenge.algorithm).toBe('SHA-256');
    expect(challenge.maxnumber).toBe(50_000);
    expect(challenge.challenge).toMatch(/^[0-9a-f]{64}$/);
    expect(challenge.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(r.headers['access-control-allow-origin']).toBe(ALLOWED);

    // The payload a real widget would submit round trips through the real verifier.
    const solution = await solveChallenge(
      challenge.challenge,
      challenge.salt,
      challenge.algorithm,
      challenge.maxnumber,
    ).promise;
    if (solution === null) throw new Error('challenge was not solvable');
    const payload = Buffer.from(
      JSON.stringify({
        algorithm: challenge.algorithm,
        challenge: challenge.challenge,
        number: solution.number,
        salt: challenge.salt,
        signature: challenge.signature,
      }),
    ).toString('base64');
    await expect(t.app.get(ChallengeService).verify(payload)).resolves.toBe(true);
  });

  it('rejects an unknown public key', async () => {
    const r = await getChallenge(`pk_live_${randomUUID()}`, ALLOWED);

    expect(r.status).toBe(404);
    expect(codeOf(r.body)).toBe('bot_not_found');
  });

  it('rejects a deleted bot', async () => {
    const bot = await createBot([ALLOWED]);
    await owner.delete(`/api/v1/workspaces/${workspaceId}/bots/${bot.id}`);

    const r = await getChallenge(bot.publicKey, ALLOWED);

    expect(r.status).toBe(404);
    expect(codeOf(r.body)).toBe('bot_not_found');
  });

  it('rejects a non-allowed origin without CORS headers', async () => {
    const bot = await createBot([ALLOWED], true);

    const r = await getChallenge(bot.publicKey, 'https://evil.test');

    expect(r.status).toBe(403);
    expect(codeOf(r.body)).toBe('origin_not_allowed');
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects a request without an Origin', async () => {
    const bot = await createBot([ALLOWED], true);

    const r = await getChallenge(bot.publicKey, null);

    expect(r.status).toBe(403);
    expect(codeOf(r.body)).toBe('origin_not_allowed');
  });

  // One bare app for both cases: closing a Nest app tears down the global CLS plugin host, so
  // this process cannot build a fresh app after the first close.
  it('rejects requireChallenge when CHALLENGE_SECRET is unset, on create and on update', async () => {
    // The default harness env has no CHALLENGE_SECRET, so challengeSecret is null.
    const bare = await createTestApp();
    try {
      const { user, password } = await createUser(
        { ds: bare.ds },
        { email: `bare${String(emailSeq)}@example.com` },
      );
      const bareWorkspace = (await createWorkspace(bare, user, 'Bare')).id;
      const bareOwner = authed(bare, await loginAs(bare, user, password));
      await bare.ds.query(
        `INSERT INTO provider_credentials (workspace_id, provider, label)
         VALUES ($1, 'local', 'Built-in (local)')`,
        [bareWorkspace],
      );
      const cred = await bareOwner
        .post(`/api/v1/workspaces/${bareWorkspace}/credentials`)
        .send({ provider: 'mock', label: 'Chat' });
      expect(cred.status).toBe(201);
      const chatCredentialId = (cred.body as { id: string }).id;

      const create = await bareOwner.post(`/api/v1/workspaces/${bareWorkspace}/bots`).send({
        name: 'Help',
        chatCredentialId,
        chatModel: 'mock-chat',
        requireChallenge: true,
      });
      expect(create.status).toBe(400);
      expect(codeOf(create.body)).toBe('challenge_not_configured');

      const bot = await bareOwner
        .post(`/api/v1/workspaces/${bareWorkspace}/bots`)
        .send({ name: 'Help', chatCredentialId, chatModel: 'mock-chat' });
      expect(bot.status).toBe(201);
      const botId = (bot.body as { id: string }).id;

      const update = await bareOwner
        .patch(`/api/v1/workspaces/${bareWorkspace}/bots/${botId}`)
        .send({ requireChallenge: true });

      expect(update.status).toBe(400);
      expect(codeOf(update.body)).toBe('challenge_not_configured');
    } finally {
      await bare.close();
    }
  });
});
