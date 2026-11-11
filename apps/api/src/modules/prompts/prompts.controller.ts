// SPDX-License-Identifier: AGPL-3.0-only
import { Body, Controller, Get, Param, Post } from '@nestjs/common';

import type { CreatePromptVersionRequest, PromptVersionDto } from '@app/shared';

import { asBotId, asWorkspaceId } from '../../db/ids';
import { CurrentPrincipal, RequireRole, type Principal } from '../auth';
import { toPromptVersionDto } from './prompts.mapper';
import { PromptsService } from './prompts.service';

/**
 * Spec §17.5. Admin-only: instructions decide what the bot says, and agents answer with it
 * rather than changing it. There is deliberately no PATCH or DELETE route — a version is a
 * record of what the bot was told.
 */
@RequireRole('admin')
@Controller('v1/workspaces/:workspaceId/bots/:botId/prompt-versions')
export class PromptsController {
  constructor(private readonly prompts: PromptsService) {}

  @Get()
  async list(
    @Param('workspaceId') workspaceId: string,
    @Param('botId') botId: string,
  ): Promise<PromptVersionDto[]> {
    return (await this.prompts.list(asWorkspaceId(workspaceId), asBotId(botId))).map(
      toPromptVersionDto,
    );
  }

  @Post()
  async create(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('botId') botId: string,
    @Body() body: CreatePromptVersionRequest,
  ): Promise<PromptVersionDto> {
    return toPromptVersionDto(
      await this.prompts.create(asWorkspaceId(workspaceId), asBotId(botId), body, principal.userId),
    );
  }
}
