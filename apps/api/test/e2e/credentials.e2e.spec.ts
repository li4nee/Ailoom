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
  error: { code: string; details?: { path: string; message: string }[] };
}

function codeOf(body: unknown): string {
  return (body as ErrorBody).error.code;
}

interface CredentialBody {
  id: string;
  provider: string;
  label: string;
  secretLast4: string | null;
  baseUrl: string | null;
}

let emailSeq = 0;

function nextEmail(): string {
  emailSeq += 1;
  return `cred${String(emailSeq)}@example.com`;
}

describe('credentials', () => {
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

  function create(credential: Record<string, unknown>): ReturnType<AuthedClient['post']> {
    return owner.post(`/api/v1/workspaces/${workspaceId}/credentials`).send(credential);
  }

  it('creates, lists, tests and deletes a credential', async () => {
    const created = await create({ provider: 'mock', label: 'Mock', apiKey: 'sk-test-secret' });
    expect(created.status).toBe(201);
    const credential = created.body as CredentialBody;
    expect(credential).toMatchObject({
      provider: 'mock',
      label: 'Mock',
      secretLast4: 'cret',
      baseUrl: null,
    });

    const models = await owner.get(
      `/api/v1/workspaces/${workspaceId}/credentials/${credential.id}/models`,
    );
    expect(models.status).toBe(200);
    expect(models.body).toEqual([
      { id: 'mock-chat', kind: 'chat' },
      { id: 'mock-embed', kind: 'embedding' },
    ]);

    const tested = await owner.post(
      `/api/v1/workspaces/${workspaceId}/credentials/${credential.id}/test`,
    );
    expect(tested.status).toBe(200);
    expect(tested.body).toEqual({ ok: true });

    const used = await t.ds.query<{ last_used_at: Date | null }[]>(
      'SELECT last_used_at FROM provider_credentials WHERE id = $1',
      [credential.id],
    );
    expect(used[0]?.last_used_at).not.toBeNull();

    const list = await owner.get(`/api/v1/workspaces/${workspaceId}/credentials`);
    expect((list.body as CredentialBody[]).map((row) => row.id)).toEqual([credential.id]);

    const removed = await owner.delete(
      `/api/v1/workspaces/${workspaceId}/credentials/${credential.id}`,
    );
    expect(removed.status).toBe(204);
    expect((await owner.get(`/api/v1/workspaces/${workspaceId}/credentials`)).body).toEqual([]);
  });

  it('updates the label and re-seals a new key', async () => {
    const credential = (await create({ provider: 'openai', label: 'Prod', apiKey: 'sk-old-1111' }))
      .body as CredentialBody;

    const res = await owner
      .patch(`/api/v1/workspaces/${workspaceId}/credentials/${credential.id}`)
      .send({ label: 'Production', apiKey: 'sk-new-2222' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ label: 'Production', secretLast4: '2222' });
  });

  it('agents get 403 on credential routes', async () => {
    const { user: agent, password } = await createUser({ ds: t.ds }, { email: nextEmail() });
    await t.ds.query(
      "INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'agent')",
      [workspaceId, agent.id],
    );
    const agentClient = authed(t, await loginAs(t, agent, password));

    expect((await agentClient.get(`/api/v1/workspaces/${workspaceId}/credentials`)).status).toBe(
      403,
    );
    const createAttempt = await agentClient
      .post(`/api/v1/workspaces/${workspaceId}/credentials`)
      .send({ provider: 'mock', label: 'Nope', apiKey: 'sk-agent' });
    expect(createAttempt.status).toBe(403);
    expect(codeOf(createAttempt.body)).toBe('forbidden');
  });

  it('normalizes an unreachable localhost endpoint and explains what to do', async () => {
    const credential = (
      await create({ provider: 'ollama', label: 'Local', baseUrl: 'http://localhost:11434' })
    ).body as CredentialBody;

    const res = await owner.post(
      `/api/v1/workspaces/${workspaceId}/credentials/${credential.id}/test`,
    );

    expect(res.status).toBe(200);
    const body = res.body as { ok: boolean; code: string; hint: string | null };
    expect(body.ok).toBe(false);
    // The api's own loopback is always denied, and an unreachable host is connection_failed;
    // either way the admin must see a hint, never a raw error.
    expect(body.code).toMatch(/connection_failed|blocked_url/);
    expect(body.hint).toBeTruthy();

    const stored = await t.ds.query<{ last_error: string | null }[]>(
      'SELECT last_error FROM provider_credentials WHERE id = $1',
      [credential.id],
    );
    expect(stored[0]?.last_error).toBe(body.code);
  });

  it('blocks metadata addresses even when private URLs are allowed', async () => {
    const credential = (
      await create({
        provider: 'openai_compatible',
        label: 'Metadata',
        baseUrl: 'http://169.254.169.254',
      })
    ).body as CredentialBody;

    const res = await owner.post(
      `/api/v1/workspaces/${workspaceId}/credentials/${credential.id}/test`,
    );

    expect((res.body as { code: string }).code).toBe('blocked_url');
  });

  it('answers 409 when a live bot uses the credential', async () => {
    const chat = (await create({ provider: 'mock', label: 'Chat', apiKey: 'sk-chat' }))
      .body as CredentialBody;
    const embed = (await create({ provider: 'mock', label: 'Embed', apiKey: 'sk-embed' }))
      .body as CredentialBody;
    await insertBot(t, workspaceId, chat.id, embed.id, false);

    const res = await owner.delete(`/api/v1/workspaces/${workspaceId}/credentials/${chat.id}`);

    expect(res.status).toBe(409);
    expect(codeOf(res.body)).toBe('credential_in_use');
  });

  it('deletes a credential only a soft-deleted bot used', async () => {
    const chat = (await create({ provider: 'mock', label: 'Chat', apiKey: 'sk-chat' }))
      .body as CredentialBody;
    const embed = (await create({ provider: 'mock', label: 'Embed', apiKey: 'sk-embed' }))
      .body as CredentialBody;
    await insertBot(t, workspaceId, chat.id, embed.id, true);

    const res = await owner.delete(`/api/v1/workspaces/${workspaceId}/credentials/${chat.id}`);

    expect(res.status).toBe(204);
  });

  it('never returns a secret in any response', async () => {
    const created = await create({ provider: 'openai', label: 'Prod', apiKey: 'sk-test-secret' });
    const id = (created.body as CredentialBody).id;
    const list = await owner.get(`/api/v1/workspaces/${workspaceId}/credentials`);
    const patched = await owner
      .patch(`/api/v1/workspaces/${workspaceId}/credentials/${id}`)
      .send({ label: 'Renamed' });
    const models = await owner.get(`/api/v1/workspaces/${workspaceId}/credentials/${id}/models`);
    const tested = await owner.post(`/api/v1/workspaces/${workspaceId}/credentials/${id}/test`);

    const all = JSON.stringify([created.body, list.body, patched.body, models.body, tested.body]);
    expect(all).not.toContain('sk-test-secret');
    expect(all).not.toMatch(/secretCiphertext|secretIv|secretTag|"apiKey"/);
  });

  it('validates the provider shape', async () => {
    const res = await create({ provider: 'openai', label: 'No key' });

    expect(res.status).toBe(400);
    expect(codeOf(res.body)).toBe('validation_failed');
  });

  it('refuses to create a keyless provider without a base URL', async () => {
    const res = await create({ provider: 'ollama', label: 'No url' });

    expect(res.status).toBe(400);
    expect(codeOf(res.body)).toBe('validation_failed');
  });
});

/** Inserts a bot row directly; the bots API arrives in Task 2.8. */
async function insertBot(
  t: TestApp,
  workspaceId: string,
  chatCredentialId: string,
  embeddingCredentialId: string,
  deleted: boolean,
): Promise<void> {
  await t.ds.query(
    `INSERT INTO bots (workspace_id, name, public_key, chat_credential_id, chat_model,
                       embedding_credential_id, embedding_model, embedding_dim, no_answer_behavior,
                       deleted_at)
     VALUES ($1, 'Help', $2, $3, 'mock-chat', $4, 'bge-small-en-v1.5', 384, 'offer_handoff',
             CASE WHEN $5 THEN now() ELSE NULL END)`,
    [
      workspaceId,
      `pk_live_${Math.random().toString(36).slice(2)}`,
      chatCredentialId,
      embeddingCredentialId,
      deleted,
    ],
  );
}
