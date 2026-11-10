// SPDX-License-Identifier: AGPL-3.0-only
import { Controller, Get } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Role } from '@app/shared';

import { SystemClock } from '../../src/common/clock';
import { asUserId } from '../../src/db/ids';
import { CurrentPrincipal, Public, RequireRole } from '../../src/modules/auth/decorators';
import type { Principal } from '../../src/modules/auth/principal';
import { TokenService } from '../../src/modules/auth/token.service';
import { MembershipEntity } from '../../src/modules/workspaces/entities/membership.entity';
import { WorkspaceEntity } from '../../src/modules/workspaces/entities/workspace.entity';
import { createTestApp, type TestApp } from '../helpers/app';
import { resetDatabase } from '../helpers/db';
import { createUser } from '../helpers/factories';

@Controller('__t')
class PrincipalController {
  @Get('me')
  me(@CurrentPrincipal() principal: Principal): { userId: string; workspace: string | null } {
    return { userId: principal.userId, workspace: principal.workspace?.id ?? null };
  }

  @Public()
  @Get('public')
  publicRoute(): { ok: true } {
    return { ok: true };
  }
}

@Controller('v1/workspaces/:workspaceId/__t')
class WorkspaceController {
  @Get()
  workspace(@CurrentPrincipal() principal: Principal): { role: string | null } {
    return { role: principal.workspace?.role ?? null };
  }

  @RequireRole('admin')
  @Get('admin-only')
  adminOnly(): { ok: true } {
    return { ok: true };
  }

  @Get('noop')
  noop(): { ok: true } {
    return { ok: true };
  }
}

interface ErrorBody {
  error: { code: string };
}

function codeOf(body: unknown): string {
  return (body as ErrorBody).error.code;
}

async function accessToken(t: TestApp, userId: string): Promise<string> {
  const tokens = new TokenService(t.config, new SystemClock());
  const rows = await t.ds.query<{ token_version: number }[]>(
    'SELECT token_version FROM users WHERE id = $1',
    [userId],
  );
  const version = rows[0]?.token_version;
  if (version === undefined) throw new Error(`no user ${userId}`);
  return tokens.issueAccess({
    userId: asUserId(userId),
    sessionId: '0190a000-0000-7000-8000-0000000000ff',
    tokenVersion: version,
  });
}

function authed(
  t: TestApp,
  token: string,
): { get: (path: string) => ReturnType<TestApp['http']['get']> } {
  return {
    get: (path: string) => t.http.get(path).set('Cookie', `__Host-at=${token}`),
  };
}

async function seedWorkspace(t: TestApp, name: string): Promise<string> {
  const repository = t.ds.getRepository(WorkspaceEntity);
  const result = await repository.insert({ name, slug: name.toLowerCase() });
  const id = (result.identifiers[0] as { id: string }).id;
  return id;
}

async function addMember(
  t: TestApp,
  workspaceId: string,
  userId: string,
  role: Role,
): Promise<void> {
  await t.ds.getRepository(MembershipEntity).insert({ workspaceId, userId, role });
}

describe('AccessGuard', () => {
  let t: TestApp;
  let workspaceId: string;

  beforeAll(async () => {
    t = await createTestApp({
      controllers: [PrincipalController, WorkspaceController],
    });
  });

  afterAll(async () => {
    await t.close();
  });

  beforeEach(async () => {
    await resetDatabase(t.ds);
    workspaceId = await seedWorkspace(t, 'Acme');
  });

  it('401 without a cookie', async () => {
    const res = await t.http.get('/api/__t/me');

    expect(res.status).toBe(401);
    expect(codeOf(res.body)).toBe('unauthorized');
  });

  it('lets @Public routes through', async () => {
    const res = await t.http.get('/api/__t/public');

    expect(res.status).toBe(200);
  });

  it('401 session_revoked when token_version changed', async () => {
    const { user } = await createUser({ ds: t.ds });
    const token = await accessToken(t, user.id);
    await t.ds.query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [user.id]);

    const res = await authed(t, token).get('/api/__t/me');

    expect(res.status).toBe(401);
    expect(codeOf(res.body)).toBe('session_revoked');
  });

  it('404 for non-members', async () => {
    const { user: owner } = await createUser({ ds: t.ds }, { email: 'owner@example.com' });
    const { user: outsider } = await createUser({ ds: t.ds }, { email: 'outsider@example.com' });
    await addMember(t, workspaceId, owner.id, 'owner');
    const token = await accessToken(t, outsider.id);

    const res = await authed(t, token).get(`/api/v1/workspaces/${workspaceId}/__t`);

    expect(res.status).toBe(404);
  });

  it('404 for malformed workspace ids', async () => {
    const { user } = await createUser({ ds: t.ds });
    const token = await accessToken(t, user.id);

    const res = await authed(t, token).get('/api/v1/workspaces/not-a-uuid/__t');

    expect(res.status).toBe(404);
  });

  it('404 for deleted workspaces', async () => {
    const { user } = await createUser({ ds: t.ds });
    await addMember(t, workspaceId, user.id, 'owner');
    await t.ds.query('UPDATE workspaces SET deleted_at = now() WHERE id = $1', [workspaceId]);
    const token = await accessToken(t, user.id);

    const res = await authed(t, token).get(`/api/v1/workspaces/${workspaceId}/__t`);

    expect(res.status).toBe(404);
  });

  it('403 when role is too low', async () => {
    const { user } = await createUser({ ds: t.ds });
    await addMember(t, workspaceId, user.id, 'agent');
    const token = await accessToken(t, user.id);

    const res = await authed(t, token).get(`/api/v1/workspaces/${workspaceId}/__t/admin-only`);

    expect(res.status).toBe(403);
  });

  it('owner satisfies admin', async () => {
    const { user } = await createUser({ ds: t.ds });
    await addMember(t, workspaceId, user.id, 'owner');
    const token = await accessToken(t, user.id);

    const res = await authed(t, token).get(`/api/v1/workspaces/${workspaceId}/__t/admin-only`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('exposes the workspace and role on the principal', async () => {
    const { user } = await createUser({ ds: t.ds });
    await addMember(t, workspaceId, user.id, 'admin');
    const token = await accessToken(t, user.id);

    const res = await authed(t, token).get(`/api/v1/workspaces/${workspaceId}/__t`);

    expect(res.body).toEqual({ role: 'admin' });
  });

  it('runs exactly one query per request', async () => {
    const { user } = await createUser({ ds: t.ds });
    await addMember(t, workspaceId, user.id, 'owner');
    const token = await accessToken(t, user.id);
    const spy = vi.spyOn(t.ds, 'query');

    await authed(t, token).get(`/api/v1/workspaces/${workspaceId}/__t/noop`);

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
