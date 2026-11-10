// SPDX-License-Identifier: AGPL-3.0-only
import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';

import type { MemberDto, WorkspaceDto, WorkspaceSummaryDto } from '@app/shared';
import { createWorkspaceRequestSchema, updateWorkspaceRequestSchema } from '@app/shared';

import { CurrentPrincipal, RequireRole, RequireVerifiedEmail } from '../auth';
import type { Principal } from '../auth';
import { toMemberDto, toWorkspaceDto, toWorkspaceSummaryDto } from './workspaces.mapper';
import { WorkspacesService } from './workspaces.service';

class CreateWorkspaceDto extends createZodDto(createWorkspaceRequestSchema) {}
class UpdateWorkspaceDto extends createZodDto(updateWorkspaceRequestSchema) {}

/** Spec §17.3. Reads are open to every member; settings and member lists are admin-only. */
@Controller('v1/workspaces')
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @RequireVerifiedEmail()
  @Post()
  async create(
    @CurrentPrincipal() principal: Principal,
    @Body() body: CreateWorkspaceDto,
  ): Promise<WorkspaceDto> {
    return toWorkspaceDto(await this.workspaces.create(principal.userId, body));
  }

  @Get()
  async list(@CurrentPrincipal() principal: Principal): Promise<WorkspaceSummaryDto[]> {
    return (await this.workspaces.list(principal.userId)).map(toWorkspaceSummaryDto);
  }

  @Get(':workspaceId')
  async get(@Param('workspaceId') workspaceId: string): Promise<WorkspaceDto> {
    return toWorkspaceDto(await this.workspaces.get(workspaceId));
  }

  @RequireRole('admin')
  @Patch(':workspaceId')
  async update(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Body() body: UpdateWorkspaceDto,
  ): Promise<WorkspaceDto> {
    return toWorkspaceDto(await this.workspaces.update(workspaceId, principal.userId, body));
  }

  @RequireRole('admin')
  @Get(':workspaceId/members')
  async members(@Param('workspaceId') workspaceId: string): Promise<MemberDto[]> {
    return (await this.workspaces.members(workspaceId)).map(toMemberDto);
  }
}
