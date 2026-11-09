// SPDX-License-Identifier: AGPL-3.0-only
import type { Provider, Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NodeAdapter } from '@nestjs/platform-node';
import type { NestNodeApplication, NodeRequest, NodeResponse } from '@nestjs/platform-node';
import { Logger } from 'nestjs-pino';
import { ZodValidationPipe } from 'nestjs-zod';

import type { AppConfig } from '../common/config';
import { isValidRequestId, newRequestId } from '../common/context/request-context';
import { AppExceptionFilter } from '../common/errors';
import { HttpAppModule } from './http-app.module';

export interface CreateHttpAppOverrides {
  controllers?: Type[];
  providers?: Provider[];
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
    { bufferLogs: true },
  );

  app.setGlobalPrefix('api');
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
