// SPDX-License-Identifier: AGPL-3.0-only
import type { Provider, Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
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

function requestIdMiddleware(request: Request, response: Response, next: NextFunction): void {
  const id = requestIdFor(request);
  request.headers['x-request-id'] = id;
  response.setHeader('X-Request-Id', id);
  next();
}

/**
 * Builds the HTTP app: `/api` prefix, the error envelope, request ids, redacted logging,
 * the request CLS store and liveness. Shared by `main.ts` and the e2e harness.
 */
export async function createHttpApp(
  config: AppConfig,
  overrides: CreateHttpAppOverrides = {},
): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(
    HttpAppModule.register(config, overrides),
    { bufferLogs: true },
  );

  app.setGlobalPrefix('api');
  app.use(requestIdMiddleware);
  app.useLogger(app.get(Logger));
  app.useGlobalFilters(new AppExceptionFilter());
  app.useGlobalPipes(new ZodValidationPipe());

  await app.init();

  // Routes are registered by now; anything Express did not match lands here.
  const instance = app.getHttpAdapter().getInstance();
  instance.use((request: Request, response: Response) => {
    response.status(404).json({
      error: {
        code: 'not_found',
        message: 'Route not found.',
        requestId: requestIdFor(request),
      },
    });
  });

  // Body-parser errors happen in Express middleware, before Nest's exception layer.
  instance.use(
    (
      error: { type?: unknown; statusCode?: unknown },
      request: Request,
      response: Response,
      next: NextFunction,
    ) => {
      if (error.type !== 'entity.too.large' && error.statusCode !== 413) {
        next(error);
        return;
      }
      response.status(413).json({
        error: {
          code: 'payload_too_large',
          message: 'The request payload is too large.',
          requestId: requestIdFor(request),
        },
      });
    },
  );

  return app;
}
