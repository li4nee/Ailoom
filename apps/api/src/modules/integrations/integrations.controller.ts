// SPDX-License-Identifier: AGPL-3.0-only
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';

import type { IntegrationDto } from '@app/shared';
import { connectIntegrationRequestSchema } from '@app/shared';

import { asWorkspaceId } from '../../db/ids';
import { CurrentPrincipal, RequireRole, type Principal } from '../auth';
import { IntegrationsService } from './integrations.service';

class ConnectIntegrationDto extends createZodDto(connectIntegrationRequestSchema) {}

@RequireRole('admin')
@Controller('v1/workspaces/:workspaceId/integrations')
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Get()
  list(@Param('workspaceId') workspaceId: string): Promise<IntegrationDto[]> {
    return this.integrations.list(asWorkspaceId(workspaceId));
  }

  @Post()
  async connect(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Body() body: ConnectIntegrationDto,
  ): Promise<IntegrationDto> {
    return this.integrations.connect(asWorkspaceId(workspaceId), principal.userId, body);
  }

  @Post(':integrationId/pause')
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
  @HttpCode(HttpStatus.OK)
  test(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('integrationId') integrationId: string,
  ) {
    return this.integrations.test(asWorkspaceId(workspaceId), principal.userId, integrationId);
  }

  @Delete(':integrationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async disconnect(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('integrationId') integrationId: string,
  ): Promise<void> {
    await this.integrations.disconnect(asWorkspaceId(workspaceId), principal.userId, integrationId);
  }
}
