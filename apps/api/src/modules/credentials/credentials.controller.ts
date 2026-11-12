// SPDX-License-Identifier: AGPL-3.0-only
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';

import type {
  CreateCredentialRequest,
  CredentialDto,
  CredentialModel,
  CredentialTestResult,
  UpdateCredentialRequest,
} from '@app/shared';

import { asCredentialId, asWorkspaceId } from '../../db/ids';
// The concrete file, not the providers barrel: the barrel re-exports ProvidersModule, which
// imports this module for its resolver.
import { ProviderOps } from '../../providers/provider-ops.service';
import { CurrentPrincipal, RequireRole, type Principal } from '../auth';
import { toCredentialDto } from './credentials.mapper';
import { CredentialsService } from './credentials.service';

/**
 * Spec §17.4. Every route is admin-only: a credential is the workspace's spending power.
 * Responses never carry the secret; `toCredentialDto` has no field that could.
 */
@RequireRole('admin')
@Controller('v1/workspaces/:workspaceId/credentials')
export class CredentialsController {
  constructor(
    private readonly credentials: CredentialsService,
    private readonly ops: ProviderOps,
  ) {}

  @Get()
  async list(@Param('workspaceId') workspaceId: string): Promise<CredentialDto[]> {
    return (await this.credentials.list(asWorkspaceId(workspaceId))).map(toCredentialDto);
  }

  @Post()
  async create(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    // The create body is a discriminated union, which cannot become a nestjs-zod DTO class;
    // the service parses it with the same shared schema, so the 400 envelope is identical.
    @Body() body: CreateCredentialRequest,
  ): Promise<CredentialDto> {
    return toCredentialDto(
      await this.credentials.create(asWorkspaceId(workspaceId), body, principal.userId),
    );
  }

  @Patch(':credentialId')
  async update(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('credentialId') credentialId: string,
    @Body() body: UpdateCredentialRequest,
  ): Promise<CredentialDto> {
    return toCredentialDto(
      await this.credentials.update(
        asWorkspaceId(workspaceId),
        asCredentialId(credentialId),
        body,
        principal.userId,
      ),
    );
  }

  @Delete(':credentialId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('credentialId') credentialId: string,
  ): Promise<void> {
    await this.credentials.delete(
      asWorkspaceId(workspaceId),
      asCredentialId(credentialId),
      principal.userId,
    );
  }

  /** 200 either way: a failed test is a result, not a request error. */
  @Post(':credentialId/test')
  @HttpCode(HttpStatus.OK)
  async test(
    @Param('workspaceId') workspaceId: string,
    @Param('credentialId') credentialId: string,
  ): Promise<CredentialTestResult> {
    return this.ops.testConnection(asWorkspaceId(workspaceId), asCredentialId(credentialId));
  }

  @Get(':credentialId/models')
  async models(
    @Param('workspaceId') workspaceId: string,
    @Param('credentialId') credentialId: string,
  ): Promise<CredentialModel[]> {
    return this.ops.listModels(asWorkspaceId(workspaceId), asCredentialId(credentialId));
  }
}
