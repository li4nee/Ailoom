// SPDX-License-Identifier: AGPL-3.0-only
import { type DynamicModule, Global, Module } from '@nestjs/common';

import { RealtimeHub } from './realtime-hub';
import { DEFAULT_SSE_HEARTBEAT_MS, SSE_HEARTBEAT_MS } from './sse';
import { WorkspaceEventsController } from './workspace-events.controller';

export interface RealtimeModuleOptions {
  /** Overrides the 20 s heartbeat; tests use a short one. */
  heartbeatMs?: number;
}

/**
 * LISTEN/NOTIFY fan-out and the workspace SSE endpoint. One hub per process; the worker uses
 * `notifyWorkspace` directly and never needs a subscriber side.
 */
@Global()
@Module({})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest dynamic module
export class RealtimeModule {
  static register(options: RealtimeModuleOptions = {}): DynamicModule {
    return {
      module: RealtimeModule,
      controllers: [WorkspaceEventsController],
      providers: [
        RealtimeHub,
        {
          provide: SSE_HEARTBEAT_MS,
          useValue: options.heartbeatMs ?? DEFAULT_SSE_HEARTBEAT_MS,
        },
      ],
      exports: [RealtimeHub, SSE_HEARTBEAT_MS],
    };
  }
}
