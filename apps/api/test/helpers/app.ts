// SPDX-License-Identifier: AGPL-3.0-only
import type { Provider, Type } from '@nestjs/common';
import type { NestNodeApplication } from '@nestjs/platform-node';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { inject } from 'vitest';

import { createHttpApp } from '../../src/app/create-http-app';
import { type AppConfig, loadConfig } from '../../src/common/config';
import type { FileStorage } from '../../src/common/storage';
import type { KnowledgeModuleOptions } from '../../src/modules/knowledge/knowledge.module';
import { getTestDataSource } from './db';

/** Everything a test needs to call the api and inspect the database it shares. */
export interface TestApp {
  app: NestNodeApplication;
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
  /** Shortens the workspace SSE heartbeat so a test need not wait 20 s for a ping. */
  sseHeartbeatMs?: number;
  /** A memory-backed store, so tests never write under the real `STORAGE_DIR`. */
  storage?: FileStorage;
  /** Test seam: a crawl policy and DNS lookup that reach a fixture server. */
  knowledge?: KnowledgeModuleOptions;
}

/**
 * Builds the real HTTP app against the migrated test database. The app shares the test's data
 * source (so a test sees the app's writes and vice versa) and starts pg-boss on the same
 * database.
 */
export async function createTestApp(options: CreateTestAppOptions = {}): Promise<TestApp> {
  const databaseUrl = inject('databaseUrl');
  const base = loadConfig({ ...TEST_ENV, DATABASE_URL: databaseUrl });
  const config: AppConfig = { ...base, ...options.config };
  const ds = await getTestDataSource();
  const app = await createHttpApp(config, {
    dataSource: ds,
    ...(options.controllers === undefined ? {} : { controllers: options.controllers }),
    ...(options.providers === undefined ? {} : { providers: options.providers }),
    ...(options.sseHeartbeatMs === undefined ? {} : { sseHeartbeatMs: options.sseHeartbeatMs }),
    ...(options.storage === undefined ? {} : { storage: options.storage }),
    ...(options.knowledge === undefined ? {} : { knowledge: options.knowledge }),
  });
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
