// SPDX-License-Identifier: AGPL-3.0-only
import type { IncomingMessage } from 'node:http';

import type { DynamicModule, Provider, Type } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { ClsModule, ClsServiceManager } from 'nestjs-cls';
import { LoggerModule } from 'nestjs-pino';
import type { DataSource } from 'typeorm';

import type { AppConfig } from '../common/config';
import { ConfigModule } from '../common/config';
import type { RequestContext } from '../common/context/request-context';
import {
  isValidRequestId,
  newRequestId,
  RequestContextService,
} from '../common/context/request-context';
import { buildLoggerOptions } from '../common/logging';
import { DatabaseModule } from '../db';
import { JobsModule } from '../jobs';
import { EmailModule } from '../modules/email';
import { HealthModule } from '../modules/health';

export interface HttpAppOverrides {
  controllers?: Type[];
  providers?: Provider[];
  /** An already initialized data source to use instead of opening a pool (test harness). */
  dataSource?: DataSource;
}

function headerRequestId(source: { headers: Record<string, unknown> }): string {
  const value = source.headers['x-request-id'];
  return isValidRequestId(value) ? value : newRequestId();
}

/** The HTTP dependency graph. `requestId` is created once, by the node adapter's request hook. */
@Module({})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest dynamic module
export class HttpAppModule {
  static register(config: AppConfig, overrides: HttpAppOverrides = {}): DynamicModule {
    return {
      module: HttpAppModule,
      imports: [
        ConfigModule.forRoot(config),
        // Global: feature modules inject PinoLogger (e.g. the email module) without importing.
        {
          ...LoggerModule.forRoot({
            pinoHttp: {
              ...buildLoggerOptions(config),
              genReqId: (request: IncomingMessage) => headerRequestId(request),
              customProps: () => {
                const cls = ClsServiceManager.getClsService();
                if (!cls.isActive()) return {};
                return cls.get<RequestContext>();
              },
            },
          }),
          global: true,
        },
        ClsModule.forRoot({
          global: true,
          middleware: {
            mount: true,
            idGenerator: (request: { headers: Record<string, unknown> }) =>
              headerRequestId(request),
            setup: (cls, request: { headers: Record<string, unknown> }) => {
              cls.set('requestId', headerRequestId(request));
            },
          },
        }),
        DatabaseModule.forRoot(config, overrides.dataSource),
        // The api only sends jobs; the worker process runs them.
        JobsModule.forApi(),
        EmailModule.forRoot(),
        HealthModule,
      ],
      controllers: overrides.controllers ?? [],
      providers: [RequestContextService, ...(overrides.providers ?? [])],
      exports: [RequestContextService],
    };
  }
}
