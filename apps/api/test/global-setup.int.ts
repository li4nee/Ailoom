// SPDX-License-Identifier: AGPL-3.0-only
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';
import type { TestProject } from 'vitest/node';

import { loadMigrations, testDataSourceOptions } from './helpers/db';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Connection string of the migrated Postgres container, for `inject('databaseUrl')`. */
    databaseUrl: string;
  }
}

/**
 * Runs once per Vitest run, before any integration or e2e test: starts one real Postgres 18
 * with pgvector, applies every migration, and shares the connection string with the workers.
 * Returns the teardown that stops the container.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const container = await new PostgreSqlContainer('pgvector/pgvector:pg18').start();
  try {
    const url = container.getConnectionUri();
    const ds = new DataSource(
      testDataSourceOptions(url, { entities: [], migrations: await loadMigrations() }),
    );
    await ds.initialize();
    try {
      await ds.runMigrations({ transaction: 'each' });
    } finally {
      await ds.destroy();
    }
    project.provide('databaseUrl', url);
  } catch (error) {
    await container.stop();
    throw error;
  }
  return async () => {
    await container.stop();
  };
}
