// SPDX-License-Identifier: AGPL-3.0-only
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import { WorkerAppModule } from './app/worker-app.module';
import { ConfigError, loadConfig } from './common/config';

// A developer's `.env` sits at the repository root. Variables already set win over the file,
// so containers and CI need no such file.
const envFile = resolve(__dirname, '../../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

/**
 * The worker process: runs pg-boss jobs and writes the heartbeat. On SIGTERM/SIGINT Nest closes
 * the app, which stops pg-boss gracefully (running jobs get up to 30 s) before the pool closes.
 */
async function bootstrap(): Promise<void> {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  const app = await NestFactory.createApplicationContext(WorkerAppModule.register(config), {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks(['SIGTERM', 'SIGINT']);
}

bootstrap().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
