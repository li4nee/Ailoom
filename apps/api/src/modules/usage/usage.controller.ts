// SPDX-License-Identifier: AGPL-3.0-only
import { Controller, Get, Param, Query } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';

import type { UsageReport } from '@app/shared';
import { usageQuerySchema } from '@app/shared';

import { asWorkspaceId } from '../../db/ids';
import { RequireRole } from '../auth';
import { UsageService } from './usage.service';

class UsageQueryDto extends createZodDto(usageQuerySchema) {}

/** Per-day usage and spend for the reports page (spec §17.10). */
@RequireRole('agent')
@Controller('v1/workspaces/:workspaceId/usage')
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  @Get()
  async report(
    @Param('workspaceId') workspaceId: string,
    @Query() query: UsageQueryDto,
  ): Promise<UsageReport> {
    return this.usage.report(asWorkspaceId(workspaceId), query);
  }
}
