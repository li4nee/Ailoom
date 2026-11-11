// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestApp, type TestApp } from '../helpers/app';
import { resetDatabase } from '../helpers/db';
import { authed, createUser, createWorkspace, loginAs } from '../helpers/factories';

/**
 * Its own file because the provider URL policy is per-instance configuration: the HTTP app is
 * built once with open signup's policy, and a test process must not run two apps at once.
 */
describe('credentials under open signup', () => {
  let t: TestApp;

  beforeAll(async () => {
    // What SIGNUP_MODE=open derives: a stranger must not be able to probe the internal network.
    t = await createTestApp({
      config: {
        signupMode: 'open',
        providerUrls: { allowPrivate: false, allowlist: [], denylist: [] },
      },
    });
  });

  afterAll(async () => {
    await t.close();
  });

  beforeEach(async () => {
    await resetDatabase(t.ds);
  });

  it('rejects a private base URL as blocked_url', async () => {
    const { user, password } = await createUser({ ds: t.ds }, { email: 'open@example.com' });
    const workspace = await createWorkspace(t, user, 'Open');
    const client = authed(t, await loginAs(t, user, password));

    const created = await client
      .post(`/api/v1/workspaces/${workspace.id}/credentials`)
      .send({ provider: 'ollama', label: 'Local', baseUrl: 'http://127.0.0.1:11434' });
    expect(created.status).toBe(201);

    const tested = await client.post(
      `/api/v1/workspaces/${workspace.id}/credentials/${(created.body as { id: string }).id}/test`,
    );

    expect(tested.status).toBe(200);
    const body = tested.body as { ok: boolean; code: string; hint: string | null };
    expect(body.ok).toBe(false);
    expect(body.code).toBe('blocked_url');
    expect(body.hint).toContain('ALLOW_PRIVATE_PROVIDER_URLS');
  });
});
