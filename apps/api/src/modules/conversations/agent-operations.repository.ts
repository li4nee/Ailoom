// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import type { EntityManager } from 'typeorm';

import {
  DEFAULT_AGENT_OPERATIONS_POLICY,
  agentOperationsPolicySchema,
  type AgentOperationsPolicy,
  type AgentPresence,
  type AgentPresenceState,
} from '@app/shared';

import { AppError } from '../../common/errors';
import type { WorkspaceId } from '../../db/ids';
import { notifyWorkspace } from '../realtime';
import { MembershipEntity, WorkspaceEntity } from '../workspaces';
import { slaDeadlines } from './agent-operations.sla';
import { ConversationEntity } from './entities/conversation.entity';

export interface AssignedConversation {
  conversationId: string;
  botId: string;
  assignedUserId: string;
  workflowVersion: number;
}

export interface SlaBreach {
  conversationId: string;
  workspaceId: WorkspaceId;
  breach: 'first_response' | 'resolution';
}

function policyOf(value: Record<string, unknown>): AgentOperationsPolicy {
  const routing =
    typeof value['routing'] === 'object' && value['routing'] !== null
      ? (value['routing'] as Record<string, unknown>)
      : {};
  const sla =
    typeof value['sla'] === 'object' && value['sla'] !== null
      ? (value['sla'] as Record<string, unknown>)
      : {};
  const hours =
    typeof sla['businessHours'] === 'object' && sla['businessHours'] !== null
      ? (sla['businessHours'] as Record<string, unknown>)
      : {};
  const targets =
    typeof sla['targets'] === 'object' && sla['targets'] !== null
      ? (sla['targets'] as Record<string, unknown>)
      : {};
  const parsed = agentOperationsPolicySchema.safeParse({
    routing: { ...DEFAULT_AGENT_OPERATIONS_POLICY.routing, ...routing },
    sla: {
      ...DEFAULT_AGENT_OPERATIONS_POLICY.sla,
      ...sla,
      businessHours: { ...DEFAULT_AGENT_OPERATIONS_POLICY.sla.businessHours, ...hours },
      targets: { ...DEFAULT_AGENT_OPERATIONS_POLICY.sla.targets, ...targets },
    },
  });
  return parsed.success ? parsed.data : DEFAULT_AGENT_OPERATIONS_POLICY;
}

@Injectable()
export class AgentOperationsRepository {
  constructor(private readonly ds: DataSource) {}

  async policy(workspaceId: WorkspaceId): Promise<AgentOperationsPolicy> {
    const row = await this.ds
      .getRepository(WorkspaceEntity)
      .findOne({ where: { id: workspaceId } });
    if (row === null) throw new AppError('not_found');
    return policyOf(row.agentOperations);
  }

  async updatePolicy(
    workspaceId: WorkspaceId,
    policy: Omit<AgentOperationsPolicy, 'routing'> & {
      routing: Omit<AgentOperationsPolicy['routing'], 'lastAssignedUserId'>;
    },
    manager: EntityManager,
  ): Promise<AgentOperationsPolicy> {
    const workspace = await manager.getRepository(WorkspaceEntity).findOne({
      where: { id: workspaceId },
      lock: { mode: 'pessimistic_write' },
    });
    if (workspace === null) throw new AppError('not_found');
    const previous = policyOf(workspace.agentOperations);
    const next = agentOperationsPolicySchema.parse({
      ...policy,
      routing: { ...policy.routing, lastAssignedUserId: previous.routing.lastAssignedUserId },
    });
    workspace.agentOperations = next;
    await manager.getRepository(WorkspaceEntity).save(workspace);
    return next;
  }

  async setPresence(
    workspaceId: WorkspaceId,
    userId: string,
    state: AgentPresenceState,
    now: Date,
    leaseSeconds: number,
    manager: EntityManager,
  ): Promise<AgentPresence> {
    const expiresAt = state === 'offline' ? null : new Date(now.getTime() + leaseSeconds * 1000);
    const result = await manager
      .getRepository(MembershipEntity)
      .update({ workspaceId, userId }, { presenceState: state, presenceExpiresAt: expiresAt });
    if ((result.affected ?? 0) === 0) throw new AppError('not_found');
    return this.presence(workspaceId, userId, now, manager);
  }

