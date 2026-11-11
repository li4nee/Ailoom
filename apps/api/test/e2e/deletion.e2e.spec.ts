// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestApp, type TestApp } from '../helpers/app';
import { resetDatabase } from '../helpers/db';
import { addMember, authed, createUser, createWorkspace, loginAs } from '../helpers/factories';

interface ErrorBody {
  error: { code: string };
}

function codeOf(body: unknown): string {
  return (body as ErrorBody).error.code;
}

let emailSeq = 0;

function nextEmail(): string {
  emailSeq += 1;
  return `deletion${String(emailSeq)}@example.com`;
}

describe('workspace and account deletion', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  beforeEach(async () => {
    await resetDatabase(t.ds);
  });

  it('deleted workspace is immediately 404 for members', async () => {
    const { user: owner, password } = await createUser({ ds: t.ds }, { email: nextEmail() });
    const { user: agent, password: agentPassword } = await createUser(
      { ds: t.ds },
      { email: nextEmail() },
    );
    const ws = await createWorkspace(t, owner);
    await addMember(t, ws, agent, 'agent');
    const ownerClient = authed(t, await loginAs(t, owner, password));
    const agentClient = authed(t, await loginAs(t, agent, agentPassword));

    const res = await ownerClient.delete(`/api/v1/workspaces/${ws.id}`);

    expect(res.status).toBe(204);
    expect((await agentClient.get(`/api/v1/workspaces/${ws.id}`)).status).toBe(404);
    expect((await ownerClient.get(`/api/v1/workspaces/${ws.id}`)).status).toBe(404);
    expect((await ownerClient.get('/api/v1/workspaces')).body).toEqual([]);

    const jobs = await t.ds.query<{ data: { workspaceId: string } }[]>(
      "SELECT data FROM pgboss.job WHERE name = 'workspace.purge'",
    );
    expect(jobs.map((job) => job.data.workspaceId)).toEqual([ws.id]);
    const audit = await t.ds.query<{ action: string }[]>(
      "SELECT action FROM audit_log WHERE workspace_id = $1 AND action = 'workspace.deleted'",
      [ws.id],
    );
    expect(audit).toHaveLength(1);
  });

  it('only the owner can delete a workspace', async () => {
    const { user: owner } = await createUser({ ds: t.ds }, { email: nextEmail() });
    const { user: admin, password } = await createUser({ ds: t.ds }, { email: nextEmail() });
    const ws = await createWorkspace(t, owner);
    await addMember(t, ws, admin, 'admin');

    const res = await authed(t, await loginAs(t, admin, password)).delete(
      `/api/v1/workspaces/${ws.id}`,
    );

    expect(res.status).toBe(403);
    expect(codeOf(res.body)).toBe('forbidden');
  });

  it('sole owner cannot delete their account', async () => {
    const { user, password } = await createUser({ ds: t.ds }, { email: nextEmail() });
    await createWorkspace(t, user);

    const res = await authed(t, await loginAs(t, user, password))
      .delete('/api/v1/auth/me')
      .send({ password });

    expect(res.status).toBe(409);
    expect(codeOf(res.body)).toBe('sole_owner');
  });

  it('owner of only deleted workspaces can delete their account', async () => {
    const { user, password } = await createUser({ ds: t.ds }, { email: nextEmail() });
    const ws = await createWorkspace(t, user);
    await t.ds.query('UPDATE workspaces SET deleted_at = now() WHERE id = $1', [ws.id]);

    const res = await authed(t, await loginAs(t, user, password))
      .delete('/api/v1/auth/me')
      .send({ password });

    expect(res.status).toBe(204);
  });

  it('account deletion requires the password', async () => {
    const { user, password } = await createUser({ ds: t.ds }, { email: nextEmail() });

    const res = await authed(t, await loginAs(t, user, password))
      .delete('/api/v1/auth/me')
      .send({ password: 'not the password' });

    expect(res.status).toBe(401);
    expect(codeOf(res.body)).toBe('invalid_credentials');
  });

  it('deletes the account, its memberships and sessions, and clears cookies', async () => {
    const { user: owner } = await createUser({ ds: t.ds }, { email: nextEmail() });
    const { user, password } = await createUser({ ds: t.ds }, { email: nextEmail() });
    const ws = await createWorkspace(t, owner);
    await addMember(t, ws, user, 'agent');
    const client = authed(t, await loginAs(t, user, password));

    const res = await client.delete('/api/v1/auth/me').send({ password });

    expect(res.status).toBe(204);
    expect(res.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringMatching(/^__Host-at=;.*Max-Age=0$/)]),
    );
    expect((await client.get('/api/v1/auth/me')).status).toBe(401);
    const left = await t.ds.query<{ n: number }[]>(
      `SELECT (SELECT count(*) FROM users WHERE id = $1)
            + (SELECT count(*) FROM memberships WHERE user_id = $1)
            + (SELECT count(*) FROM auth_sessions WHERE user_id = $1) AS n`,
      [user.id],
    );
    expect(Number(left[0]?.n)).toBe(0);
  });

  it('deleted users show as null author on messages', async () => {
    const { user: owner } = await createUser({ ds: t.ds }, { email: nextEmail() });
    const { user, password } = await createUser({ ds: t.ds }, { email: nextEmail() });
    const ws = await createWorkspace(t, owner);
    await addMember(t, ws, user, 'agent');
    const [credential] = await t.ds.query<{ id: string }[]>(
      `INSERT INTO provider_credentials (workspace_id, provider, label)
       VALUES ($1, 'mock', 'Mock') RETURNING id`,
      [ws.id],
    );
    const [bot] = await t.ds.query<{ id: string }[]>(
      `INSERT INTO bots (workspace_id, name, public_key, chat_credential_id, chat_model,
                         embedding_credential_id, embedding_model, embedding_dim)
       VALUES ($1, 'Bot', 'pk_deletion', $2, 'm', $2, 'e', 384) RETURNING id`,
      [ws.id, credential?.id],
    );
    const [contact] = await t.ds.query<{ id: string }[]>(
      'INSERT INTO contacts (workspace_id) VALUES ($1) RETURNING id',
      [ws.id],
    );
    const [conversation] = await t.ds.query<{ id: string }[]>(
      'INSERT INTO conversations (workspace_id, bot_id, contact_id) VALUES ($1, $2, $3) RETURNING id',
      [ws.id, bot?.id, contact?.id],
    );
    const [message] = await t.ds.query<{ id: string }[]>(
      `INSERT INTO messages (workspace_id, conversation_id, role, content, author_user_id)
       VALUES ($1, $2, 'agent', 'On it.', $3) RETURNING id`,
      [ws.id, conversation?.id, user.id],
    );

    const res = await authed(t, await loginAs(t, user, password))
      .delete('/api/v1/auth/me')
      .send({ password });

    expect(res.status).toBe(204);
    const rows = await t.ds.query<{ author_user_id: string | null; content: string }[]>(
      'SELECT author_user_id, content FROM messages WHERE id = $1',
      [message?.id],
    );
    expect(rows).toEqual([{ author_user_id: null, content: 'On it.' }]);
  });
});
