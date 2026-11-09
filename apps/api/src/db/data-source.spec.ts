// SPDX-License-Identifier: AGPL-3.0-only
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AppConfig } from '../common/config';
import { buildDataSourceOptions } from './data-source';
import { SnakeNamingStrategy } from './naming-strategy';

type DatabaseConfig = AppConfig['database'];

const URL = 'postgres://app:app@localhost:55432/app';
const PEM = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n';

function build(overrides: Partial<DatabaseConfig> = {}): PostgresConnectionOptions {
  const db: DatabaseConfig = { url: URL, listenUrl: URL, ssl: false, sslCa: null, ...overrides };
  return buildDataSourceOptions(db) as PostgresConnectionOptions;
}

describe('buildDataSourceOptions', () => {
  let dir: string;
  let caPath: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ailoom-ca-'));
    caPath = join(dir, 'ca.pem');
    writeFileSync(caPath, PEM);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('describes a Postgres data source that never synchronizes the schema', () => {
    const options = build();
    expect(options.type).toBe('postgres');
    expect(options.url).toBe(URL);
    expect(options.synchronize).toBe(false);
    expect(options.migrationsTableName).toBe('migrations');
    expect(options.namingStrategy).toBeInstanceOf(SnakeNamingStrategy);
  });

  it('finds entities and migrations by file pattern', () => {
    const options = build();
    expect(options.entities).toEqual([
      expect.stringMatching(/[\\/]src[\\/]\*\*[\\/]\*\.entity\.\{ts,js\}$/),
    ]);
    expect(options.migrations).toEqual([
      expect.stringMatching(/[\\/]db[\\/]migrations[\\/]\*\.\{ts,js\}$/),
    ]);
  });

  it('uses no TLS when ssl is false, even if a CA is configured', () => {
    expect(build({ ssl: false }).ssl).toBe(false);
    expect(build({ ssl: false, sslCa: caPath }).ssl).toBe(false);
  });

  it('verifies the server certificate against the system CAs when ssl is true', () => {
    expect(build({ ssl: true }).ssl).toEqual({ rejectUnauthorized: true });
  });

  it('pins the configured CA file when ssl is true', () => {
    expect(build({ ssl: true, sslCa: caPath }).ssl).toEqual({ rejectUnauthorized: true, ca: PEM });
  });

  it('encrypts without verifying when ssl is require and no CA is configured', () => {
    expect(build({ ssl: 'require' }).ssl).toEqual({ rejectUnauthorized: false });
  });

  it('encrypts and verifies when ssl is require and a CA is configured', () => {
    expect(build({ ssl: 'require', sslCa: caPath }).ssl).toEqual({
      rejectUnauthorized: true,
      ca: PEM,
    });
  });

  it('names the variable and the file when the CA file cannot be read', () => {
    const missing = join(dir, 'missing.pem');
    expect(() => build({ ssl: 'require', sslCa: missing })).toThrow(
      /DATABASE_SSL_CA.*missing\.pem/,
    );
  });
});
