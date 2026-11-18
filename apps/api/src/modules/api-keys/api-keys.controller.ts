// SPDX-License-Identifier: AGPL-3.0-only
import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';

import type { ApiKeyDto, CreatedApiKey } from '@app/shared';
import { createApiKeyRequestSchema } from '@app/shared';

import { asUserId, asWorkspaceId } from '../../db/ids';
import { CurrentPrincipal, RequireRole, SessionOnly, type Principal } from '../auth';
import { ApiKeysService } from './api-keys.service';

class CreateApiKeyDto extends createZodDto(createApiKeyRequestSchema) {}

/** Workspace-admin lifecycle for machine credentials. Raw tokens are returned only on create/rotate. */
@SessionOnly()
@RequireRole('admin')
@Controller('v1/workspaces/:workspaceId/api-keys')
export class ApiKeysController {
  constructor(private readonly keys: ApiKeysService) {}

  @Get()
  async list(@Param('workspaceId') workspaceId: string): Promise<ApiKeyDto[]> {
    return this.keys.list(asWorkspaceId(workspaceId));
  }

  @Post()
  async create(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Body() body: CreateApiKeyDto,
  ): Promise<CreatedApiKey> {
    return this.keys.create(asWorkspaceId(workspaceId), asUserId(principal.userId), body);
  }

  @Post(':keyId/rotate')
  async rotate(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('keyId') keyId: string,
  ): Promise<CreatedApiKey> {
    return this.keys.rotate(asWorkspaceId(workspaceId), asUserId(principal.userId), keyId);
  }

  @Delete(':keyId')
  async revoke(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('keyId') keyId: string,
  ): Promise<void> {
    await this.keys.revoke(asWorkspaceId(workspaceId), asUserId(principal.userId), keyId);
  }
}