  async listPresence(workspaceId: WorkspaceId, now: Date): Promise<AgentPresence[]> {
    return this.ds.query<AgentPresence[]>(
      `SELECT m.user_id AS "userId", u.name, u.email, m.role,
              CASE WHEN m.presence_state <> 'offline' AND m.presence_expires_at > $2
                   THEN m.presence_state ELSE 'offline' END AS state,
              CASE WHEN m.presence_state <> 'offline' AND m.presence_expires_at > $2
                   THEN m.presence_expires_at ELSE NULL END AS "expiresAt"
         FROM memberships m
         JOIN users u ON u.id = m.user_id
        WHERE m.workspace_id = $1
        ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
                 lower(u.email)`,
      [workspaceId, now],
    );
  }

  async heartbeatPresence(
    workspaceId: WorkspaceId,
    userId: string,
    now: Date,
    leaseSeconds: number,
    manager: EntityManager,
  ): Promise<AgentPresence> {
    await manager.query(
      `UPDATE memberships
          SET presence_expires_at = $3
        WHERE workspace_id = $1 AND user_id = $2
          AND presence_state IN ('online', 'away')`,
      [workspaceId, userId, new Date(now.getTime() + leaseSeconds * 1000)],
    );
    return this.presence(workspaceId, userId, now, manager);
  }

  async autoAssign(
    workspaceId: WorkspaceId,
    conversationId: string,
    now: Date,
  ): Promise<AssignedConversation | null> {
    return this.ds.transaction(async (manager) => {
      const workspace = await manager.getRepository(WorkspaceEntity).findOne({
        where: { id: workspaceId },
        lock: { mode: 'pessimistic_write' },
      });
      if (workspace === null) return null;
      const policy = policyOf(workspace.agentOperations);
      if (!policy.routing.enabled) return null;

      const conversationRows = await manager.query<
        { id: string; bot_id: string; status: string; assigned_user_id: string | null }[]
      >(
        `SELECT id, bot_id, status, assigned_user_id
           FROM conversations
          WHERE workspace_id = $1 AND id = $2
          FOR UPDATE`,
        [workspaceId, conversationId],
      );
      const conversation = conversationRows[0];
      if (conversation?.status !== 'needs_human' || conversation.assigned_user_id !== null) {
        return null;
      }

      const eligible = await manager.query<
        { user_id: string; email: string; open_count: number }[]
      >(
        `SELECT m.user_id, lower(u.email) AS email, count(c.id)::int AS open_count
           FROM memberships m
           JOIN users u ON u.id = m.user_id
           LEFT JOIN conversations c
             ON c.workspace_id = m.workspace_id
            AND c.assigned_user_id = m.user_id
            AND c.status IN ('needs_human', 'human')
            AND c.closed_at IS NULL
          WHERE m.workspace_id = $1
            AND m.role = ANY($2::role[])
            AND m.presence_state = 'online'
            AND m.presence_expires_at > $3
          GROUP BY m.user_id, u.email
         HAVING count(c.id) < $4
          ORDER BY CASE WHEN $5 = 'least_loaded' THEN count(c.id) ELSE 0 END,
                   lower(u.email), m.user_id`,
        [
          workspaceId,
          policy.routing.eligibleRoles,
          now,
          policy.routing.maxOpenConversationsPerAgent,
          policy.routing.strategy,
        ],
      );
      if (eligible.length === 0) return null;

      let selected = eligible[0];
      if (policy.routing.strategy === 'round_robin') {
        const lastIndex = eligible.findIndex(
          (candidate) => candidate.user_id === policy.routing.lastAssignedUserId,
        );
        selected = eligible[(lastIndex + 1) % eligible.length] ?? eligible[0];
      }
      if (selected === undefined) return null;

      const updated = await manager.getRepository(ConversationEntity).update(
        { id: conversationId, workspaceId, assignedUserId: IsNull(), status: 'needs_human' },
        {
          assignedUserId: selected.user_id,
          status: 'human',
          workflowVersion: () => '"workflow_version" + 1',
          lastWorkflowMutationId: null,
        },
      );
      if ((updated.affected ?? 0) === 0) return null;
      workspace.agentOperations = {
        ...policy,
        routing: { ...policy.routing, lastAssignedUserId: selected.user_id },
      };
      await manager.getRepository(WorkspaceEntity).save(workspace);
      const assigned = await manager.getRepository(ConversationEntity).findOne({
        where: { workspaceId, id: conversationId },
      });
      if (assigned === null) return null;
      await notifyWorkspace(manager, workspaceId, {
        type: 'conversation.updated',
        conversationId,
        botId: conversation.bot_id,
        status: 'human',
      });
      return {
        conversationId,
        botId: conversation.bot_id,
        assignedUserId: selected.user_id,
        workflowVersion: assigned.workflowVersion,
      };
    });
  }

