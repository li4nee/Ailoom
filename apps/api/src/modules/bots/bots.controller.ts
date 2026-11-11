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

import type { BotDto, CreateBotRequest, UpdateBotRequest } from '@app/shared';

import { asBotId, asWorkspaceId } from '../../db/ids';
import { CurrentPrincipal, RequireRole, type Principal } from '../auth';
import { toBotDto } from './bots.mapper';
import { BotsService } from './bots.service';

/**
 * Spec §17.5. Agents read bots (they need to answer "why did it say that"); only admins change
 * them, because a bot's key and spending limits are workspace-wide.
 */
@Controller('v1/workspaces/:workspaceId/bots')
export class BotsController {
  constructor(private readonly bots: BotsService) {}

  @Get()
  @RequireRole('agent')
  async list(@Param('workspaceId') workspaceId: string): Promise<BotDto[]> {
    return (await this.bots.list(asWorkspaceId(workspaceId))).map(toBotDto);
  }

  @Get(':botId')
  @RequireRole('agent')
  async get(
    @Param('workspaceId') workspaceId: string,
    @Param('botId') botId: string,
  ): Promise<BotDto> {
    return toBotDto(await this.bots.get(asWorkspaceId(workspaceId), asBotId(botId)));
  }

  @Post()
  @RequireRole('admin')
  async create(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Body() body: CreateBotRequest,
  ): Promise<BotDto> {
    return toBotDto(await this.bots.create(asWorkspaceId(workspaceId), body, principal.userId));
  }

  @Patch(':botId')
  @RequireRole('admin')
  async update(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('botId') botId: string,
    @Body() body: UpdateBotRequest,
  ): Promise<BotDto> {
    return toBotDto(
      await this.bots.update(asWorkspaceId(workspaceId), asBotId(botId), body, principal.userId),
    );
  }

  /** 200, not 201: the key changes, nothing is created. */
  @Post(':botId/rotate-key')
  @RequireRole('admin')
  @HttpCode(HttpStatus.OK)
  async rotateKey(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('botId') botId: string,
  ): Promise<BotDto> {
    return toBotDto(
      await this.bots.rotateKey(asWorkspaceId(workspaceId), asBotId(botId), principal.userId),
    );
  }

  @Delete(':botId')
  @RequireRole('admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('botId') botId: string,
  ): Promise<void> {
    await this.bots.delete(asWorkspaceId(workspaceId), asBotId(botId), principal.userId);
  }
}
