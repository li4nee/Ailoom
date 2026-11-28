// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';

import {
  AGENT_PRESENCE_LEASE_SECONDS,
  type AgentOperationsPolicy,
  type AgentOperationsPolicyUpdate,
  type AgentPresence,
  type AgentPresenceState,
} from '@app/shared';

import { Clock } from '../../common/clock';
import { AUDIT_LOG, type AuditWriter } from '../../common/ports/audit';
import { asUserId, type UserId, type WorkspaceId } from '../../db/ids';
import { NotificationsService } from '../notifications';
import { AgentOperationsRepository, type SlaBreach } from './agent-operations.repository';

@Injectable()
export class AgentOperationsService {
  constructor(
    private readonly ds: DataSource,
    private readonly repository: AgentOperationsRepository,
    private readonly clock: Clock,
    @Inject(AUDIT_LOG) private readonly audit: AuditWriter,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  getPolicy(workspaceId: WorkspaceId): Promise<AgentOperationsPolicy> {
    return this.repository.policy(workspaceId);
  }

  async updatePolicy(
    workspaceId: WorkspaceId,
    actorUserId: UserId,
    input: AgentOperationsPolicyUpdate,
  ): Promise<AgentOperationsPolicy> {
    return this.ds.transaction(async (manager) => {
      const policy = await this.repository.updatePolicy(workspaceId, input, manager);
      await this.audit.record(
        {
          workspaceId,
          actorUserId,
          action: 'agent_operations.updated',
          targetType: 'workspace',
          targetId: workspaceId,
          metadata: {
            routingEnabled: policy.routing.enabled,
            routingStrategy: policy.routing.strategy,
            configuredSlaPriorities: Object.entries(policy.sla.targets)
              .filter(
                ([, target]) =>
                  target.firstResponseMinutes !== null || target.resolutionMinutes !== null,
              )
              .map(([priority]) => priority),
          },
        },
        manager,
      );
      return policy;
    });
  }

  async listPresence(workspaceId: WorkspaceId): Promise<AgentPresence[]> {
    return this.repository.listPresence(workspaceId, this.clock.now());
  }

  async updatePresence(
    workspaceId: WorkspaceId,
    userId: UserId,
    state: AgentPresenceState,
  ): Promise<AgentPresence> {
    const now = this.clock.now();
    return this.ds.transaction(async (manager) => {
      const presence = await this.repository.setPresence(
        workspaceId,
        userId,
        state,
        now,
        AGENT_PRESENCE_LEASE_SECONDS,
        manager,
      );
      await this.audit.record(
        {
          workspaceId,
          actorUserId: userId,
          action: 'member.presence_changed',
          targetType: 'member',
          targetId: userId,
          metadata: { state: presence.state },
        },
        manager,
      );
      return presence;
    });
  }

  async heartbeatPresence(workspaceId: WorkspaceId, userId: UserId): Promise<AgentPresence> {
    return this.ds.transaction((manager) =>
      this.repository.heartbeatPresence(
        workspaceId,
        userId,
        this.clock.now(),
        AGENT_PRESENCE_LEASE_SECONDS,
        manager,
      ),
    );
  }

  async routeHandoff(workspaceId: WorkspaceId, conversationId: string): Promise<void> {
    await this.repository.initializeSla(workspaceId, conversationId);
    const assigned = await this.repository.autoAssign(
      workspaceId,
      conversationId,
      this.clock.now(),
    );
    if (assigned === null) return;
    await this.ds.transaction(async (manager) => {
      await this.audit.record(
        {
          workspaceId,
          actorUserId: null,
          action: 'conversation.auto_assigned',
          targetType: 'conversation',
          targetId: conversationId,
          metadata: { assignedUserId: assigned.assignedUserId },
        },
        manager,
      );
      await this.notifications?.notify(manager, {
        type: 'conversation_assigned',
        workspaceId,
        conversationId,
        botId: assigned.botId,
        actorUserId: null,
        assigneeUserId: asUserId(assigned.assignedUserId),
        actorName: 'Auto-routing',
      });
    });
  }

  async processSlaBreaches(): Promise<number> {
    const now = this.clock.now();
    return this.ds.transaction(async (manager) => {
      const breaches = await this.repository.claimSlaBreaches(now, manager, 100);
      for (const breach of breaches) await this.recordBreach(breach, manager);
      return breaches.length;
    });
  }

  private async recordBreach(breach: SlaBreach, manager: EntityManager): Promise<void> {
    await this.audit.record(
      {
        workspaceId: breach.workspaceId,
        actorUserId: null,
        action: 'conversation.sla_breached',
        targetType: 'conversation',
        targetId: breach.conversationId,
        metadata: { breach: breach.breach },
      },
      manager,
    );
    await this.notifications?.notify(manager, {
      type: 'sla_breached',
      workspaceId: breach.workspaceId,
      conversationId: breach.conversationId,
      breach: breach.breach,
      actorUserId: null,
    });
  }
}
