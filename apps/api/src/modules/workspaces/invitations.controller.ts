// SPDX-License-Identifier: AGPL-3.0-only
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';

import type { AcceptInvitationResponse, CreatedInvitationDto, InvitationDto } from '@app/shared';
import { acceptInvitationRequestSchema, createInvitationRequestSchema } from '@app/shared';

import { asWorkspaceId } from '../../db/ids';
import { CurrentPrincipal, RequireRole, RequireVerifiedEmail } from '../auth';
import type { Principal } from '../auth';
import { InvitationsService } from './invitations.service';
import { toCreatedInvitationDto, toInvitationDto } from './workspaces.mapper';

class CreateInvitationDto extends createZodDto(createInvitationRequestSchema) {}
class AcceptInvitationDto extends createZodDto(acceptInvitationRequestSchema) {}

/** Spec §17.3 invitation routes. Managing invitations is admin-only; accepting needs a login. */
@Controller('v1')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @RequireRole('admin')
  @Post('workspaces/:workspaceId/invitations')
  async create(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Body() body: CreateInvitationDto,
  ): Promise<CreatedInvitationDto> {
    const created = await this.invitations.create(
      asWorkspaceId(workspaceId),
      principal.userId,
      body,
    );
    return toCreatedInvitationDto(created.invitation, created.acceptUrl);
  }

  @RequireRole('admin')
  @Get('workspaces/:workspaceId/invitations')
  async list(@Param('workspaceId') workspaceId: string): Promise<InvitationDto[]> {
    return (await this.invitations.list(asWorkspaceId(workspaceId))).map(toInvitationDto);
  }

  @RequireRole('admin')
  @Delete('workspaces/:workspaceId/invitations/:invitationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('invitationId') invitationId: string,
  ): Promise<void> {
    await this.invitations.revoke(asWorkspaceId(workspaceId), principal.userId, invitationId);
  }

  /** A verified address is required: otherwise anyone could sign up as the invitee and accept. */
  @RequireVerifiedEmail()
  @Post('invitations/accept')
  @HttpCode(HttpStatus.OK)
  async accept(
    @CurrentPrincipal() principal: Principal,
    @Body() body: AcceptInvitationDto,
  ): Promise<AcceptInvitationResponse> {
    return this.invitations.accept(principal.userId, body.token);
  }
}
