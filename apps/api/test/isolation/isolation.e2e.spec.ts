// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/common/config';
import { createTestApp, type TestApp } from '../helpers/app';
import { getTestDataSource } from '../helpers/db';
import { ISOLATION_EXEMPT, ISOLATION_FIXTURES } from './isolation-fixtures';
import { listRoutes } from './route-inventory';

function paramNames(path: string): string[] {
  const names: string[] = [];
  const regex = /:([A-Za-z_][A-Za-z0-9_]*)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(path)) !== null) {
    names.push(match[1]);
  }
  return names;
}

const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  PUBLIC_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgres://app:app@localhost:5432/app',
  AUTH_SECRET: 'a'.repeat(32),
  WIDGET_SECRET: 'w'.repeat(32),
  ENCRYPTION_KEYS: `v1:${'ab'.repeat(32)}`,
  LOG_LEVEL: 'error',
};

describe('isolation', () => {
  let t: TestApp;

  beforeAll(async () => {
    const config = loadConfig(TEST_ENV);
    const databaseUrl = (await getTestDataSource()).options.url as string;
    const testConfig = {
      ...config,
      database: { ...config.database, url: databaseUrl, listenUrl: databaseUrl },
    };
    t = await createTestApp({ config: testConfig });
  });

  afterAll(async () => {
    await t.close();
  });

  it('lists routes', () => {
    const routes = listRoutes(t.app);
    expect(routes).toEqual(expect.arrayContaining([{ method: 'GET', path: '/api/health/live' }]));
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
