// SPDX-License-Identifier: AGPL-3.0-only
import type { Test } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp, type TestApp } from '../helpers/app';
import { resetDatabase } from '../helpers/db';
import { authed } from '../helpers/factories';
import { buildIsolationContext } from './isolation-context';
import {
  BODY_REFERENCES,
  ISOLATION_BODIES,
  ISOLATION_EXEMPT,
  ISOLATION_FIXTURES,
  type IsolationContext,
} from './isolation-fixtures';
import { listRoutes, type Route } from './route-inventory';

function paramNames(path: string): string[] {
  return [...path.matchAll(/:([A-Za-z_]\w*)/g)].flatMap((m) => (m[1] === undefined ? [] : [m[1]]));
}

function fill(path: string, values: Record<string, string>): string {
  return path.replace(/:([A-Za-z_]\w*)/g, (_, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`no value for :${name} in ${path}`);
    return value;
  });
}

let t: TestApp;
let ctx: IsolationContext;
let idsA: Record<string, string>;
let workspaceRoutes: Route[];

beforeAll(async () => {
  t = await createTestApp();
  await resetDatabase(t.ds);
  ctx = await buildIsolationContext(t);
  idsA = {};
  for (const [name, fixture] of Object.entries(ISOLATION_FIXTURES)) idsA[name] = await fixture(ctx);
  workspaceRoutes = listRoutes(t.app)
    .filter((r) => r.path.startsWith('/api/v1/workspaces/:workspaceId'))
    .filter((r) => !ISOLATION_EXEMPT.some((e) => e.method === r.method && e.path === r.path));
});

afterAll(async () => {
  await t.close();
});

function call(route: Route, workspaceId: string): Test {
  const client = authed(t, ctx.cookiesB);
  const path = fill(route.path, { ...idsA, workspaceId });
  const key = `${route.method} ${route.path}`;
  const body = ISOLATION_BODIES[key]?.(idsA);
  let request: Test;
  switch (route.method) {
    case 'GET':
      request = client.get(path);
      break;
    case 'POST':
      request = client.post(path);
      break;
    case 'PATCH':
      request = client.patch(path);
      break;
    case 'PUT':
      request = client.put(path);
      break;
    case 'DELETE':
      request = client.delete(path);
      break;
    default:
      throw new Error(`unsupported method ${route.method}`);
  }
  return body === undefined ? request : request.send(body as object);
}

describe('workspace isolation', () => {
  it('lists routes', () => {
    expect(listRoutes(t.app)).toEqual(
      expect.arrayContaining([{ method: 'GET', path: '/api/health/live' }]),
    );
  });

  it('covers every workspace-scoped route', () => {
    const uncovered = workspaceRoutes.flatMap((r) =>
      paramNames(r.path)
        .filter((p) => p !== 'workspaceId' && !(p in ISOLATION_FIXTURES))
        .map((p) => `${r.method} ${r.path} (:${p})`),
    );
    expect(uncovered).toEqual([]);
  });

  it("answers 404 to B's owner for every route under A's workspace id", async () => {
    const leaks: string[] = [];
    for (const route of workspaceRoutes) {
      const res = await call(route, ctx.wsA);
      if (res.status !== 404) leaks.push(`${route.method} ${route.path} → ${String(res.status)}`);
    }
    expect(leaks).toEqual([]);
  });

  it("answers 404 when B's own workspace id is combined with A's resource ids", async () => {
    const leaks: string[] = [];
    const withResource = workspaceRoutes.filter(
      (r) =>
        paramNames(r.path).some((p) => p !== 'workspaceId') ||
        BODY_REFERENCES.has(`${r.method} ${r.path}`),
    );
    expect(withResource.length).toBeGreaterThan(0);
    for (const route of withResource) {
      const res = await call(route, ctx.wsB);
      if (res.status !== 404) leaks.push(`${route.method} ${route.path} → ${String(res.status)}`);
    }
    expect(leaks).toEqual([]);
  });

  it('leaves workspace A untouched and never lists it to B', async () => {
    const rows = await t.ds.query<{ name: string; deleted: boolean }[]>(
      'SELECT name, deleted_at IS NOT NULL AS deleted FROM workspaces WHERE id = $1',
      [ctx.wsA],
    );
    expect(rows).toEqual([{ name: 'Workspace A', deleted: false }]);
    const members = await t.ds.query<{ user_id: string; role: string }[]>(
      'SELECT user_id, role FROM memberships WHERE workspace_id = $1 ORDER BY role',
      [ctx.wsA],
    );
    expect(members).toEqual([
      { user_id: ctx.userA.id, role: 'owner' },
      { user_id: idsA['userId'], role: 'agent' },
    ]);
    const invitations = await t.ds.query<{ id: string }[]>(
      'SELECT id FROM invitations WHERE workspace_id = $1',
      [ctx.wsA],
    );
    expect(invitations.map((row) => row.id)).toEqual([idsA['invitationId']]);

    const list = await authed(t, ctx.cookiesB).get('/api/v1/workspaces');
    expect((list.body as { id: string }[]).map((w) => w.id)).toEqual([ctx.wsB]);
  });
});
