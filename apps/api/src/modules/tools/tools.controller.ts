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

import type { CreateBotToolRequest, DiscoverMcpToolsRequest } from '@app/shared';

import { asWorkspaceId } from '../../db/ids';
import { CurrentPrincipal, RequireRole, type Principal } from '../auth';
import { ToolsService } from './tools.service';

@Controller('v1/workspaces/:workspaceId/bots/:botId/tools')
export class ToolsController {
  constructor(private readonly tools: ToolsService) {}

  @Get()
  @RequireRole('admin')
  list(@Param('workspaceId') workspaceId: string, @Param('botId') botId: string) {
    return this.tools.list(asWorkspaceId(workspaceId), botId);
  }

  @Post('mcp/discover')
  @RequireRole('admin')
  discoverMcp(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('botId') botId: string,
    @Body() body: DiscoverMcpToolsRequest,
  ) {
    return this.tools.discoverMcp(asWorkspaceId(workspaceId), botId, body, principal.userId);
  }

  @Get(':toolId')
  @RequireRole('admin')
  get(
    @Param('workspaceId') workspaceId: string,
    @Param('botId') botId: string,
    @Param('toolId') toolId: string,
  ) {
    return this.tools.get(asWorkspaceId(workspaceId), botId, toolId);
  }

  @Post()
  @RequireRole('admin')
  create(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('botId') botId: string,
    @Body() body: CreateBotToolRequest,
  ) {
    return this.tools.create(asWorkspaceId(workspaceId), botId, body, principal.userId);
  }

  @Patch(':toolId')
  @RequireRole('admin')
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('botId') botId: string,
    @Param('toolId') toolId: string,
    @Body() body: Partial<CreateBotToolRequest>,
  ) {
    return this.tools.update(asWorkspaceId(workspaceId), botId, toolId, body, principal.userId);
  }

  @Post(':toolId/test')
  @RequireRole('admin')
  test(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('botId') botId: string,
    @Param('toolId') toolId: string,
  ) {
    return this.tools.test(asWorkspaceId(workspaceId), botId, toolId, principal.userId);
  }

  @Delete(':toolId')
  @RequireRole('admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('botId') botId: string,
    @Param('toolId') toolId: string,
  ): Promise<void> {
    await this.tools.remove(asWorkspaceId(workspaceId), botId, toolId, principal.userId);
  }
}
