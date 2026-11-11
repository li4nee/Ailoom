// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestApp, type TestApp } from '../helpers/app';
import { resetDatabase } from '../helpers/db';
import { addMember, authed, createUser, createWorkspace, loginAs } from '../helpers/factories';

interface ErrorBody {
  error: { code: string; details?: { path: string; message: string }[] };
}

function codeOf(body: unknown): string {
  return (body as ErrorBody).error.code;
}

let emailSeq = 0;

function nextEmail(): string {
  emailSeq += 1;
  return `user${String(emailSeq)}@example.com`;
}

describe('workspaces', () => {
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

  it('creates a workspace with the creator as owner', async () => {
    const { user, password } = await createUser({ ds: t.ds }, { email: nextEmail() });
    const cookies = await loginAs(t, user, password);

    const res = await authed(t, cookies).post('/api/v1/workspaces').send({ name: 'Acme Inc.' });

    expect(res.status).toBe(201);
    const body = res.body as { id: string; name: string; slug: string; settings: unknown };
    expect(body.name).toBe('Acme Inc.');
    expect(body.slug).toMatch(/^acme-inc-[a-z0-9]{4}$/);
    expect(body.settings).toEqual({ notificationEmails: [] });

    const memberships = await t.ds.query<{ role: string }[]>(
      'SELECT role FROM memberships WHERE workspace_id = $1 AND user_id = $2',
      [body.id, user.id],
    );
    expect(memberships.map((row) => row.role)).toEqual(['owner']);

    const audit = await t.ds.query<{ action: string }[]>(
      'SELECT action FROM audit_log WHERE workspace_id = $1',
      [body.id],
    );
    expect(audit.map((row) => row.action)).toEqual(['workspace.created']);
  });

  it('requires a verified email', async () => {
    const { user, password } = await createUser(
      { ds: t.ds },
      { email: nextEmail(), verified: false },
    );
    const cookies = await loginAs(t, user, password);

    const res = await authed(t, cookies).post('/api/v1/workspaces').send({ name: 'Acme' });

    expect(res.status).toBe(403);
    expect(codeOf(res.body)).toBe('email_not_verified');
  });

  it('lists only my workspaces', async () => {
    const { user: alice, password } = await createUser({ ds: t.ds }, { email: nextEmail() });
    const { user: bob } = await createUser({ ds: t.ds }, { email: nextEmail() });
    const first = await createWorkspace(t, alice, 'First');
    const second = await createWorkspace(t, alice, 'Second');
    await createWorkspace(t, bob, 'Bobs');
    const cookies = await loginAs(t, alice, password);

    const res = await authed(t, cookies).get('/api/v1/workspaces');

    expect(res.status).toBe(200);
    const rows = res.body as { id: string; role: string }[];
    expect(rows.map((row) => row.id).sort()).toEqual([first.id, second.id].sort());
    expect(rows.every((row) => row.role === 'owner')).toBe(true);
  });

  it('agents can read but not update', async () => {
    const { user: owner } = await createUser({ ds: t.ds }, { email: nextEmail() });
    const { user: agent, password } = await createUser({ ds: t.ds }, { email: nextEmail() });
    const workspace = await createWorkspace(t, owner, 'Acme');
    await addMember(t, workspace, agent, 'agent');
    const cookies = await loginAs(t, agent, password);

    expect((await authed(t, cookies).get(`/api/v1/workspaces/${workspace.id}`)).status).toBe(200);
    const update = await authed(t, cookies)
      .patch(`/api/v1/workspaces/${workspace.id}`)
      .send({ name: 'Renamed' });
    expect(update.status).toBe(403);
  });

  it('validates notification emails', async () => {
    const { user, password } = await createUser({ ds: t.ds }, { email: nextEmail() });
    const workspace = await createWorkspace(t, user, 'Acme');
    const cookies = await loginAs(t, user, password);

    const res = await authed(t, cookies)
      .patch(`/api/v1/workspaces/${workspace.id}`)
      .send({ settings: { notificationEmails: ['not-an-email'] } });

    expect(res.status).toBe(400);
    expect(codeOf(res.body)).toBe('validation_failed');
    expect((res.body as ErrorBody).error.details?.[0]?.path).toBe('settings.notificationEmails.0');
  });

  it('updates name and settings', async () => {
    const { user, password } = await createUser({ ds: t.ds }, { email: nextEmail() });
    const workspace = await createWorkspace(t, user, 'Acme');
    const cookies = await loginAs(t, user, password);

    const res = await authed(t, cookies)
      .patch(`/api/v1/workspaces/${workspace.id}`)
      .send({ name: 'Acme Support', settings: { notificationEmails: ['ops@acme.test'] } });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: workspace.id,
      name: 'Acme Support',
      settings: { notificationEmails: ['ops@acme.test'] },
    });
  });

  it('members list hides password hashes and token versions', async () => {
    const { user: owner, password } = await createUser({ ds: t.ds }, { email: nextEmail() });
    const { user: admin } = await createUser({ ds: t.ds }, { email: nextEmail() });
    const { user: agent } = await createUser({ ds: t.ds }, { email: nextEmail() });
    const workspace = await createWorkspace(t, owner, 'Acme');
    await addMember(t, workspace, admin, 'admin');
    await addMember(t, workspace, agent, 'agent');
    const cookies = await loginAs(t, owner, password);

    const res = await authed(t, cookies).get(`/api/v1/workspaces/${workspace.id}/members`);

    expect(res.status).toBe(200);
    const members = res.body as { userId: string; role: string }[];
    expect(members.map((member) => member.role)).toEqual(['owner', 'admin', 'agent']);
    expect(JSON.stringify(members)).not.toMatch(/argon2|tokenVersion|password/i);
  });

  it('returns 404 to non-members', async () => {
    const { user: owner } = await createUser({ ds: t.ds }, { email: nextEmail() });
    const { user: outsider, password } = await createUser({ ds: t.ds }, { email: nextEmail() });
    const workspace = await createWorkspace(t, owner, 'Acme');
    const cookies = await loginAs(t, outsider, password);

    const res = await authed(t, cookies).get(`/api/v1/workspaces/${workspace.id}`);

    expect(res.status).toBe(404);
  });
});
