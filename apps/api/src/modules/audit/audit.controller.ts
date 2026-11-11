// SPDX-License-Identifier: AGPL-3.0-only
import { Controller, Get, Query } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';

import type { AuditEntryDto, Page } from '@app/shared';
import { pageQuerySchema } from '@app/shared';

import { AppError } from '../../common/errors';
import { CurrentPrincipal, RequireRole } from '../auth';
import type { Principal } from '../auth';
import { AuditService } from './audit.service';

class PageQueryDto extends createZodDto(pageQuerySchema) {}

/** The workspace audit log (spec §17.8): admins and owners only. */
@Controller('v1/workspaces/:workspaceId/audit-log')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @RequireRole('admin')
  @Get()
  async list(
    @CurrentPrincipal() principal: Principal,
    @Query() query: PageQueryDto,
  ): Promise<Page<AuditEntryDto>> {
    const workspaceId = principal.workspace?.id;
    if (workspaceId === undefined) throw new AppError('not_found');
    return this.audit.list(workspaceId, query);
  }
}
