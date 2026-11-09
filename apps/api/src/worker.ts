// SPDX-License-Identifier: AGPL-3.0-only
import { NestFactory } from '@nestjs/core';

import { WorkerAppModule } from './app/worker-app.module';
import { ConfigError, loadConfig, APP_CONFIG } from './common/config';
import { JobsWorker } from './jobs';

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

  const app = await NestFactory.createApplicationContext(WorkerAppModule, {
    bufferLogs: true,
  });

  // Provide the config to the DI container
  const configProvider = { provide: APP_CONFIG, useValue: config };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  app.provide(configProvider);
  // The config is already provided by the JobsModule factory, but we need it for WorkerAppModule too
  // JobsModule is imported by WorkerAppModule, so it will be available

  const jobsWorker = app.get(JobsWorker);
  // jobsWorker is retrieved to ensure it's initialized; we don't use it directly here
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _jobsWorker = jobsWorker;

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<never> => {
    process.stderr.write(`${signal} received, stopping worker...\n`);
    try {
      await app.close();
      process.stderr.write('Worker stopped gracefully\n');
      process.exit(0);
    } catch (error) {
      process.stderr.write(`Error during shutdown: ${String(error)}\n`);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => {
    shutdown('SIGTERM').catch(() => {
      // Ignore shutdown errors
    });
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT').catch(() => {
      // Ignore shutdown errors
    });
  });

  process.stderr.write('Worker started\n');
}

bootstrap().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
