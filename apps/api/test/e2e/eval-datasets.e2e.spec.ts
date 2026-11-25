// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestApp, type TestApp } from '../helpers/app';
import { resetDatabase } from '../helpers/db';
import { authed, createUser, createWorkspace, loginAs } from '../helpers/factories';
import type { AuthedClient } from '../helpers/factories';

describe('eval datasets API', () => {
  let t: TestApp;
  let owner: AuthedClient;
  let agent: AuthedClient;
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
    const { user: ownerUser, password: ownerPassword } = await createUser(
      { ds: t.ds },
      { email: `eval-owner-${String(Date.now())}@example.com` },
    );
    workspaceId = (await createWorkspace(t, ownerUser, 'Eval Workspace')).id;
    owner = authed(t, await loginAs(t, ownerUser, ownerPassword));

    await t.ds.query(
      `INSERT INTO provider_credentials (workspace_id, provider, label)
       VALUES ($1, 'local', 'Built-in (local)')`,
      [workspaceId],
    );
    const credential = await owner.post(`/api/v1/workspaces/${workspaceId}/credentials`).send({
      provider: 'mock',
      label: 'Chat',
    });
    const bot = await owner.post(`/api/v1/workspaces/${workspaceId}/bots`).send({
      name: 'Support',
      chatCredentialId: (credential.body as { id: string }).id,
      chatModel: 'mock-chat',
    });
    if (bot.status !== 201) throw new Error(`bot setup: ${bot.text}`);
    botId = (bot.body as { id: string }).id;

    const { user: agentUser, password: agentPassword } = await createUser(
      { ds: t.ds },
      { email: `eval-agent-${String(Date.now())}@example.com` },
    );
    await t.ds.query(
      `INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'agent')`,
      [workspaceId, agentUser.id],
    );
    agent = authed(t, await loginAs(t, agentUser, agentPassword));
  });

  function url(path = ''): string {
    return `/api/v1/workspaces/${workspaceId}/bots/${botId}/eval${path}`;
  }

  it('creates, updates and deletes a dataset with audit records', async () => {
    const created = await owner.post(url('/datasets')).send({
      name: 'Refunds',
      description: 'Refund policy checks',
    });
    expect(created.status).toBe(201);
    const datasetId = (created.body as { id: string }).id;

    const updated = await owner.patch(url(`/datasets/${datasetId}`)).send({ allowPartial: true });
    expect(updated.status).toBe(200);
    expect((updated.body as { allowPartial: boolean }).allowPartial).toBe(true);

    const audit = await t.ds.query<{ action: string }[]>(
      `SELECT action FROM audit_log WHERE target_id = $1 ORDER BY created_at`,
      [datasetId],
    );
    expect(audit.map((row) => row.action)).toEqual([
      'eval.dataset_created',
      'eval.dataset_updated',
    ]);

    const deleted = await owner.delete(url(`/datasets/${datasetId}`));
    expect(deleted.status).toBe(200);
    expect((deleted.body as { deleted: boolean }).deleted).toBe(true);
  });

  it('creates cases, rejects empty expectations, and round-trips the export format', async () => {
    const created = await owner.post(url('/datasets')).send({ name: 'Password reset' });
    const datasetId = (created.body as { id: string }).id;
    const invalid = await owner.post(url(`/datasets/${datasetId}/cases`)).send({
      question: 'How do I reset my password?',
    });
    expect(invalid.status).toBe(400);

    const response = await owner.post(url(`/datasets/${datasetId}/cases`)).send({
      cases: [
        { question: 'How do I reset my password?', expectedAnswer: 'Use the reset link.' },
        { question: 'Can I talk to a person?', expectHandoff: true },
      ],
    });
    expect(response.status).toBe(201);
    expect((response.body as { data: unknown[] }).data).toHaveLength(2);

    const exported = await owner.get(url(`/datasets/${datasetId}/export`));
    expect(exported.status).toBe(200);
    const imported = await owner.post(url('/datasets')).send({ name: 'Imported' });
    const importedId = (imported.body as { id: string }).id;
    const importResponse = await owner
      .post(url(`/datasets/${importedId}/import`))
      .send(exported.body);
    expect(importResponse.status).toBe(201);
    expect((importResponse.body as { imported: number }).imported).toBe(2);
    const importedCases = (await owner.get(url(`/datasets/${importedId}/cases`))).body as {
      data: { question: string }[];
    };
    expect(importedCases.data.map((item) => item.question).sort()).toEqual(
      ['Can I talk to a person?', 'How do I reset my password?'].sort(),
    );
  });

  it('allows agents to read datasets but rejects writes and hides another bot’s datasets', async () => {
    const dataset = await owner.post(url('/datasets')).send({ name: 'Agent readable' });
    const datasetId = (dataset.body as { id: string }).id;
    expect((await agent.get(url('/datasets'))).status).toBe(200);
    expect((await agent.post(url('/datasets')).send({ name: 'Not allowed' })).status).toBe(403);

    const foreign = await owner.get(
      `/api/v1/workspaces/${workspaceId}/bots/018f0a4e-7b2c-7abc-8def-0123456789ab/eval/datasets/${datasetId}/cases`,
    );
    expect(foreign.status).toBe(404);
  });

  it('enforces the 500-case dataset limit', async () => {
    const dataset = await owner.post(url('/datasets')).send({ name: 'Bounded' });
    const datasetId = (dataset.body as { id: string }).id;
    await t.ds.query(
      `INSERT INTO eval_cases (workspace_id, dataset_id, question, expect_handoff)
       SELECT $1, $2, 'seed ' || n::text, true FROM generate_series(1, 499) AS n`,
      [workspaceId, datasetId],
    );
    const rejected = await owner.post(url(`/datasets/${datasetId}/cases`)).send({
      cases: [
        { question: 'one more', expectHandoff: true },
        { question: 'too many', expectHandoff: true },
      ],
    });
    expect(rejected.status).toBe(400);
  });
});
