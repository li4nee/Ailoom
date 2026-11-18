// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';

import { CHAT_HANDOFF_REQUESTED, type ChatHandoffRequestedEvent } from '../../events';
import { JobsService } from '../../jobs';
import { AgentAssistRepository } from './agent-assist.repository';
import { HANDOFF_SUMMARY_JOB } from './handoff-summary.job';

@Injectable()
export class HandoffSummaryListener {
  private readonly logger = new Logger(HandoffSummaryListener.name);

  constructor(
    private readonly ds: DataSource,
    private readonly artifacts: AgentAssistRepository,
    private readonly jobs: JobsService,
  ) {}

  @OnEvent(CHAT_HANDOFF_REQUESTED)
  async handle(event: ChatHandoffRequestedEvent): Promise<void> {
    const bots = await this.ds.query<{ enabled: boolean }[]>(
      `SELECT (agent_assist_enabled AND automatic_handoff_summaries AND deleted_at IS NULL) AS enabled
         FROM bots WHERE workspace_id = $1 AND id = $2`,
      [event.workspaceId, event.botId],
    );
    if (bots[0]?.enabled !== true) return;
    const previous = await this.artifacts.latest(event.workspaceId, event.conversationId);
    if (previous !== null && ['queued', 'running'].includes(previous.state)) return;
    const created = await this.artifacts.createQueued({
      workspaceId: event.workspaceId,
      botId: event.botId,
      conversationId: event.conversationId,
    });
    try {
      await this.jobs.enqueue(
        HANDOFF_SUMMARY_JOB,
        {
          workspaceId: event.workspaceId,
          botId: event.botId,
          conversationId: event.conversationId,
          artifactId: created.id,
        },
        { singletonKey: `handoff-summary:${event.conversationId}` },
      );
    } catch {
      this.logger.warn(`handoff summary could not be queued for ${event.conversationId}`);
      await this.artifacts.update(event.workspaceId, created.id, {
        state: 'failed',
        error: 'queue_unavailable',
      });
    }
  }
}
