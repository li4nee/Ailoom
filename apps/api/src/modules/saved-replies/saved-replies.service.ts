// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { SavedReply, SavedReplyOrder, SavedReplyQuery, SavedReplyWrite } from '@app/shared';

import { Clock } from '../../common/clock';
import { AppError } from '../../common/errors';
import { AUDIT_LOG, type AuditWriter } from '../../common/ports/audit';
import type { UserId, WorkspaceId } from '../../db/ids';
import { isUniqueViolation } from '../../db/postgres-errors';
import { SavedRepliesRepository } from './saved-replies.repository';
import type { SavedReplyEntity } from './saved-reply.entity';

function toDto(row: Awaited<ReturnType<SavedRepliesRepository['getById']>>): SavedReply {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    sortOrder: row.sortOrder,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class SavedRepliesService {
  constructor(
    private readonly ds: DataSource,
    private readonly replies: SavedRepliesRepository,
    private readonly clock: Clock,
    @Inject(AUDIT_LOG) private readonly audit: AuditWriter,
  ) {}

  async list(workspaceId: WorkspaceId, query: SavedReplyQuery): Promise<SavedReply[]> {
    const rows = await this.replies.listForWorkspace(workspaceId, {
      ...(query.q === undefined ? {} : { query: query.q }),
      includeArchived: query.includeArchived === 'true',
    });
    return rows.map(toDto);
  }

  async create(
    workspaceId: WorkspaceId,
    actorId: UserId,
    input: SavedReplyWrite,
  ): Promise<SavedReply> {
    const title = input.title.trim();
    const created = await this.ds.transaction(async (manager) => {
      const row = await this.replies.insert(
        workspaceId,
        {
          title,
          body: input.body.trim(),
          normalizedTitle: title.toLocaleLowerCase('en-US'),
          sortOrder: 0,
          archivedAt: null,
          createdBy: actorId,
          updatedBy: actorId,
        },
        manager,
      );
      await this.audit.record(
        {
          workspaceId,
          actorUserId: actorId,
          action: 'saved_reply.created',
          targetType: 'saved_reply',
          targetId: row.id,
          metadata: { title: row.title },
        },
        manager,
      );
      return row;
    });
    return toDto(created);
  }

  async update(
    workspaceId: WorkspaceId,
    actorId: UserId,
    id: string,
    input: SavedReplyWrite,
  ): Promise<SavedReply> {
    const updated = await this.ds.transaction(async (manager) => {
      const row = await this.replies.getById(workspaceId, id, 'not_found', manager);
      if (row.archivedAt !== null) throw new AppError('not_found');
      let next: SavedReplyEntity;
      try {
        next = await this.replies.updateById(
          workspaceId,
          id,
          {
            title: input.title.trim(),
            body: input.body.trim(),
            normalizedTitle: input.title.trim().toLocaleLowerCase('en-US'),
            updatedBy: actorId,
          },
          manager,
        );
      } catch (error) {
        if (isUniqueViolation(error)) throw new AppError('conflict', { cause: error });
        throw error;
      }
      await this.audit.record(
        {
          workspaceId,
          actorUserId: actorId,
          action: 'saved_reply.updated',
          targetType: 'saved_reply',
          targetId: id,
          metadata: { title: next.title },
        },
        manager,
      );
      return next;
    });
    return toDto(updated);
  }

  async archive(workspaceId: WorkspaceId, actorId: UserId, id: string): Promise<void> {
    await this.ds.transaction(async (manager) => {
      const row = await this.replies.getById(workspaceId, id, 'not_found', manager);
      if (row.archivedAt !== null) return;
      await this.replies.updateById(
        workspaceId,
        id,
        { archivedAt: this.clock.now(), updatedBy: actorId },
        manager,
      );
      await this.audit.record(
        {
          workspaceId,
          actorUserId: actorId,
          action: 'saved_reply.archived',
          targetType: 'saved_reply',
          targetId: id,
          metadata: {},
        },
        manager,
      );
    });
  }

  async reorder(workspaceId: WorkspaceId, actorId: UserId, input: SavedReplyOrder): Promise<void> {
    await this.ds.transaction(async (manager) => {
      for (const id of input.ids) {
        const row = await this.replies.getById(workspaceId, id, 'not_found', manager);
        if (row.archivedAt !== null) throw new AppError('not_found');
      }
      const active = await this.replies.listForWorkspace(
        workspaceId,
        { includeArchived: false },
        manager,
      );
      const activeIds = new Set(active.map((row) => row.id));
      if (
        input.ids.length !== active.length ||
        new Set(input.ids).size !== input.ids.length ||
        input.ids.some((id) => !activeIds.has(id))
      ) {
        throw new AppError('validation_failed');
      }
      for (const [sortOrder, id] of input.ids.entries()) {
        await this.replies.updateById(workspaceId, id, { sortOrder, updatedBy: actorId }, manager);
      }
      await this.audit.record(
        {
          workspaceId,
          actorUserId: actorId,
          action: 'saved_reply.reordered',
          targetType: 'workspace',
          targetId: workspaceId,
          metadata: { count: input.ids.length },
        },
        manager,
      );
    });
  }
}
