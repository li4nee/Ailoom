// SPDX-License-Identifier: AGPL-3.0-only
import { Controller, Get, Param, Query } from '@nestjs/common';

import type { FreshnessQuery } from '@app/shared';

import { asWorkspaceId } from '../../../db/ids';
import { RequireRole } from '../../auth';
import { SourcesService } from '../sources.service';

@Controller('v1/workspaces/:workspaceId/knowledge')
export class FreshnessController {
  constructor(private readonly sources: SourcesService) {}

  @Get('freshness')
  @RequireRole('admin')
  async list(@Param('workspaceId') workspaceId: string, @Query() query: FreshnessQuery) {
    return this.sources.staleDocuments(asWorkspaceId(workspaceId), query);
  }
}
