// SPDX-License-Identifier: AGPL-3.0-only
import { Controller, Get, Param, Query } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';

import type {
  ConversationCounts,
  ConversationDetail,
  ConversationListItem,
  Page,
} from '@app/shared';
import { conversationInboxQuerySchema } from '@app/shared';

import { AppError } from '../../common/errors';
import type { WorkspaceId } from '../../db/ids';
import { CurrentPrincipal, RequireApiKeyScope, RequireRole, type Principal } from '../auth';
import { ConversationsService } from './conversations.service';

class ConversationInboxQueryDto extends createZodDto(conversationInboxQuerySchema) {}

/** The agent inbox and conversation timeline (spec §17.7). */
@RequireRole('agent')
@RequireApiKeyScope('conversations:read')
@Controller('v1/workspaces/:workspaceId/conversations')
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get()
  async list(
    @CurrentPrincipal() principal: Principal,
    @Query() query: ConversationInboxQueryDto,
  ): Promise<Page<ConversationListItem>> {
    return this.conversations.list(this.workspaceOf(principal), query, principal.userId);
  }

  @Get('counts')
  async counts(@CurrentPrincipal() principal: Principal): Promise<ConversationCounts> {
    return this.conversations.counts(this.workspaceOf(principal), principal.userId);
  }

  @Get(':conversationId')
  async detail(
    @CurrentPrincipal() principal: Principal,
    @Param('conversationId') conversationId: string,
  ): Promise<ConversationDetail> {
    return this.conversations.detail(this.workspaceOf(principal), conversationId);
  }

  private workspaceOf(principal: Principal): WorkspaceId {
    const workspaceId = principal.workspace?.id;
    if (workspaceId === undefined) throw new AppError('not_found');
    return workspaceId;
  }
}
