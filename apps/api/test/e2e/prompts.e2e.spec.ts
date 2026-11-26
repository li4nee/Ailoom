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

    expect(promptRoutes.every((route) => route.method === 'GET' || route.method === 'POST')).toBe(
      true,
    );
  });

  it('saves drafts, publishes the selected version, and restores an immutable earlier version', async () => {
    const botUrl = `/api/v1/workspaces/${workspaceId}/bots/${botId}`;
    const [initial] = await versions();
    if (initial === undefined) throw new Error('Expected an initial prompt.');
    const save = await owner.post(url()).send({ systemPrompt: 'Be brief.', activate: false });
    expect(save.status).toBe(201);
    const draft = save.body as PromptVersionBody;
    expect((await owner.get(botUrl)).body).toMatchObject({ activePromptVersionId: initial.id });

    const publishStatus = await owner.get(`${url()}/${draft.id}/release-status`);
    expect(publishStatus.status).toBe(200);
    expect(publishStatus.body).toEqual({
      activeVersionId: initial.id,
      operation: 'publish',
      gate: null,
    });
    const publish = await owner
      .post(`${url()}/${draft.id}/activate`)
      .send({ expectedActiveVersionId: initial.id });
    expect(publish.status).toBe(201);
    expect((await owner.get(botUrl)).body).toMatchObject({ activePromptVersionId: draft.id });

    const stale = await owner
      .post(`${url()}/${initial.id}/activate`)
      .send({ expectedActiveVersionId: initial.id });
    expect(stale.status).toBe(409);
    const restoreStatus = await owner.get(`${url()}/${initial.id}/release-status`);
    expect(restoreStatus.status).toBe(200);
    expect(restoreStatus.body).toEqual({
      activeVersionId: draft.id,
      operation: 'rollback',
      gate: null,
    });
    expect(
      (
        await owner
          .post(`${url()}/${initial.id}/activate`)
          .send({ expectedActiveVersionId: draft.id })
      ).status,
    ).toBe(201);
    expect((await owner.get(botUrl)).body).toMatchObject({ activePromptVersionId: initial.id });
    expect(await versions()).toEqual([draft, initial]);
  });

  it('never duplicates a version under concurrent creates', async () => {
    const responses = await Promise.all([
      owner.post(url()).send({ systemPrompt: 'First' }),
      owner.post(url()).send({ systemPrompt: 'Second' }),
    ]);

    expect(responses.map((res) => res.status)).toEqual([201, 201]);
    expect((await versions()).map((row) => row.version)).toEqual([3, 2, 1]);
  });

  it('uses evaluation evidence for the selected version and required dataset', async () => {
    const botUrl = `/api/v1/workspaces/${workspaceId}/bots/${botId}`;
    const dataset = await owner.post(`${botUrl}/eval/datasets`).send({ name: 'Prompt release' });
    expect(dataset.status).toBe(201);
    const { id: datasetId } = dataset.body as { id: string };
    const gate = await owner.put(`${botUrl}/eval/gate`).send({
      datasetId,
      minPassRate: 0.8,
      maxRegression: 0.1,
    });
    expect(gate.status).toBe(200);
    await t.ds.query(`UPDATE bots SET retrieval_mode = 'hybrid' WHERE id = $1`, [botId]);
    const [live] = await versions();
    if (live === undefined) throw new Error('Expected a live prompt.');
    const response = await owner.post(url()).send({ systemPrompt: 'Draft', activate: false });
    expect(response.status).toBe(201);
    const { id: draftId } = response.body as PromptVersionBody;
    const releaseUrl = `${url()}/${draftId}`;

    async function completeRun(
      versionId: string,
      passRate: number,
      configOverrides: Record<string, unknown> = {},
      summaryOverrides: Record<string, unknown> = {},
    ) {
      const rows = await t.ds.query<{ id: string }[]>(
        `INSERT INTO eval_runs
          (workspace_id, bot_id, dataset_id, status, config, summary, finished_at)
         VALUES ($1, $2, $3, 'completed', $4::jsonb, $5::jsonb, now()) RETURNING id`,
        [
          workspaceId,
          botId,
          datasetId,
          JSON.stringify({ promptVersionId: versionId, ...configOverrides }),
          JSON.stringify({ passRate, ...summaryOverrides }),
        ],
      );
      return rows[0]?.id;
    }

    await completeRun(live.id, 1);
    const blocked = await owner
      .post(`${releaseUrl}/activate`)
      .send({ expectedActiveVersionId: live.id });
    expect(blocked.status).toBe(409);
    expect((await owner.get(`${releaseUrl}/release-status`)).body).toMatchObject({
      gate: {
        datasetId,
        runId: null,
        blockedReason:
          'Complete an evaluation for this version on the required dataset within the last seven days.',
      },
    });

    await completeRun(draftId, 1, { retrievalMode: 'hybrid', comparisonOnly: true });
    expect((await owner.get(`${releaseUrl}/release-status`)).body).toMatchObject({
      gate: { runId: null },
    });
    await completeRun(draftId, 1, { retrievalMode: 'hybrid' }, { inconclusive: true });
    expect((await owner.get(`${releaseUrl}/release-status`)).body).toMatchObject({
      gate: { runId: null },
    });

    const runId = await completeRun(draftId, 0.9, { retrievalMode: 'hybrid' });
    expect((await owner.get(`${releaseUrl}/release-status`)).body).toMatchObject({
      gate: { datasetId, runId, passRate: 0.9, blockedReason: null },
    });
    expect(
      (await owner.post(`${releaseUrl}/activate`).send({ expectedActiveVersionId: live.id }))
        .status,
    ).toBe(201);
  });

  it("hides a soft-deleted bot's versions", async () => {
    expect((await owner.delete(`/api/v1/workspaces/${workspaceId}/bots/${botId}`)).status).toBe(
      204,
    );

    expect((await owner.get(url())).status).toBe(404);
    expect((await owner.post(url()).send({ systemPrompt: 'x' })).status).toBe(404);
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
