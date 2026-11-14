// SPDX-License-Identifier: AGPL-3.0-only
import type { Provider, Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NodeAdapter } from '@nestjs/platform-node';
import type { NestNodeApplication, NodeRequest, NodeResponse } from '@nestjs/platform-node';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { ZodValidationPipe } from 'nestjs-zod';
import type { DataSource } from 'typeorm';

import type { AppConfig } from '../common/config';
import { isValidRequestId, newRequestId } from '../common/context/request-context';
import { AppExceptionFilter } from '../common/errors';
import type { FileStorage } from '../common/storage';
import type { KnowledgeModuleOptions } from '../modules/knowledge/knowledge.module';
import { widgetCorsPreflight } from '../modules/widget';
import { HttpAppModule } from './http-app.module';

/** Every HTTP route lives under `/api` (single origin: the web server serves everything else). */
export const API_PREFIX = 'api';

/** Fits a 200 KB text source plus JSON overhead and a little room to spare. */
const JSON_BODY_LIMIT = '1mb';

export interface CreateHttpAppOverrides {
  controllers?: Type[];
  providers?: Provider[];
  /** An already initialized data source to use instead of opening a pool (test harness). */
  dataSource?: DataSource;
  /** Shortens the SSE heartbeat for tests (default 20 s). */
  sseHeartbeatMs?: number;
  /** A memory-backed store instead of `STORAGE_DIR` (test harness). */
  storage?: FileStorage;
  /** Test seam: a crawl policy and DNS lookup that reach a fixture server. */
  knowledge?: KnowledgeModuleOptions;
  /** Test seam: the directory served at `/widget.js` and `/widget/:version/*`. */
  widgetDistDir?: string;
}

interface MaybeRequestId {
  id?: unknown;
  headers: Record<string, unknown>;
}

function requestIdFor(request: MaybeRequestId): string {
  const incoming = request.headers['x-request-id'];
  if (isValidRequestId(incoming)) return incoming;
  if (isValidRequestId(request.id)) return request.id;
  return newRequestId();
}

/**
 * Builds the HTTP app on Nest's node adapter: `/api` prefix, the error envelope, request ids,
 * redacted logging, the request CLS store and liveness. Shared by `main.ts` and the e2e harness.
 */
export async function createHttpApp(
  config: AppConfig,
  overrides: CreateHttpAppOverrides = {},
): Promise<NestNodeApplication> {
  const adapter = new NodeAdapter();
  adapter.setOnRequestHook((request, response, done) => {
    const id = requestIdFor(request);
    request.headers['x-request-id'] = id;
    response.setHeader('X-Request-Id', id);
    done();
  });

  const app = await NestFactory.create<NestNodeApplication>(
    HttpAppModule.register(config, overrides),
    adapter,
    // The default JSON limit (100 KB) is below a 200 KB text source (spec §12.1); the parser
    // is registered below with a limit that fits the largest JSON body the API accepts.
    { bufferLogs: true, bodyParser: false },
  );

  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  app.useBodyParser('urlencoded', { limit: JSON_BODY_LIMIT, extended: true });

  // The widget bundles sit at the origin root (spec §16.3), outside the `/api` prefix.
  app.setGlobalPrefix(API_PREFIX, { exclude: ['widget.js', 'widget/:version/*file'] });
  // Connect-style middleware; NodeAdapter mounts it before the router.
  app.use(helmet());
  // Widget preflight before the router: Nest would answer `not_found` for the OPTIONS route.
  app.use(widgetCorsPreflight());
  app.useLogger(app.get(Logger));
  app.useGlobalFilters(new AppExceptionFilter());
  app.useGlobalPipes(new ZodValidationPipe());

  await app.init();

  // Nest's router answers unmatched routes before this point; keep our envelope instead.
  adapter.setNotFoundHandler((request: NodeRequest, response: NodeResponse) => {
    const body = JSON.stringify({
      error: {
        code: 'not_found',
        message: 'Route not found.',
        requestId: requestIdFor(request),
      },
    });
    response.statusCode = 404;
    response.setHeader('Content-Type', 'application/json');
    response.end(body);
  });

  return app;
}
