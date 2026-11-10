// SPDX-License-Identifier: AGPL-3.0-only
import { DataSource } from 'typeorm';

import { ConfigError, loadConfig } from './common/config';
import { buildDataSourceOptions } from './db/data-source';

/**
 * Container entrypoint `node dist/migrate.js`: applies pending migrations, each in its own
 * transaction (migrations that build indexes CONCURRENTLY opt out), then exits 0; any error
 * exits 1 so compose does not start the api and worker.
 */
async function main(): Promise<number> {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      return 1;
    }
    throw error;
  }

  const dataSource = await new DataSource(buildDataSourceOptions(config.database)).initialize();
  try {
    const applied = await dataSource.runMigrations({ transaction: 'each' });
    process.stdout.write(`migrations applied: ${String(applied.length)}\n`);
    return 0;
  } finally {
    await dataSource.destroy();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`migration failed: ${String(error)}\n`);
    process.exit(1);
  },
);
