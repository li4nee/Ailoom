// SPDX-License-Identifier: AGPL-3.0-only
import { Controller, Get, Param } from '@nestjs/common';

import type { TraceDetail } from '@app/shared';

import { asWorkspaceId } from '../../db/ids';
import { CurrentPrincipal, RequireRole, type Principal } from '../auth';
import { TracesService } from './traces.service';

/** The answer replay drawer (spec §17.8), addressed by trace or by AI message. */
@RequireRole('agent')
@Controller('v1/workspaces/:workspaceId')
export class TracesController {
  constructor(private readonly traces: TracesService) {}

  @Get('traces/:traceId')
  async get(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('traceId') traceId: string,
  ): Promise<TraceDetail> {
    return redactRemoteToolNames(
      await this.traces.get(asWorkspaceId(workspaceId), traceId),
      principal,
    );
  }

  @Get('messages/:messageId/trace')
  async getForMessage(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('messageId') messageId: string,
  ): Promise<TraceDetail> {
    return redactRemoteToolNames(
      await this.traces.getForMessage(asWorkspaceId(workspaceId), messageId),
      principal,
    );
  }
}

export function redactRemoteToolNames(trace: TraceDetail, principal: Principal): TraceDetail {
  const role = principal.workspace?.role;
  if (role === 'owner' || role === 'admin') return trace;
  return {
    ...trace,
    toolCalls: trace.toolCalls.map((call) => {
      const redactedCall = { ...call };
      delete redactedCall.remoteName;
      return redactedCall;
    }),
  };
}
