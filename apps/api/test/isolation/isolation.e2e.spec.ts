// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp, type TestApp } from '../helpers/app';
import { ISOLATION_EXEMPT, ISOLATION_FIXTURES } from './isolation-fixtures';
import { listRoutes } from './route-inventory';

function paramNames(path: string): string[] {
  return [...path.matchAll(/:([A-Za-z_]\w*)/g)].flatMap((m) => (m[1] === undefined ? [] : [m[1]]));
}

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp();
});

afterAll(async () => {
  await t.close();
});

describe('workspace isolation', () => {
  it('lists routes', () => {
    expect(listRoutes(t.app)).toEqual(
      expect.arrayContaining([{ method: 'GET', path: '/api/health/live' }]),
    );
  });

  it('covers every workspace-scoped route', () => {
    const uncovered = listRoutes(t.app)
      .filter((r) => r.path.startsWith('/api/v1/workspaces/:workspaceId'))
      .filter((r) => !ISOLATION_EXEMPT.some((e) => e.method === r.method && e.path === r.path))
      .flatMap((r) =>
        paramNames(r.path)
          .filter((p) => p !== 'workspaceId' && !(p in ISOLATION_FIXTURES))
          .map((p) => `${r.method} ${r.path} (:${p})`),
      );
    expect(uncovered).toEqual([]);
  });
});
