// SPDX-License-Identifier: AGPL-3.0-only
import { Controller, Get, Param, Query } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';

import type { OutcomesDto, UsageReport } from '@app/shared';
import { outcomesQuerySchema, usageQuerySchema } from '@app/shared';

import { asWorkspaceId } from '../../db/ids';
import { RequireRole } from '../auth';
import { OutcomesService } from './outcomes.service';
import { UsageService } from './usage.service';

class UsageQueryDto extends createZodDto(usageQuerySchema) {}
class OutcomesQueryDto extends createZodDto(outcomesQuerySchema) {}

/** Per-day usage and spend for the reports page (spec §17.10). */
@RequireRole('agent')
@Controller('v1/workspaces/:workspaceId/usage')
export class UsageController {
  constructor(
    private readonly usage: UsageService,
    private readonly outcomes: OutcomesService,
  ) {}

  @Get()
  async report(
    @Param('workspaceId') workspaceId: string,
    @Query() query: UsageQueryDto,
  ): Promise<UsageReport> {
    return this.usage.report(asWorkspaceId(workspaceId), query);
  }

  @Get('outcomes')
  async outcomesReport(
    @Param('workspaceId') workspaceId: string,
    @Query() query: OutcomesQueryDto,
  ): Promise<OutcomesDto> {
    return this.outcomes.compute(asWorkspaceId(workspaceId), query);
  }
}
