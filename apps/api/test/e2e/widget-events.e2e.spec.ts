// SPDX-License-Identifier: AGPL-3.0-only
import { type ClientRequest, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { asWorkspaceId } from '../../src/db/ids';
import { notifyWorkspace } from '../../src/modules/realtime';
import { createTestApp, type TestApp } from '../helpers/app';
import { resetDatabase } from '../helpers/db';
import {
  authed,
  type AuthedClient,
  createUser,
  createWorkspace,
  loginAs,
} from '../helpers/factories';

const ALLOWED = 'https://shop.com';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

let emailSeq = 0;

describe('widget live events', () => {
  let t: TestApp;
  let port: number;
  let owner: AuthedClient;
  let workspaceId: string;
  let chatCredentialId: string;
  const open: ClientRequest[] = [];

  beforeAll(async () => {
    t = await createTestApp();
    await t.app.listen(0);
    port = (t.app.getHttpServer().address() as AddressInfo).port;
  });

  afterAll(async () => {
    await t.close();
  });

  beforeEach(async () => {
    await resetDatabase(t.ds);
    emailSeq += 1;
    const { user, password } = await createUser(
      { ds: t.ds },
      { email: `ev${String(emailSeq)}@example.com` },
    );
    workspaceId = (await createWorkspace(t, user, 'Acme')).id;
    owner = authed(t, await loginAs(t, user, password));
    await t.ds.query(
      `INSERT INTO provider_credentials (workspace_id, provider, label)
       VALUES ($1, 'local', 'Built-in (local)')`,
      [workspaceId],
    );
    const credential = await owner
      .post(`/api/v1/workspaces/${workspaceId}/credentials`)
      .send({ provider: 'mock', label: 'Chat' });
    chatCredentialId = (credential.body as { id: string }).id;
  });

  afterEach(() => {
    for (const request of open.splice(0)) request.destroy();
  });

  async function createBot(): Promise<{ publicKey: string }> {
    const res = await owner.post(`/api/v1/workspaces/${workspaceId}/bots`).send({
      name: 'Help',
      chatCredentialId,
      chatModel: 'mock-chat',
      allowedOrigins: [ALLOWED],
    });
    if (res.status !== 201) throw new Error('bot create failed');
    return res.body as { publicKey: string };
  }

  async function session(bot: { publicKey: string }): Promise<{ token: string }> {
    const res = await t.http
      .post('/api/widget/v1/sessions')
      .set('Origin', ALLOWED)
      .send({ publicKey: bot.publicKey });
    if (res.status !== 201) throw new Error('session create failed');
    return res.body as { token: string };
  }

  async function conversation(token: string): Promise<string> {
    const res = await t.http
      .post('/api/widget/v1/conversations')
      .set('Origin', ALLOWED)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    if (res.status !== 201) throw new Error('conversation create failed');
    return (res.body as { id: string }).id;
  }

  async function insertMessage(
    conversationId: string,
    role: 'visitor' | 'ai' | 'agent' | 'system',
    status = 'complete',
  ): Promise<string> {
    const rows = await t.ds.query<{ id: string }[]>(
      `INSERT INTO messages (workspace_id, conversation_id, role, content, status)
       VALUES ($1, $2, $3, 'hello', $4) RETURNING id`,
      [workspaceId, conversationId, role, status],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('message insert returned no id');
    return id;
  }

  async function notifyMessage(
    conversationId: string,
    messageId: string,
    role: 'visitor' | 'ai' | 'agent' | 'system',
  ) {
    await t.ds.transaction(async (manager) =>
      notifyWorkspace(manager, asWorkspaceId(workspaceId), {
        type: 'message.created',
        conversationId,
        messageId,
        role,
      }),
    );
  }

  function openEvents(
    conversationId: string,
    token: string,
    lastEventId?: string,
  ): { chunks: string[]; request: ClientRequest } {
    const chunks: string[] = [];
    const headers: Record<string, string | number> = {
      Accept: 'text/event-stream',
      Authorization: `Bearer ${token}`,
      Origin: ALLOWED,
    };
    if (lastEventId !== undefined) headers['Last-Event-ID'] = lastEventId;
    const request = httpRequest({
      host: '127.0.0.1',
      port,
      path: `/api/widget/v1/conversations/${conversationId}/events`,
      method: 'GET',
      headers,
    });
    request.on('response', (response) => {
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => chunks.push(chunk));
    });
    request.on('error', () => {
      // Destroyed by the test teardown; nothing to report.
    });
    request.end();
    open.push(request);
    return { chunks, request };
  }

  function messageIds(raw: string): string[] {
    return [...raw.matchAll(/id: ([0-9a-f-]{36})\nevent: message/g)].map((match) => match[1] ?? '');
  }

  it('delivers an agent message within two seconds', async () => {
    const bot = await createBot();
    const { token } = await session(bot);
    const conversationId = await conversation(token);
    const { chunks } = openEvents(conversationId, token);

    // Let the hub issue LISTEN before the notification.
    await sleep(200);
    const messageId = await insertMessage(conversationId, 'agent');
    await notifyMessage(conversationId, messageId, 'agent');

    await vi.waitFor(
      () => {
        expect(messageIds(chunks.join(''))).toContain(messageId);
      },
      { timeout: 2_000 },
    );
    expect(chunks.join('')).toContain('"role":"agent"');
  });

  it('replays exactly the messages after Last-Event-ID', async () => {
    const bot = await createBot();
    const { token } = await session(bot);
    const conversationId = await conversation(token);
    const first = await insertMessage(conversationId, 'agent');
    const second = await insertMessage(conversationId, 'agent');
    const third = await insertMessage(conversationId, 'agent');

    const { chunks } = openEvents(conversationId, token, first);

    await vi.waitFor(
      () => {
        expect(messageIds(chunks.join('')).length).toBe(2);
      },
      { timeout: 2_000 },
    );
    const replayed = messageIds(chunks.join(''));
    expect(replayed).toEqual([second, third]);
  });

  it('sends a status event when the conversation changes', async () => {
    const bot = await createBot();
    const { token } = await session(bot);
    const conversationId = await conversation(token);
    const { chunks } = openEvents(conversationId, token);

    await sleep(200);
    await t.ds.transaction(async (manager) =>
      notifyWorkspace(manager, asWorkspaceId(workspaceId), {
        type: 'conversation.updated',
        conversationId,
        botId: '00000000-0000-4000-8000-000000000000',
        status: 'human',
      }),
    );

    await vi.waitFor(
      () => {
        expect(chunks.join('')).toContain('event: status');
      },
      { timeout: 2_000 },
    );
    expect(chunks.join('')).toContain('"status":"human"');
  });

  it('never sends a streaming placeholder', async () => {
    const bot = await createBot();
    const { token } = await session(bot);
    const conversationId = await conversation(token);
    const { chunks } = openEvents(conversationId, token);

    await sleep(200);
    const messageId = await insertMessage(conversationId, 'ai', 'streaming');
    await notifyMessage(conversationId, messageId, 'ai');
    await sleep(300);

    expect(chunks.join('')).not.toContain('event: message');
  });

  it("404s for another contact's conversation", async () => {
    const bot = await createBot();
    const first = await session(bot);
    const second = await session(bot);
    const otherConversation = await conversation(second.token);

    const res = await t.http
      .get(`/api/widget/v1/conversations/${otherConversation}/events`)
      .set('Origin', ALLOWED)
      .set('Authorization', `Bearer ${first.token}`);

    expect(res.status).toBe(404);
  });
});
