// SPDX-License-Identifier: AGPL-3.0-only
import { DataSource } from 'typeorm';

import { loadConfig } from '../common/config';
import { buildDataSourceOptions } from '../db/data-source';

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const dataSource = new DataSource(buildDataSourceOptions(config.database));

  try {
    await dataSource.initialize();
    const result = await dataSource.query<{ last_beat: Date | null }[]>(
      `SELECT MAX(created_at) AS last_beat FROM worker_heartbeats`,
    );
    const lastBeat = result[0]?.last_beat ?? null;
    if (!lastBeat) {
      process.stderr.write('No worker heartbeat found\n');
      process.exit(1);
    }
    const ageMs = Date.now() - lastBeat.getTime();
    if (ageMs > 90_000) {
      process.stderr.write(`Worker heartbeat stale: ${String(ageMs)} ms\n`);
      process.exit(1);
    }
    process.stderr.write(`Worker heartbeat OK: ${String(ageMs)} ms\n`);
    process.exit(0);
  } catch (error) {
    process.stderr.write(`Worker health check failed: ${String(error)}\n`);
    process.exit(1);
  } finally {
    await dataSource.destroy();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`Unexpected error: ${String(error)}\n`);
  process.exit(1);
});
