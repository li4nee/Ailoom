// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { WorkspaceId } from '../../db/ids';
import { ConversationAiArtifactEntity } from './conversation-ai-artifact.entity';

@Injectable()
export class AgentAssistRepository {
  constructor(private readonly ds: DataSource) {}

  create(input: Partial<ConversationAiArtifactEntity>): Promise<ConversationAiArtifactEntity> {
    return this.ds.getRepository(ConversationAiArtifactEntity).save(input);
  }

  async find(workspaceId: WorkspaceId, id: string): Promise<ConversationAiArtifactEntity | null> {
    return this.ds
      .getRepository(ConversationAiArtifactEntity)
      .findOne({ where: { workspaceId, id } });
  }

  async latest(
    workspaceId: WorkspaceId,
    conversationId: string,
  ): Promise<ConversationAiArtifactEntity | null> {
    return this.ds.getRepository(ConversationAiArtifactEntity).findOne({
      where: { workspaceId, conversationId, kind: 'handoff_summary' },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
  }

  async createQueued(input: {
    workspaceId: WorkspaceId;
    botId: string;
    conversationId: string;
    createdByUserId?: string | null;
  }): Promise<ConversationAiArtifactEntity> {
    const rows = await this.ds.query<{ id: string }[]>(
      `INSERT INTO conversation_ai_artifacts
         (workspace_id, bot_id, conversation_id, kind, state, prompt_version, created_by_user_id)
       VALUES ($1, $2, $3, 'handoff_summary', 'queued', 'handoff-summary-v1', $4)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [input.workspaceId, input.botId, input.conversationId, input.createdByUserId ?? null],
    );
    if (rows[0] !== undefined) {
      const created = await this.find(input.workspaceId, rows[0].id);
      if (created !== null) return created;
    }
    const pending = await this.ds.getRepository(ConversationAiArtifactEntity).findOne({
      where: {
        workspaceId: input.workspaceId,
        botId: input.botId,
        conversationId: input.conversationId,
        kind: 'handoff_summary',
        state: 'queued',
      },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
    if (pending !== null) return pending;
    throw new Error('Could not create handoff summary artifact.');
  }

  async list(
    workspaceId: WorkspaceId,
    conversationId: string,
  ): Promise<ConversationAiArtifactEntity[]> {
    return this.ds.getRepository(ConversationAiArtifactEntity).find({
      where: { workspaceId, conversationId, kind: 'handoff_summary' },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: 5,
    });
  }

  async update(
    workspaceId: WorkspaceId,
    id: string,
    patch: Partial<ConversationAiArtifactEntity>,
  ): Promise<void> {
    const repository = this.ds.getRepository(ConversationAiArtifactEntity);
    const row = await repository.findOne({ where: { workspaceId, id } });
    if (row === null) return;
    Object.assign(row, patch);
    await repository.save(row);
  }
}
