// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { DataSourceOptions } from 'typeorm';

import type { AppConfig } from '../common/config';
import { SnakeNamingStrategy } from './naming-strategy';

function readCa(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`DATABASE_SSL_CA: cannot read ${path}: ${reason}`, { cause: error });
  }
}

/**
 * - `false`: no TLS (a configured CA is ignored).
 * - `true`: TLS, certificate always verified (against the CA file when set, else system CAs).
 * - `'require'`: TLS, verified only when a CA file is set.
 */
export function buildSsl(
  db: AppConfig['database'],
): false | { rejectUnauthorized: boolean; ca?: string } {
  if (db.ssl === false) return false;
  const ca = db.sslCa === null ? undefined : readCa(db.sslCa);
  return {
    rejectUnauthorized: db.ssl === true || ca !== undefined,
    ...(ca === undefined ? {} : { ca }),
  };
}

/**
 * TypeORM options shared by the application, the migrate entrypoint and the CLI.
 * Entities and migrations are found by file pattern, relative to this file, so the same
 * options work from `src/` (TypeScript) and `dist/` (JavaScript).
 */
export function buildDataSourceOptions(db: AppConfig['database']): DataSourceOptions {
  return {
    type: 'postgres',
    url: db.url,
    ssl: buildSsl(db),
    entities: [join(__dirname, '..', '**', '*.entity.{ts,js}')],
    migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
    namingStrategy: new SnakeNamingStrategy(),
    // Schema changes go through reviewed migrations only (`pnpm db:generate`).
    synchronize: false,
    migrationsTableName: 'migrations',
    // Migrations own CREATE EXTENSION; TypeORM must not run it on every connect, which
    // would need a privileged role.
    installExtensions: false,
  };
}
