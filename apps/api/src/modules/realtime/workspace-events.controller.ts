// SPDX-License-Identifier: AGPL-3.0-only
import { Controller, Get, Inject, Param, Res } from '@nestjs/common';
import type { NodeResponse } from '@nestjs/platform-node';

import { asWorkspaceId } from '../../db/ids';
import { RequireRole } from '../auth';
import { RealtimeHub } from './realtime-hub';
import { openSse, SSE_HEARTBEAT_MS } from './sse';

/**
 * The workspace channel (spec §17.7, §18.3). The access guard has already resolved the
 * caller's membership of `:workspaceId`, so every member gets every event of the workspace;
 * agents included, because the knowledge status they watch is workspace-wide.
 */
@Controller('v1/workspaces/:workspaceId/events')
export class WorkspaceEventsController {
  constructor(
    private readonly hub: RealtimeHub,
    @Inject(SSE_HEARTBEAT_MS) private readonly heartbeatMs: number,
  ) {}

  @Get()
  @RequireRole('agent')
  stream(@Param('workspaceId') workspaceId: string, @Res() reply: NodeResponse): void {
    const sse = openSse(reply, { heartbeatMs: this.heartbeatMs });
    const unsubscribe = this.hub.subscribe(
      asWorkspaceId(workspaceId),
      () => true,
      (event) => {
        sse.send(event.type, event);
      },
    );
    sse.onClose(unsubscribe);
  }
}
