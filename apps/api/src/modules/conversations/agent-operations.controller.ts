// SPDX-License-Identifier: AGPL-3.0-only
import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';

import {
  agentOperationsPolicyUpdateSchema,
  agentPresenceUpdateSchema,
  type AgentOperationsPolicy,
  type AgentPresence,
} from '@app/shared';

import { AppError } from '../../common/errors';
import type { WorkspaceId } from '../../db/ids';
import { CurrentPrincipal, RequireRole, SessionOnly, type Principal } from '../auth';
import { AgentOperationsService } from './agent-operations.service';

class AgentOperationsPolicyDto extends createZodDto(agentOperationsPolicyUpdateSchema) {}
class AgentPresenceDto extends createZodDto(agentPresenceUpdateSchema) {}

@SessionOnly()
@Controller('v1/workspaces/:workspaceId/agent-operations')
export class AgentOperationsController {
  constructor(private readonly operations: AgentOperationsService) {}

  @Get()
  @RequireRole('admin')
  getPolicy(@CurrentPrincipal() principal: Principal): Promise<AgentOperationsPolicy> {
    return this.operations.getPolicy(this.workspaceOf(principal));
  }

  @Put()
  @RequireRole('admin')
  updatePolicy(
    @CurrentPrincipal() principal: Principal,
    @Body() body: AgentOperationsPolicyDto,
  ): Promise<AgentOperationsPolicy> {
    return this.operations.updatePolicy(this.workspaceOf(principal), principal.userId, body);
  }

  @Get('presence')
  @RequireRole('agent')
  listPresence(@CurrentPrincipal() principal: Principal): Promise<AgentPresence[]> {
    return this.operations.listPresence(this.workspaceOf(principal));
  }

  @Put('presence')
  @RequireRole('agent')
  updatePresence(
    @CurrentPrincipal() principal: Principal,
    @Body() body: AgentPresenceDto,
  ): Promise<AgentPresence> {
    return this.operations.updatePresence(
      this.workspaceOf(principal),
      principal.userId,
      body.state,
    );
  }

  @Post('presence/heartbeat')
  @RequireRole('agent')
  heartbeatPresence(@CurrentPrincipal() principal: Principal): Promise<AgentPresence> {
    return this.operations.heartbeatPresence(this.workspaceOf(principal), principal.userId);
  }

  private workspaceOf(principal: Principal): WorkspaceId {
    const workspaceId = principal.workspace?.id;
    if (workspaceId === undefined) throw new AppError('not_found');
    return workspaceId;
  }
}
