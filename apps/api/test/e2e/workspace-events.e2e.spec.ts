// SPDX-License-Identifier: AGPL-3.0-only
import { type ClientRequest, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RealtimeEvent } from '@app/shared';

import { asWorkspaceId } from '../../src/db/ids';
import { notifyWorkspace } from '../../src/modules/realtime';
import { createTestApp, type TestApp } from '../helpers/app';
import { resetDatabase } from '../helpers/db';
import { authed, createUser, createWorkspace, loginAs } from '../helpers/factories';

let emailSeq = 0;

function nextEmail(): string {
  emailSeq += 1;
  return `events${String(emailSeq)}@example.com`;
}

describe('GET /v1/workspaces/:workspaceId/events', () => {
  let t: TestApp;
  let port: number;
  let workspaceId: string;
  let cookie: string;
  const open: ClientRequest[] = [];

  beforeAll(async () => {
    t = await createTestApp({ sseHeartbeatMs: 50 });
    await t.app.listen(0);
    const address = t.app.getHttpServer().address() as AddressInfo;
    port = address.port;
  });

  afterAll(async () => {
    await t.close();
  });

  beforeEach(async () => {
    await resetDatabase(t.ds);
    const { user, password } = await createUser({ ds: t.ds }, { email: nextEmail() });
    workspaceId = (await createWorkspace(t, user, 'Acme')).id;
    const cookies = await loginAs(t, user, password);
    cookie = cookies.map((value) => value.split(';')[0]).join('; ');
  });

  afterEach(() => {
    for (const request of open.splice(0)) request.destroy();
  });

  function stream(path: string, cookieHeader: string): string[] {
    const chunks: string[] = [];
    const request = httpRequest({
      host: '127.0.0.1',
      port,
      path,
      headers: {
        Accept: 'text/event-stream',
        Cookie: cookieHeader,
        Origin: t.config.publicUrl.origin,
        'X-Requested-With': 'fetch',
      },
    });
    request.on('response', (response) => {
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => chunks.push(chunk));
    });
    request.end();
    open.push(request);
    return chunks;
  }

  async function waitForText(chunks: string[], text: string): Promise<void> {
    await vi.waitFor(
      () => {
        expect(chunks.join('')).toContain(text);
      },
      { timeout: 5_000 },
    );
  }

  function sourceEvent(botId: string): RealtimeEvent {
    return {
      type: 'source.updated',
      sourceId: '00000000-0000-7000-8000-000000000001',
      botId,
      status: 'ready',
    };
  }

  it('streams events to members and 404s non-members', async () => {
    const chunks = stream(`/api/v1/workspaces/${workspaceId}/events`, cookie);

    // The hub issues its LISTEN asynchronously, so a notification sent in the first
    // milliseconds of the stream is lost; keep notifying until one lands.
    await vi.waitFor(
      async () => {
        await t.ds.transaction((manager) =>
          notifyWorkspace(manager, asWorkspaceId(workspaceId), sourceEvent('b1')),
        );
        expect(chunks.join('')).toContain('event: source.updated');
      },
      { timeout: 5_000 },
    );
    const payload = chunks.join('');
    expect(payload).toContain('"botId":"b1"');
    expect(payload.split('\n').some((line) => line.startsWith('data: {'))).toBe(true);

    const { user: outsider, password } = await createUser({ ds: t.ds }, { email: nextEmail() });
    await createWorkspace(t, outsider, 'Globex');
    const outsiderCookies = await loginAs(t, outsider, password);
    const denied = await authed(t, outsiderCookies).get(`/api/v1/workspaces/${workspaceId}/events`);

    expect(denied.status).toBe(404);
  });

  it('sends heartbeats', async () => {
    const chunks = stream(`/api/v1/workspaces/${workspaceId}/events`, cookie);

    await waitForText(chunks, ': ping');
    expect(chunks.join('')).not.toContain('event: source.updated');
  });
});
