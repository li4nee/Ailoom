// SPDX-License-Identifier: AGPL-3.0-only
import { Controller, Get, Param } from '@nestjs/common';

import type { TraceDetail } from '@app/shared';

import { asWorkspaceId } from '../../db/ids';
import { RequireRole } from '../auth';
import { TracesService } from './traces.service';

/** The answer replay drawer (spec §17.8), addressed by trace or by AI message. */
@RequireRole('agent')
@Controller('v1/workspaces/:workspaceId')
export class TracesController {
  constructor(private readonly traces: TracesService) {}

  @Get('traces/:traceId')
  async get(
    @Param('workspaceId') workspaceId: string,
    @Param('traceId') traceId: string,
  ): Promise<TraceDetail> {
    return this.traces.get(asWorkspaceId(workspaceId), traceId);
  }

  @Get('messages/:messageId/trace')
  async getForMessage(
    @Param('workspaceId') workspaceId: string,
    @Param('messageId') messageId: string,
  ): Promise<TraceDetail> {
    return this.traces.getForMessage(asWorkspaceId(workspaceId), messageId);
  }
}
