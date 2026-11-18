// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { ConversationAiArtifact } from '@app/shared';

import { Clock } from '../../common/clock';
import { AppError } from '../../common/errors';
import { AUDIT_LOG, type AuditWriter } from '../../common/ports/audit';
import type { UserId, WorkspaceId } from '../../db/ids';
import { JobsService } from '../../jobs';
import { AgentAssistRepository } from './agent-assist.repository';
import { HANDOFF_SUMMARY_JOB } from './handoff-summary.job';

function dto(
  row: NonNullable<Awaited<ReturnType<AgentAssistRepository['latest']>>>,
): ConversationAiArtifact {
  return {
    id: row.id,
    kind: 'handoff_summary',
    state: row.state,
    sourceThroughMessageId: row.sourceThroughMessageId,
    promptVersion: row.promptVersion,
    traceId: row.traceId,
    content: row.content as ConversationAiArtifact['content'],
    error: row.error,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class AgentAssistService {
  constructor(
    private readonly ds: DataSource,
    private readonly artifacts: AgentAssistRepository,
    private readonly jobs: JobsService,
    private readonly clock: Clock,
    @Inject(AUDIT_LOG) private readonly audit: AuditWriter,
  ) {}

  async latest(
    workspaceId: WorkspaceId,
    conversationId: string,
  ): Promise<ConversationAiArtifact | null> {
    const row = await this.artifacts.latest(workspaceId, conversationId);
    return row === null ? null : dto(row);
  }

  async summaryEnabled(workspaceId: WorkspaceId, botId: string): Promise<boolean> {
    const rows = await this.ds.query<{ enabled: boolean }[]>(
      `SELECT (agent_assist_enabled AND automatic_handoff_summaries AND deleted_at IS NULL) AS enabled
         FROM bots WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, botId],
    );
    return rows[0]?.enabled ?? false;
  }

  async regenerate(
    workspaceId: WorkspaceId,
    conversationId: string,
    actorUserId: UserId,
  ): Promise<ConversationAiArtifact> {
    const conversations = await this.ds.query<{ bot_id: string }[]>(
      `SELECT bot_id FROM conversations WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, conversationId],
    );
    const botId = conversations[0]?.bot_id;
    if (botId === undefined) throw new AppError('not_found');
    if (!(await this.summaryEnabled(workspaceId, botId))) {
      throw new AppError('validation_failed', {
        message: 'Handoff summaries are disabled for this bot.',
      });
    }
    const latest = await this.artifacts.latest(workspaceId, conversationId);
    if (latest !== null && ['queued', 'running'].includes(latest.state)) return dto(latest);
    if (latest !== null && this.clock.now().getTime() - latest.createdAt.getTime() < 30_000)
      return dto(latest);
    const created = await this.artifacts.createQueued({
      workspaceId,
      botId,
      conversationId,
      createdByUserId: actorUserId,
    });
    await this.audit.record({
      workspaceId,
      actorUserId,
      action: 'agent_assist.handoff_summary_requested',
      targetType: 'conversation',
      targetId: conversationId,
      metadata: { artifactId: created.id, promptVersion: created.promptVersion },
    });
    try {
      await this.jobs.enqueue(
        HANDOFF_SUMMARY_JOB,
        { workspaceId, botId, conversationId, artifactId: created.id },
        { singletonKey: `handoff-summary:${conversationId}` },
      );
    } catch {
      await this.artifacts.update(workspaceId, created.id, {
        state: 'failed',
        error: 'queue_unavailable',
      });
    }
    const row = await this.artifacts.find(workspaceId, created.id);
    if (row === null) throw new AppError('not_found');
    return dto(row);
  }
}
