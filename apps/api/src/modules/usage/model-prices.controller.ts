// SPDX-License-Identifier: AGPL-3.0-only
import { Body, Controller, Get, Param, Put } from '@nestjs/common';

import type { ModelPriceDto, UpdateModelPricesRequest } from '@app/shared';

import { asWorkspaceId } from '../../db/ids';
import { RequireRole } from '../auth';
import { PricingService } from './pricing.service';

/**
 * Spec §9.5. Admin-only: a price override changes what every bill in the workspace says.
 * `PUT` replaces the workspace's overrides wholesale and answers with the merged table.
 */
@RequireRole('admin')
@Controller('v1/workspaces/:workspaceId/model-prices')
export class ModelPricesController {
  constructor(private readonly pricing: PricingService) {}

  @Get()
  async list(@Param('workspaceId') workspaceId: string): Promise<ModelPriceDto[]> {
    return this.pricing.listMerged(asWorkspaceId(workspaceId));
  }

  @Put()
  async replace(
    @Param('workspaceId') workspaceId: string,
    // Validated by the service with the shared schema: the body is a list, not a DTO class.
    @Body() body: UpdateModelPricesRequest,
  ): Promise<ModelPriceDto[]> {
    return this.pricing.replaceOverrides(asWorkspaceId(workspaceId), body);
  }
}
