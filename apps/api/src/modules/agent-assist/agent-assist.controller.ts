// SPDX-License-Identifier: AGPL-3.0-only
import { Body, Controller, Param, Post } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';

import {
  suggestReplyRequestSchema,
  type ConversationAiArtifact,
  type SuggestedReplyArtifact,
} from '@app/shared';

import { AppError } from '../../common/errors';
import { RateLimit } from '../../common/security/rate-limit';
import { CurrentPrincipal, RequireRole, SessionOnly, type Principal } from '../auth';
import { AgentAssistService } from './agent-assist.service';

class SuggestReplyDto extends createZodDto(suggestReplyRequestSchema) {}

@RequireRole('agent')
@SessionOnly()
@Controller('v1/workspaces/:workspaceId/conversations/:conversationId/agent-assist')
export class AgentAssistController {
  constructor(private readonly assist: AgentAssistService) {}

  @Post('handoff-summary')
  async regenerate(
    @CurrentPrincipal() principal: Principal,
    @Param('conversationId') conversationId: string,
  ): Promise<ConversationAiArtifact> {
    const workspaceId = principal.workspace?.id;
    if (workspaceId === undefined) throw new AppError('not_found');
    return this.assist.regenerate(workspaceId, conversationId, principal.userId);
  }

  @Post('suggested-reply')
  @RateLimit('agentAssist')
  async suggestReply(
    @CurrentPrincipal() principal: Principal,
    @Param('conversationId') conversationId: string,
    @Body() body: SuggestReplyDto,
  ): Promise<SuggestedReplyArtifact> {
    const workspaceId = principal.workspace?.id;
    if (workspaceId === undefined) throw new AppError('not_found');
    return this.assist.suggestReply(
      workspaceId,
      conversationId,
      principal.userId,
      body.idempotencyKey,
    );
  }
}
