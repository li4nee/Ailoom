// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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

interface PriceBody {
  provider: string;
  model: string;
  inputPerMtokUsd: string;
  outputPerMtokUsd: string;
  source: 'builtin' | 'override';
}

let emailSeq = 0;

function nextEmail(): string {
  emailSeq += 1;
  return `prices${String(emailSeq)}@example.com`;
}

describe('model prices', () => {
  let t: TestApp;
  let owner: AuthedClient;
  let workspaceId: string;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  beforeEach(async () => {
    await resetDatabase(t.ds);
    const { user, password } = await createUser({ ds: t.ds }, { email: nextEmail() });
    workspaceId = (await createWorkspace(t, user, 'Acme')).id;
    owner = authed(t, await loginAs(t, user, password));
  });

  function url(): string {
    return `/api/v1/workspaces/${workspaceId}/model-prices`;
  }

  function codeOf(body: unknown): string {
    return (body as ErrorBody).error.code;
  }

  it('lists the built-in table', async () => {
    const res = await owner.get(url());

    expect(res.status).toBe(200);
    const rows = res.body as PriceBody[];
    expect(rows).toContainEqual({
      provider: 'openai',
      model: 'gpt-4o-mini',
      inputPerMtokUsd: '0.1500',
      outputPerMtokUsd: '0.6000',
      source: 'builtin',
    });
    expect(rows.every((row) => row.source === 'builtin')).toBe(true);
  });

  it('replaces the workspace overrides', async () => {
    const first = await owner.put(url()).send({
      prices: [
        {
          provider: 'openai',
          model: 'gpt-4o-mini',
          inputPerMtokUsd: '1.0000',
          outputPerMtokUsd: '2.0000',
        },
      ],
    });
    expect(first.status).toBe(200);
    expect(first.body).toContainEqual({
      provider: 'openai',
      model: 'gpt-4o-mini',
      inputPerMtokUsd: '1.0000',
      outputPerMtokUsd: '2.0000',
      source: 'override',
    });

    const second = await owner.put(url()).send({ prices: [] });
    expect(second.status).toBe(200);
    expect((second.body as PriceBody[]).every((row) => row.source === 'builtin')).toBe(true);
  });

  it('rejects an unknown provider or a malformed price', async () => {
    const badProvider = await owner.put(url()).send({
      prices: [{ provider: 'nope', model: 'x', inputPerMtokUsd: '1', outputPerMtokUsd: '1' }],
    });
    expect(badProvider.status).toBe(400);
    expect(codeOf(badProvider.body)).toBe('validation_failed');

    const badPrice = await owner.put(url()).send({
      prices: [{ provider: 'openai', model: 'x', inputPerMtokUsd: '-1', outputPerMtokUsd: '1' }],
    });
    expect(badPrice.status).toBe(400);
  });

  it('agents get 403', async () => {
    const { user: agent, password } = await createUser({ ds: t.ds }, { email: nextEmail() });
    await t.ds.query(
      "INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'agent')",
      [workspaceId, agent.id],
    );
    const agentClient = authed(t, await loginAs(t, agent, password));

    expect((await agentClient.get(url())).status).toBe(403);
    expect((await agentClient.put(url()).send({ prices: [] })).status).toBe(403);
  });
});
