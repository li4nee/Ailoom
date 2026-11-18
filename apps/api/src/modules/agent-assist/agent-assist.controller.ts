// SPDX-License-Identifier: AGPL-3.0-only
import { Controller, Param, Post } from '@nestjs/common';

import type { ConversationAiArtifact } from '@app/shared';

import { AppError } from '../../common/errors';
import { CurrentPrincipal, RequireRole, SessionOnly, type Principal } from '../auth';
import { AgentAssistService } from './agent-assist.service';

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
}
