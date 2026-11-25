// SPDX-License-Identifier: AGPL-3.0-only
import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { z } from 'zod';

import type { CreatePromptVersionRequest, PromptVersionDto } from '@app/shared';

import { AppError } from '../../common/errors';
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

  @Post(':versionId/activate')
  async activate(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('botId') botId: string,
    @Param('versionId') versionId: string,
    @Body() body: unknown,
  ): Promise<PromptVersionDto> {
    const parsed = z
      .object({ overrideReason: z.string().trim().min(1).max(500).optional() })
      .safeParse(body ?? {});
    if (!parsed.success) throw new AppError('validation_failed');
    const version = await this.prompts.activate(
      asWorkspaceId(workspaceId),
      asBotId(botId),
      versionId,
      principal.userId,
      principal.workspace?.role ?? 'agent',
      parsed.data.overrideReason,
    );
    if (version === null) throw new AppError('not_found');
    return toPromptVersionDto(version);
  }
}
