// SPDX-License-Identifier: AGPL-3.0-only
import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';

import type { AdminMessage, ConversationStatusResponse } from '@app/shared';
import { agentMessageRequestSchema } from '@app/shared';

import { AppError } from '../../common/errors';
import type { WorkspaceId } from '../../db/ids';
import { CurrentPrincipal, RequireApiKeyScope, RequireRole, type Principal } from '../auth';
import { AgentActionsService } from './agent-actions.service';

class AgentMessageDto extends createZodDto(agentMessageRequestSchema) {}

/** The four conversation write actions of spec §17.7, available to every agent. */
@RequireRole('agent')
@RequireApiKeyScope('conversations:write')
@Controller('v1/workspaces/:workspaceId/conversations/:conversationId')
export class AgentActionsController {
  constructor(private readonly actions: AgentActionsService) {}

  @Post('messages')
  async reply(
    @CurrentPrincipal() principal: Principal,
    @Param('conversationId') conversationId: string,
    @Body() body: AgentMessageDto,
  ): Promise<AdminMessage> {
    return this.actions.reply(this.workspaceOf(principal), conversationId, principal.userId, body);
  }

  @Post('takeover')
  @HttpCode(HttpStatus.OK)
  async takeOver(
    @CurrentPrincipal() principal: Principal,
    @Param('conversationId') conversationId: string,
  ): Promise<ConversationStatusResponse> {
    return {
      status: await this.actions.takeOver(
        this.workspaceOf(principal),
        conversationId,
        principal.userId,
      ),
    };
  }

  @Post('handback')
  @HttpCode(HttpStatus.OK)
  async handBack(
    @CurrentPrincipal() principal: Principal,
    @Param('conversationId') conversationId: string,
  ): Promise<ConversationStatusResponse> {
    return {
      status: await this.actions.handBack(
        this.workspaceOf(principal),
        conversationId,
        principal.userId,
      ),
    };
  }

  @Post('close')
  @HttpCode(HttpStatus.OK)
  async close(
    @CurrentPrincipal() principal: Principal,
    @Param('conversationId') conversationId: string,
  ): Promise<ConversationStatusResponse> {
    return {
      status: await this.actions.close(
        this.workspaceOf(principal),
        conversationId,
        principal.userId,
      ),
    };
  }

  private workspaceOf(principal: Principal): WorkspaceId {
    const workspaceId = principal.workspace?.id;
    if (workspaceId === undefined) throw new AppError('not_found');
    return workspaceId;
  }
}
