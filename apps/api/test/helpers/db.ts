// SPDX-License-Identifier: AGPL-3.0-only
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { DataSource } from 'typeorm';
import { inject } from 'vitest';

import { buildDataSourceOptions } from '../../src/db/data-source';

/** Anything TypeORM accepts in `entities` or `migrations`. */
type Class = abstract new (...args: never[]) => unknown;

const SRC_DIR = join(__dirname, '..', '..', 'src');

/**
 * Loads the classes exported by files under `dir` whose name matches `pattern`.
 *
 * Files are imported through Vitest's own module graph on purpose. TypeORM's file-pattern
 * loader uses plain `require`, which would compile decorators wrongly (or not at all) and
 * create a second copy of every entity class, so `getRepository(Bot)` would not find the
 * metadata registered for the `Bot` a test imported.
 */
export async function loadClasses(dir: string, pattern: RegExp): Promise<Class[]> {
  const files = readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((file) => pattern.test(file))
    .sort();
  const classes: Class[] = [];
  for (const file of files) {
    const exported: unknown = await import(/* @vite-ignore */ join(dir, file));
    for (const value of Object.values(exported as Record<string, unknown>)) {
      if (typeof value === 'function') classes.push(value as Class);
    }
  }
  return classes;
}

/** Every migration in `src/db/migrations`, in file-name order. */
export function loadMigrations(): Promise<Class[]> {
  return loadClasses(join(SRC_DIR, 'db', 'migrations'), /\.ts$/);
}

/** Every `*.entity.ts` under `src`. */
export function loadEntities(): Promise<Class[]> {
  return loadClasses(SRC_DIR, /\.entity\.ts$/);
}

/** Data source options for the test database at `url`: the app's options, minus file-pattern loading. */
export function testDataSourceOptions(
  url: string,
  classes: { entities: Class[]; migrations: Class[] },
) {
  return {
    ...buildDataSourceOptions({ url, listenUrl: url, ssl: false, sslCa: null }),
    ...classes,
  };
}

let pending: Promise<DataSource> | undefined;

async function open(): Promise<DataSource> {
  // The schema is already migrated by the global setup, so no migrations are loaded here.
  const options = testDataSourceOptions(inject('databaseUrl'), {
    entities: await loadEntities(),
    migrations: [],
  });
  return new DataSource(options).initialize();
}

/**
 * The migrated test database. One connection pool per Vitest worker, shared by every test
 * the worker runs. If a test file destroyed it, the next call opens a fresh one.
 */
export async function getTestDataSource(): Promise<DataSource> {
  if (pending !== undefined) {
    const ds = await pending.catch(() => undefined);
    if (ds?.isInitialized === true) return ds;
  }
  pending = open();
  return pending;
}

/**
 * Empties every table in `public` except `migrations`, plus `pgboss.job` when pg-boss has
 * created it, and restarts identities. Call it from `beforeEach` for tests that write.
 */
export async function resetDatabase(ds: DataSource): Promise<void> {
  // Raw SQL: TypeORM has no "truncate everything" and the table list comes from the catalog.
  const tables = await ds.query<{ schema: string; name: string }[]>(
    `SELECT schemaname AS schema, tablename AS name
       FROM pg_tables
      WHERE (schemaname = 'public' AND tablename <> 'migrations')
         OR (schemaname = 'pgboss' AND tablename = 'job')`,
  );
  if (tables.length === 0) return;
  const list = tables
    .map((t) => `${ds.driver.escape(t.schema)}.${ds.driver.escape(t.name)}`)
    .join(', ');
  await ds.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
