// SPDX-License-Identifier: AGPL-3.0-only
import type { IncomingMessage } from 'node:http';

import type { DynamicModule, Provider, Type } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ClsModule, ClsServiceManager } from 'nestjs-cls';
import { LoggerModule } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import type { DataSource } from 'typeorm';

import type { AppConfig } from '../common/config';
import { ConfigModule } from '../common/config';
import type { RequestContext } from '../common/context/request-context';
import {
  isValidRequestId,
  newRequestId,
  RequestContextModule,
} from '../common/context/request-context';
import { buildLoggerOptions } from '../common/logging';
import { clientIp } from '../common/security/client-ip';
import { CsrfGuard } from '../common/security/csrf.guard';
import { RateLimitGuard, rateLimitOptions } from '../common/security/rate-limit';
import { type FileStorage, StorageModule } from '../common/storage';
import { DatabaseModule } from '../db';
import { JobsModule } from '../jobs';
import { ApiKeysModule } from '../modules/api-keys';
import { AuditModule } from '../modules/audit';
import { AccessGuard, AuthModule } from '../modules/auth';
import { BotsModule } from '../modules/bots';
import { ChatModule } from '../modules/chat';
import { ConversationsModule } from '../modules/conversations';
import {
  CredentialsController,
  CredentialsModule,
  CredentialsService,
} from '../modules/credentials';
import { EmailModule, type Mailer } from '../modules/email';
import { HealthModule } from '../modules/health';
import { InstanceModule } from '../modules/instance';
import {
  KnowledgeModule,
  type KnowledgeModuleOptions,
} from '../modules/knowledge/knowledge.module';
import { PromptsModule } from '../modules/prompts';
import { RealtimeModule } from '../modules/realtime';
import { RetrievalModule } from '../modules/retrieval';
import { UsageModule } from '../modules/usage';
import { VisitorGuard, WidgetModule } from '../modules/widget';
import { WorkspacesModule } from '../modules/workspaces';
import { ProvidersModule } from '../providers';

export interface HttpAppOverrides {
  controllers?: Type[];
  providers?: Provider[];
  /** An already initialized data source to use instead of opening a pool (test harness). */
  dataSource?: DataSource;
  /** Shortens the SSE heartbeat for tests (default 20 s). */
  sseHeartbeatMs?: number;
  /** A memory-backed store instead of `STORAGE_DIR` (test harness). */
  storage?: FileStorage;
  /** A fixed mailer instead of the configured transport (test harness). */
  mailer?: Mailer;
  /** A log destination instead of stdout (test harness). */
  loggerDestination?: DestinationStream;
  /** Test seam: a crawl policy and DNS lookup that reach a fixture server. */
  knowledge?: KnowledgeModuleOptions;
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
            pinoHttp:
              overrides.loggerDestination === undefined
                ? {
                    ...buildLoggerOptions(config),
                    genReqId: (request: IncomingMessage) => headerRequestId(request),
                    customProps: () => {
                      const cls = ClsServiceManager.getClsService();
                      if (!cls.isActive()) return {};
                      return cls.get<RequestContext>();
                    },
                  }
                : [
                    {
                      ...buildLoggerOptions(config),
                      genReqId: (request: IncomingMessage) => headerRequestId(request),
                      customProps: () => {
                        const cls = ClsServiceManager.getClsService();
                        if (!cls.isActive()) return {};
                        return cls.get<RequestContext>();
                      },
                    },
                    overrides.loggerDestination,
                  ],
          }),
          global: true,
        },
        ClsModule.forRoot({
          global: true,
          middleware: {
            mount: true,
            idGenerator: (request: { headers: Record<string, unknown> }) =>
              headerRequestId(request),
            setup: (
              cls,
              request: {
                headers: Record<string, unknown>;
                socket?: { remoteAddress?: string | null };
              },
            ) => {
              cls.set('requestId', headerRequestId(request));
              cls.set('ip', clientIp(request));
            },
          },
        }),
        RequestContextModule,
        // Global: feature modules inject FILE_STORAGE without importing the storage module.
        StorageModule.forRoot(
          config,
          overrides.storage === undefined ? {} : { storage: overrides.storage },
        ),
        DatabaseModule.forRoot(config, overrides.dataSource),
        // The api only sends jobs; the worker process runs them.
        JobsModule.forApi(),
        ThrottlerModule.forRoot(rateLimitOptions()),
        AuthModule,
        ApiKeysModule,
        AuditModule,
        EmailModule.forRoot(overrides.mailer === undefined ? {} : { mailer: overrides.mailer }),
        HealthModule,
        // Global modules: auth injects the signup-mode and invitation ports.
        InstanceModule,
        WorkspacesModule,
        CredentialsModule,
        BotsModule,
        PromptsModule,
        ConversationsModule,
        ChatModule,
        WidgetModule,
        KnowledgeModule.register(overrides.knowledge),
        // Test-retrieval shares the chat engine's search and selection rule (spec §13.3).
        RetrievalModule,
        // Global: any module writes a workspace event through `notifyWorkspace`, but the SSE
        // endpoint and the one LISTEN connection live here.
        RealtimeModule.register(
          overrides.sseHeartbeatMs === undefined ? {} : { heartbeatMs: overrides.sseHeartbeatMs },
        ),
        UsageModule,
        // The model layer: Llm resolves credentials through CredentialsService.
        ProvidersModule.forRoot({ imports: [CredentialsModule], resolver: CredentialsService }),
      ],
      // Feature controllers whose module cannot declare them without a cycle: the credentials
      // controller needs `ProviderOps`, and the model layer already imports the credentials
      // module for its resolver.
      controllers: [CredentialsController, ...(overrides.controllers ?? [])],
      providers: [
        { provide: APP_GUARD, useClass: CsrfGuard },
        { provide: APP_GUARD, useClass: AccessGuard },
        // The widget routes are unauthenticated but hostile-web guarded; the visitor guard
        // resolves the visitor first so the rate limiter's widget trackers can key on it.
        { provide: APP_GUARD, useClass: VisitorGuard },
        // After AccessGuard: the admin bucket is keyed by the authenticated user id.
        { provide: APP_GUARD, useClass: RateLimitGuard },
        ...(overrides.providers ?? []),
      ],
    };
  }
}
