// SPDX-License-Identifier: AGPL-3.0-only
import { DataSource } from 'typeorm';

import { SystemClock } from '../common/clock';
import { loadConfig } from '../common/config';
import { buildDataSourceOptions } from '../db/data-source';
import { WorkerHeartbeatEntity } from '../modules/instance/entities/worker-heartbeat.entity';

/** Three missed beats (the worker beats every 30 s). */
const MAX_AGE_MS = 90_000;

/**
 * Container health check for the worker (`node dist/cli/worker-health.js`): exits 0 when some
 * worker wrote a heartbeat in the last 90 s, 1 otherwise.
 */
async function main(): Promise<number> {
  const config = loadConfig(process.env);
  const dataSource = await new DataSource(buildDataSourceOptions(config.database)).initialize();
  try {
    const since = new Date(new SystemClock().now().getTime() - MAX_AGE_MS);
    const fresh = await dataSource
      .getRepository(WorkerHeartbeatEntity)
      .createQueryBuilder('heartbeat')
      .where('heartbeat.lastBeatAt > :since', { since })
      .getCount();
    if (fresh === 0) {
      process.stderr.write('no worker heartbeat in the last 90 s\n');
      return 1;
    }
    return 0;
  } finally {
    await dataSource.destroy();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`worker health check failed: ${String(error)}\n`);
    process.exit(1);
  },
);
