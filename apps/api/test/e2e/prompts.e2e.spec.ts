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
import { listRoutes } from '../isolation/route-inventory';

interface ErrorBody {
  error: { code: string };
}

interface PromptVersionBody {
  id: string;
  botId: string;
  version: number;
  systemPrompt: string;
  note: string | null;
  createdAt: string;
}

let emailSeq = 0;

function nextEmail(): string {
  emailSeq += 1;
  return `prompts${String(emailSeq)}@example.com`;
}

describe('prompt versions', () => {
  let t: TestApp;
  let owner: AuthedClient;
  let workspaceId: string;
  let botId: string;

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

    const credentials = `/api/v1/workspaces/${workspaceId}/credentials`;
    const chat = await owner.post(credentials).send({ provider: 'mock', label: 'Chat' });
    const embed = await owner.post(credentials).send({ provider: 'mock', label: 'Embed' });
    const bot = await owner.post(`/api/v1/workspaces/${workspaceId}/bots`).send({
      name: 'Help',
      chatCredentialId: (chat.body as { id: string }).id,
      chatModel: 'mock-chat',
      embeddingCredentialId: (embed.body as { id: string }).id,
      embeddingModel: 'mock-embed',
    });
    if (bot.status !== 201) throw new Error(`bot creation failed: ${String(bot.status)}`);
    botId = (bot.body as { id: string }).id;
  });

  function url(): string {
    return `/api/v1/workspaces/${workspaceId}/bots/${botId}/prompt-versions`;
  }

  async function versions(): Promise<PromptVersionBody[]> {
    const res = await owner.get(url());
    expect(res.status).toBe(200);
    return res.body as PromptVersionBody[];
  }

  it('starts a new bot with version 1 and an empty prompt', async () => {
    const rows = await versions();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ version: 1, systemPrompt: '', note: null, botId });
  });

  it('increments versions and points the bot at the newest one', async () => {
    for (const prompt of ['Be brief.', 'Be kind.', 'Be both.']) {
      const res = await owner.post(url()).send({ systemPrompt: prompt });
      expect(res.status).toBe(201);
    }

    // Version 1 is the empty prompt every new bot starts with.
    const rows = await versions();
    expect(rows.map((row) => row.version)).toEqual([4, 3, 2, 1]);
    expect(rows.map((row) => row.systemPrompt)).toEqual(['Be both.', 'Be kind.', 'Be brief.', '']);

    const bot = await owner.get(`/api/v1/workspaces/${workspaceId}/bots/${botId}`);
    expect((bot.body as { activePromptVersionId?: string }).activePromptVersionId).toBe(
      rows[0]?.id,
    );
  });

  it('has no route that edits or deletes a version', () => {
    const promptRoutes = listRoutes(t.app).filter((route) =>
      route.path.includes('/prompt-versions'),
    );

    expect(promptRoutes.map((route) => route.method).sort()).toEqual(['GET', 'POST']);
  });

  it('never duplicates a version under concurrent creates', async () => {
    const responses = await Promise.all([
      owner.post(url()).send({ systemPrompt: 'First' }),
      owner.post(url()).send({ systemPrompt: 'Second' }),
    ]);

    expect(responses.map((res) => res.status)).toEqual([201, 201]);
    expect((await versions()).map((row) => row.version)).toEqual([3, 2, 1]);
  });

  it('rejects a prompt over 8000 characters', async () => {
    const res = await owner.post(url()).send({ systemPrompt: 'x'.repeat(8001) });

    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).error.code).toBe('validation_failed');
  });

  it('agents cannot read or write prompt versions', async () => {
    const { user: agent, password } = await createUser({ ds: t.ds }, { email: nextEmail() });
    await t.ds.query(
      "INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'agent')",
      [workspaceId, agent.id],
    );
    const agentClient = authed(t, await loginAs(t, agent, password));

    expect((await agentClient.get(url())).status).toBe(403);
    expect((await agentClient.post(url()).send({ systemPrompt: 'x' })).status).toBe(403);
  });
});