  async initializeSla(workspaceId: WorkspaceId, conversationId: string): Promise<void> {
    await this.ds.transaction(async (manager) => {
      const conversation = await manager.getRepository(ConversationEntity).findOne({
        where: { workspaceId, id: conversationId },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        conversation?.handoffRequestedAt === null ||
        conversation?.handoffRequestedAt === undefined ||
        (conversation.status !== 'needs_human' && conversation.status !== 'human')
      ) {
        return;
      }
      const policy = await manager.getRepository(WorkspaceEntity).findOne({
        where: { id: workspaceId },
      });
      if (policy === null) return;
      const deadlines = slaDeadlines(
        conversation.handoffRequestedAt,
        conversation.priority,
        policyOf(policy.agentOperations).sla,
      );
      const update = {
        ...(conversation.firstResponseDueAt === null && deadlines.firstResponseDueAt !== null
          ? { firstResponseDueAt: deadlines.firstResponseDueAt }
          : {}),
        ...(conversation.resolutionDueAt === null && deadlines.resolutionDueAt !== null
          ? { resolutionDueAt: deadlines.resolutionDueAt }
          : {}),
      };
      if (Object.keys(update).length === 0) return;
      await manager
        .getRepository(ConversationEntity)
        .update({ id: conversationId, workspaceId }, update);
    });
  }

  async claimSlaBreaches(now: Date, manager: EntityManager, limit: number): Promise<SlaBreach[]> {
    return manager.query<SlaBreach[]>(
      `WITH due AS (
         SELECT workspace_id, id,
                (first_response_due_at <= $1 AND first_response_breached_at IS NULL
                  AND outcome_first_agent_reply_at IS NULL) AS response_due,
                (resolution_due_at <= $1 AND resolution_breached_at IS NULL
                  AND closed_at IS NULL) AS resolution_due
           FROM conversations
          WHERE status IN ('needs_human', 'human')
            AND closed_at IS NULL
            AND ((first_response_due_at <= $1 AND first_response_breached_at IS NULL
                  AND outcome_first_agent_reply_at IS NULL)
              OR (resolution_due_at <= $1 AND resolution_breached_at IS NULL))
          ORDER BY LEAST(
            COALESCE(first_response_due_at, 'infinity'::timestamptz),
            COALESCE(resolution_due_at, 'infinity'::timestamptz)
          )
          LIMIT $2
          FOR UPDATE SKIP LOCKED
       ), marked AS (
         UPDATE conversations c
            SET first_response_breached_at = CASE WHEN due.response_due THEN $1 ELSE c.first_response_breached_at END,
                resolution_breached_at = CASE WHEN due.resolution_due THEN $1 ELSE c.resolution_breached_at END
           FROM due
          WHERE c.workspace_id = due.workspace_id AND c.id = due.id
         RETURNING c.workspace_id, c.id, due.response_due, due.resolution_due
       )
       SELECT id AS "conversationId", workspace_id AS "workspaceId", 'first_response' AS breach
         FROM marked WHERE response_due
       UNION ALL
       SELECT id AS "conversationId", workspace_id AS "workspaceId", 'resolution' AS breach
         FROM marked WHERE resolution_due`,
      [now, limit],
    );
  }

  private async presence(
    workspaceId: WorkspaceId,
    userId: string,
    now: Date,
    manager: EntityManager,
  ): Promise<AgentPresence> {
    const rows = await manager.query<AgentPresence[]>(
      `SELECT m.user_id AS "userId", u.name, u.email, m.role,
              CASE WHEN m.presence_state <> 'offline' AND m.presence_expires_at > $3
                   THEN m.presence_state ELSE 'offline' END AS state,
              CASE WHEN m.presence_state <> 'offline' AND m.presence_expires_at > $3
                   THEN m.presence_expires_at ELSE NULL END AS "expiresAt"
         FROM memberships m
         JOIN users u ON u.id = m.user_id
        WHERE m.workspace_id = $1 AND m.user_id = $2`,
      [workspaceId, userId, now],
    );
    const row = rows[0];
    if (row === undefined) throw new AppError('not_found');
    return row;
  }
}
