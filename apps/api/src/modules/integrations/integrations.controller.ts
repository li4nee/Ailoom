// SPDX-License-Identifier: AGPL-3.0-only
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';

import type { IntegrationDeliveryDto, IntegrationDto } from '@app/shared';
import { connectIntegrationRequestSchema } from '@app/shared';

import { asWorkspaceId } from '../../db/ids';
import { CurrentPrincipal, RequireApiKeyScope, RequireRole, type Principal } from '../auth';
import { IntegrationsService } from './integrations.service';

class ConnectIntegrationDto extends createZodDto(connectIntegrationRequestSchema) {}

@RequireRole('admin')
@Controller('v1/workspaces/:workspaceId/integrations')
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Get()
  @RequireApiKeyScope('integrations:manage')
  list(@Param('workspaceId') workspaceId: string): Promise<IntegrationDto[]> {
    return this.integrations.list(asWorkspaceId(workspaceId));
  }

  @Post()
  @RequireApiKeyScope('integrations:manage')
  async connect(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Body() body: ConnectIntegrationDto,
  ): Promise<IntegrationDto> {
    return this.integrations.connect(asWorkspaceId(workspaceId), principal.userId, body);
  }

  @Post(':integrationId/pause')
  @RequireApiKeyScope('integrations:manage')
  pause(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('integrationId') integrationId: string,
  ): Promise<IntegrationDto> {
    return this.integrations.setStatus(
      asWorkspaceId(workspaceId),
      principal.userId,
      integrationId,
      'paused',
    );
  }

  @Post(':integrationId/resume')
  @RequireApiKeyScope('integrations:manage')
  resume(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('integrationId') integrationId: string,
  ): Promise<IntegrationDto> {
    return this.integrations.setStatus(
      asWorkspaceId(workspaceId),
      principal.userId,
      integrationId,
      'active',
    );
  }

  @Post(':integrationId/test')
  @RequireApiKeyScope('integrations:manage')
  @HttpCode(HttpStatus.OK)
  test(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('integrationId') integrationId: string,
  ) {
    return this.integrations.test(asWorkspaceId(workspaceId), principal.userId, integrationId);
  }

  @Get(':integrationId/deliveries')
  @RequireApiKeyScope('integrations:manage')
  deliveries(
    @Param('workspaceId') workspaceId: string,
    @Param('integrationId') integrationId: string,
  ): Promise<IntegrationDeliveryDto[]> {
    return this.integrations.listDeliveries(asWorkspaceId(workspaceId), integrationId);
  }

  @Delete(':integrationId')
  @RequireApiKeyScope('integrations:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async disconnect(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('integrationId') integrationId: string,
  ): Promise<void> {
    await this.integrations.disconnect(asWorkspaceId(workspaceId), principal.userId, integrationId);
  }
}
