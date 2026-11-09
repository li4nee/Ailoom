// SPDX-License-Identifier: AGPL-3.0-only
import { DataSource } from 'typeorm';

import { loadConfig } from '../common/config';
import { buildDataSourceOptions } from '../db/data-source';

async function main(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
  const config = loadConfig(process.env);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const dataSource = new DataSource(buildDataSourceOptions(config.database));

  try {
    await dataSource.initialize();
    const result = await dataSource.runMigrations({ transaction: 'each' });
    process.stderr.write(`Migrations applied: ${String(result.length)}\n`);
    process.exit(0);
  } catch (error) {
    process.stderr.write(`Migration failed: ${String(error)}\n`);
    process.exit(1);
  } finally {
    await dataSource.destroy();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`Unexpected error: ${String(error)}\n`);
  process.exit(1);
});
