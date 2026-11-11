// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { UserEntity } from '../../src/modules/auth/entities/user.entity';
import type { WorkspaceEntity } from '../../src/modules/workspaces/entities/workspace.entity';
import { createTestApp, type TestApp } from '../helpers/app';
import { resetDatabase } from '../helpers/db';
import {
  addMember,
  authed,
  type AuthedClient,
  createUser,
  createWorkspace,
  loginAs,
} from '../helpers/factories';

interface ErrorBody {
  error: { code: string };
}

function codeOf(body: unknown): string {
  return (body as ErrorBody).error.code;
}

let emailSeq = 0;

function nextEmail(): string {
  emailSeq += 1;
  return `member${String(emailSeq)}@example.com`;
}

describe('invitations and members', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({
      config: {
        email: {
          transport: 'smtp',
          host: '127.0.0.1',
          port: 2525,
          user: null,
          pass: null,
          secure: false,
          from: 'test@example.com',
        },
      },
    });
  });

  afterAll(async () => {
    await t.close();
  });

  beforeEach(async () => {
    await resetDatabase(t.ds);
  });

  interface Member {
    user: UserEntity;
    client: AuthedClient;
  }

  async function member(email = nextEmail()): Promise<Member> {
    const { user, password } = await createUser({ ds: t.ds }, { email });
    return { user, client: authed(t, await loginAs(t, user, password)) };
  }

  async function workspaceWith(
    roles: ('admin' | 'agent')[] = [],
  ): Promise<{ ws: WorkspaceEntity; owner: Member; others: Member[] }> {
    const owner = await member();
    const ws = await createWorkspace(t, owner.user);
    const others: Member[] = [];
    for (const role of roles) {
      const next = await member();
      await addMember(t, ws, next.user, role);
      others.push(next);
    }
    return { ws, owner, others };
  }

  /** The token of the latest invitation email queued for `to`. */
  async function invitationToken(to: string): Promise<string> {
    const rows = await t.ds.query<{ data: { to: string; data: { token: string } } }[]>(
      `SELECT data FROM pgboss.job
        WHERE name = 'email.send' AND data->>'template' = 'invitation' AND data->>'to' = $1
        ORDER BY created_on DESC LIMIT 1`,
      [to],
    );
    const token = rows[0]?.data.data.token;
    if (token === undefined) throw new Error(`no invitation email for ${to}`);
    return token;
  }

  async function roleOf(ws: WorkspaceEntity, userId: string): Promise<string | undefined> {
    const rows = await t.ds.query<{ role: string }[]>(
      'SELECT role FROM memberships WHERE workspace_id = $1 AND user_id = $2',
      [ws.id, userId],
    );
    return rows[0]?.role;
  }

  it('admin invites; email contains the accept link', async () => {
    const { ws, others } = await workspaceWith(['admin']);
    const [admin] = others;
    if (admin === undefined) throw new Error('no admin');

    const res = await admin.client
      .post(`/api/v1/workspaces/${ws.id}/invitations`)
      .send({ email: 'bob@example.com', role: 'agent' });

    expect(res.status).toBe(201);
    const token = await invitationToken('bob@example.com');
    const body = res.body as { email: string; role: string; acceptUrl: string };
    expect(body).toMatchObject({ email: 'bob@example.com', role: 'agent' });
    expect(body.acceptUrl).toBe(
      `http://localhost:3000/invitations/accept?token=${encodeURIComponent(token)}`,
    );

    const list = await admin.client.get(`/api/v1/workspaces/${ws.id}/invitations`);
    expect(list.status).toBe(200);
    expect((list.body as { email: string }[]).map((row) => row.email)).toEqual(['bob@example.com']);
    expect(JSON.stringify(list.body)).not.toContain(token);
  });

  it('agent cannot invite', async () => {
    const { ws, others } = await workspaceWith(['agent']);
    const [agent] = others;
    if (agent === undefined) throw new Error('no agent');

    const res = await agent.client
      .post(`/api/v1/workspaces/${ws.id}/invitations`)
      .send({ email: 'bob@example.com', role: 'agent' });

    expect(res.status).toBe(403);
    expect(codeOf(res.body)).toBe('forbidden');
  });

  it('cannot invite with role owner', async () => {
    const { ws, owner } = await workspaceWith();

    const res = await owner.client
      .post(`/api/v1/workspaces/${ws.id}/invitations`)
      .send({ email: 'bob@example.com', role: 'owner' });

    expect(res.status).toBe(400);
    expect(codeOf(res.body)).toBe('validation_failed');
  });

  it('accepting requires the invited email (case-insensitive)', async () => {
    const { ws, owner } = await workspaceWith();
    await owner.client
      .post(`/api/v1/workspaces/${ws.id}/invitations`)
      .send({ email: ' BOB@example.com ', role: 'agent' });
    const token = await invitationToken('BOB@example.com');
    const stranger = await member();
    const bob = await member('bob@Example.com');

    const wrong = await stranger.client.post('/api/v1/invitations/accept').send({ token });
    expect(wrong.status).toBe(403);
    expect(codeOf(wrong.body)).toBe('invalid_token');

    const res = await bob.client.post('/api/v1/invitations/accept').send({ token });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ workspaceId: ws.id, role: 'agent' });
    expect(await roleOf(ws, bob.user.id)).toBe('agent');

    const again = await bob.client.post('/api/v1/invitations/accept').send({ token });
    expect(codeOf(again.body)).toBe('invalid_token');
  });

  it('re-inviting replaces the previous token', async () => {
    const { ws, owner } = await workspaceWith();
    const invite = (): Promise<unknown> =>
      owner.client
        .post(`/api/v1/workspaces/${ws.id}/invitations`)
        .send({ email: 'bob@example.com', role: 'agent' });
    await invite();
    const oldToken = await invitationToken('bob@example.com');
    await invite();
    const bob = await member('bob@example.com');

    const res = await bob.client.post('/api/v1/invitations/accept').send({ token: oldToken });

    expect(res.status).toBe(400);
    expect(codeOf(res.body)).toBe('invalid_token');
    const list = await owner.client.get(`/api/v1/workspaces/${ws.id}/invitations`);
    expect(list.body as unknown[]).toHaveLength(1);
  });

  it('expired invitations fail', async () => {
    const { ws, owner } = await workspaceWith();
    await owner.client
      .post(`/api/v1/workspaces/${ws.id}/invitations`)
      .send({ email: 'bob@example.com', role: 'agent' });
    const token = await invitationToken('bob@example.com');
    const expiry = await t.ds.query<{ days: number }[]>(
      `SELECT round(extract(epoch FROM expires_at - now()) / 86400)::int AS days
         FROM invitations WHERE workspace_id = $1`,
      [ws.id],
    );
    expect(expiry[0]?.days).toBe(7);
    await t.ds.query(
      "UPDATE invitations SET expires_at = now() - interval '1 second' WHERE workspace_id = $1",
      [ws.id],
    );
    const bob = await member('bob@example.com');

    const res = await bob.client.post('/api/v1/invitations/accept').send({ token });

    expect(res.status).toBe(410);
    expect(codeOf(res.body)).toBe('token_expired');
  });

  it('admin revokes an invitation', async () => {
    const { ws, owner } = await workspaceWith();
    const created = await owner.client
      .post(`/api/v1/workspaces/${ws.id}/invitations`)
      .send({ email: 'bob@example.com', role: 'agent' });
    const token = await invitationToken('bob@example.com');
    const { id } = created.body as { id: string };

    const res = await owner.client.delete(`/api/v1/workspaces/${ws.id}/invitations/${id}`);

    expect(res.status).toBe(204);
    const bob = await member('bob@example.com');
    const accept = await bob.client.post('/api/v1/invitations/accept').send({ token });
    expect(codeOf(accept.body)).toBe('invalid_token');
  });

  it('admin changes agent → admin; cannot touch the owner', async () => {
    const { ws, owner, others } = await workspaceWith(['admin', 'agent']);
    const [admin, agent] = others;
    if (admin === undefined || agent === undefined) throw new Error('missing members');

    const promote = await admin.client
      .patch(`/api/v1/workspaces/${ws.id}/members/${agent.user.id}`)
      .send({ role: 'admin' });
    expect(promote.status).toBe(200);
    expect(await roleOf(ws, agent.user.id)).toBe('admin');

    const touchOwner = await admin.client
      .patch(`/api/v1/workspaces/${ws.id}/members/${owner.user.id}`)
      .send({ role: 'agent' });
    expect(touchOwner.status).toBe(403);
    expect(codeOf(touchOwner.body)).toBe('cannot_modify_owner');

    const removeOwner = await admin.client.delete(
      `/api/v1/workspaces/${ws.id}/members/${owner.user.id}`,
    );
    expect(removeOwner.status).toBe(403);
    expect(codeOf(removeOwner.body)).toBe('cannot_modify_owner');
  });

  it('cannot set role owner via PATCH', async () => {
    const { ws, owner, others } = await workspaceWith(['agent']);
    const [agent] = others;
    if (agent === undefined) throw new Error('no agent');

    const res = await owner.client
      .patch(`/api/v1/workspaces/${ws.id}/members/${agent.user.id}`)
      .send({ role: 'owner' });

    expect(res.status).toBe(400);
    expect(codeOf(res.body)).toBe('validation_failed');
  });

  it('admin removes an agent; removed user gets 404 next request', async () => {
    const { ws, others } = await workspaceWith(['admin', 'agent']);
    const [admin, agent] = others;
    if (admin === undefined || agent === undefined) throw new Error('missing members');
    expect((await agent.client.get(`/api/v1/workspaces/${ws.id}`)).status).toBe(200);

    const res = await admin.client.delete(`/api/v1/workspaces/${ws.id}/members/${agent.user.id}`);

    expect(res.status).toBe(204);
    const after = await agent.client.get(`/api/v1/workspaces/${ws.id}`);
    expect(after.status).toBe(404);
    expect(codeOf(after.body)).toBe('not_found');
  });

  it('owner transfers ownership; old owner becomes admin', async () => {
    const { ws, owner, others } = await workspaceWith(['agent']);
    const [agent] = others;
    if (agent === undefined) throw new Error('no agent');

    const res = await owner.client
      .post(`/api/v1/workspaces/${ws.id}/transfer-ownership`)
      .send({ userId: agent.user.id });

    expect(res.status).toBe(204);
    expect(await roleOf(ws, agent.user.id)).toBe('owner');
    expect(await roleOf(ws, owner.user.id)).toBe('admin');
    const audit = await t.ds.query<{ action: string; metadata: Record<string, unknown> }[]>(
      "SELECT action, metadata FROM audit_log WHERE workspace_id = $1 AND action LIKE 'workspace.%'",
      [ws.id],
    );
    expect(audit).toEqual([
      {
        action: 'workspace.ownership_transferred',
        metadata: { fromUserId: owner.user.id, toUserId: agent.user.id },
      },
    ]);
  });

  it('only the owner can transfer ownership', async () => {
    const { ws, others } = await workspaceWith(['admin', 'agent']);
    const [admin, agent] = others;
    if (admin === undefined || agent === undefined) throw new Error('missing members');

    const res = await admin.client
      .post(`/api/v1/workspaces/${ws.id}/transfer-ownership`)
      .send({ userId: agent.user.id });

    expect(res.status).toBe(403);
    expect(codeOf(res.body)).toBe('forbidden');
  });

  it('owner cannot remove or demote themselves', async () => {
    const { ws, owner } = await workspaceWith();

    const demote = await owner.client
      .patch(`/api/v1/workspaces/${ws.id}/members/${owner.user.id}`)
      .send({ role: 'admin' });
    expect(demote.status).toBe(409);
    expect(codeOf(demote.body)).toBe('sole_owner');

    const leave = await owner.client.delete(`/api/v1/workspaces/${ws.id}/members/${owner.user.id}`);
    expect(leave.status).toBe(409);
    expect(codeOf(leave.body)).toBe('sole_owner');
    expect(await roleOf(ws, owner.user.id)).toBe('owner');
  });

  it('transfer target must be a member', async () => {
    const { ws, owner } = await workspaceWith();
    const outsider = await member();

    const res = await owner.client
      .post(`/api/v1/workspaces/${ws.id}/transfer-ownership`)
      .send({ userId: outsider.user.id });

    expect(res.status).toBe(404);
    expect(codeOf(res.body)).toBe('not_found');
  });

  it('records audit entries for invite, role change and removal', async () => {
    const { ws, owner, others } = await workspaceWith(['agent']);
    const [agent] = others;
    if (agent === undefined) throw new Error('no agent');

    await owner.client
      .post(`/api/v1/workspaces/${ws.id}/invitations`)
      .send({ email: 'bob@example.com', role: 'agent' });
    await owner.client
      .patch(`/api/v1/workspaces/${ws.id}/members/${agent.user.id}`)
      .send({ role: 'admin' });
    await owner.client.delete(`/api/v1/workspaces/${ws.id}/members/${agent.user.id}`);

    const rows = await t.ds.query<{ action: string }[]>(
      'SELECT action FROM audit_log WHERE workspace_id = $1 ORDER BY created_at, id',
      [ws.id],
    );
    expect(rows.map((row) => row.action)).toEqual([
      'member.invited',
      'member.role_changed',
      'member.removed',
    ]);
  });

  it('previews an invitation by token without signing in', async () => {
    const { ws, owner } = await workspaceWith();
    await owner.client
      .post(`/api/v1/workspaces/${ws.id}/invitations`)
      .send({ email: 'bob@example.com', role: 'admin' });
    const token = await invitationToken('bob@example.com');
    const fetchHeaders = { 'X-Requested-With': 'fetch', Origin: 'http://localhost:3000' };

    const res = await t.http
      .get(`/api/v1/invitations/preview?token=${encodeURIComponent(token)}`)
      .set(fetchHeaders);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ workspaceName: ws.name, role: 'admin', email: 'bob@example.com' });

    const bad = await t.http.get('/api/v1/invitations/preview?token=nope').set(fetchHeaders);
    expect(bad.status).toBe(400);
    expect(codeOf(bad.body)).toBe('invalid_token');
  });
});
