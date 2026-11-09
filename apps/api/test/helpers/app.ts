// SPDX-License-Identifier: AGPL-3.0-only
import type { Provider, Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { DataSource } from 'typeorm';

import { createHttpApp } from '../../src/app/create-http-app';
import { type AppConfig, loadConfig } from '../../src/common/config';
import { getTestDataSource } from './db';

/** Everything a test needs to call the api and inspect the database it shares. */
export interface TestApp {
  app: NestExpressApplication;
  http: ReturnType<typeof request>;
  ds: DataSource;
  config: AppConfig;
  close(): Promise<void>;
}

/** The minimum valid environment; tests override what they care about. */
const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  PUBLIC_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgres://app:app@localhost:5432/app',
  AUTH_SECRET: 'a'.repeat(32),
  WIDGET_SECRET: 'w'.repeat(32),
  ENCRYPTION_KEYS: `v1:${'ab'.repeat(32)}`,
  LOG_LEVEL: 'error',
};

export interface CreateTestAppOptions {
  config?: Partial<AppConfig>;
  providers?: Provider[];
  /** Test-only controllers; Nest cannot register a controller as a provider. */
  controllers?: Type[];
}

/** Builds the real HTTP app against the migrated test database. */
export async function createTestApp(options: CreateTestAppOptions = {}): Promise<TestApp> {
  const config: AppConfig = { ...loadConfig(TEST_ENV), ...options.config };
  const app = await createHttpApp(config, {
    ...(options.controllers === undefined ? {} : { controllers: options.controllers }),
    ...(options.providers === undefined ? {} : { providers: options.providers }),
  });
  const ds = await getTestDataSource();
  return {
    app,
    http: request(app.getHttpServer()),
    ds,
    config,
    close: async () => {
      await app.close();
    },
  };
}
