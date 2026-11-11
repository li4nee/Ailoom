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
import { createZodDto } from 'nestjs-zod';

import type { MemberDto, WorkspaceDto, WorkspaceSummaryDto } from '@app/shared';
import {
  createWorkspaceRequestSchema,
  transferOwnershipRequestSchema,
  updateMemberRequestSchema,
  updateWorkspaceRequestSchema,
} from '@app/shared';

import { asWorkspaceId } from '../../db/ids';
import { CurrentPrincipal, RequireRole, RequireVerifiedEmail } from '../auth';
import type { Principal } from '../auth';
import { MembersService } from './members.service';
import { toMemberDto, toWorkspaceDto, toWorkspaceSummaryDto } from './workspaces.mapper';
import { WorkspacesService } from './workspaces.service';

class CreateWorkspaceDto extends createZodDto(createWorkspaceRequestSchema) {}
class UpdateWorkspaceDto extends createZodDto(updateWorkspaceRequestSchema) {}
class UpdateMemberDto extends createZodDto(updateMemberRequestSchema) {}
class TransferOwnershipDto extends createZodDto(transferOwnershipRequestSchema) {}

/**
 * Spec §17.3. Reads are open to every member; settings and member management are admin-only,
 * and only the owner transfers ownership. Invitations live in `InvitationsController`.
 */
@Controller('v1/workspaces')
export class WorkspacesController {
  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly memberService: MembersService,
  ) {}

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

  @RequireRole('owner')
  @Delete(':workspaceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
  ): Promise<void> {
    await this.workspaces.delete(workspaceId, principal.userId);
  }

  @RequireRole('admin')
  @Get(':workspaceId/members')
  async members(@Param('workspaceId') workspaceId: string): Promise<MemberDto[]> {
    return (await this.workspaces.members(workspaceId)).map(toMemberDto);
  }

  @RequireRole('admin')
  @Patch(':workspaceId/members/:userId')
  async changeRole(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('userId') userId: string,
    @Body() body: UpdateMemberDto,
  ): Promise<MemberDto> {
    return toMemberDto(
      await this.memberService.changeRole(
        asWorkspaceId(workspaceId),
        principal.userId,
        userId,
        body.role,
      ),
    );
  }

  @RequireRole('admin')
  @Delete(':workspaceId/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeMember(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('userId') userId: string,
  ): Promise<void> {
    await this.memberService.remove(asWorkspaceId(workspaceId), principal.userId, userId);
  }

  @RequireRole('owner')
  @Post(':workspaceId/transfer-ownership')
  @HttpCode(HttpStatus.NO_CONTENT)
  async transferOwnership(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Body() body: TransferOwnershipDto,
  ): Promise<void> {
    await this.memberService.transferOwnership(
      asWorkspaceId(workspaceId),
      principal.userId,
      body.userId,
    );
  }
}
