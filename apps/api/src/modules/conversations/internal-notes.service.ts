// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';

import type { InternalNote, InternalNoteUpdate, InternalNoteWrite, Role } from '@app/shared';

import { Clock } from '../../common/clock';
import { AppError } from '../../common/errors';
import { newId } from '../../common/ids';
import { AUDIT_LOG, type AuditWriter } from '../../common/ports/audit';
import { isUuid, type UserId, type WorkspaceId } from '../../db/ids';
import { notifyWorkspace } from '../realtime';
import { InternalNoteEntity } from './entities/internal-note.entity';
import { InternalNotesRepository } from './internal-notes.repository';

@Injectable()
export class InternalNotesService {
  constructor(
    private readonly ds: DataSource,
    private readonly notes: InternalNotesRepository,
    private readonly clock: Clock,
    @Inject(AUDIT_LOG) private readonly audit: AuditWriter,
  ) {}

  async list(workspaceId: WorkspaceId, conversationId: string): Promise<InternalNote[]> {
    await this.assertConversation(workspaceId, conversationId);
    return (await this.notes.list(workspaceId, conversationId)).map(toDto);
  }

  async create(
    workspaceId: WorkspaceId,
    conversationId: string,
    actorUserId: UserId,
    input: InternalNoteWrite,
  ): Promise<InternalNote> {
    return this.ds.transaction(async (manager) => {
      await this.assertConversation(workspaceId, conversationId, manager);
      await this.actorRole(workspaceId, actorUserId, manager);
      const id = newId();
      const now = this.clock.now();
      const rows = await manager.query<{ id: string }[]>(
        `INSERT INTO conversation_internal_notes
          (id, workspace_id, conversation_id, author_user_id, body, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 1, $6, $6) RETURNING id`,
        [id, workspaceId, conversationId, actorUserId, input.body.trim(), now],
      );
      const note = await this.getInTransaction(workspaceId, conversationId, rows[0]?.id, manager);
      await this.audit.record(
        {
          workspaceId,
          actorUserId,
          action: 'internal_note.created',
          targetType: 'conversation_internal_note',
          targetId: note.id,
          metadata: { conversationId, version: note.version },
        },
        manager,
      );
      await notifyWorkspace(manager, workspaceId, {
        type: 'internal_note.created',
        conversationId,
        noteId: note.id,
      });
      return toDto(note);
    });
  }

  async update(
    workspaceId: WorkspaceId,
    conversationId: string,
    noteId: string,
    actorUserId: UserId,
    input: InternalNoteUpdate,
  ): Promise<InternalNote> {
    return this.ds.transaction(async (manager) => {
      const role = await this.actorRole(workspaceId, actorUserId, manager);
      const note = await this.notes.lock(workspaceId, conversationId, noteId, manager);
      this.assertVersion(note, input.expectedVersion);
      this.assertCanManage(note, actorUserId, role);
      if (note.deletedAt !== null) throw new AppError('not_found');
      const now = this.clock.now();
      await manager.query(
        `UPDATE conversation_internal_notes SET body = $4, version = version + 1, updated_at = $5
         WHERE workspace_id = $1 AND conversation_id = $2 AND id = $3`,
        [workspaceId, conversationId, noteId, input.body.trim(), now],
      );
      const updated = await this.getInTransaction(workspaceId, conversationId, noteId, manager);
      await this.audit.record(
        {
          workspaceId,
          actorUserId,
          action: 'internal_note.updated',
          targetType: 'conversation_internal_note',
          targetId: noteId,
          metadata: { conversationId, version: updated.version },
        },
        manager,
      );
      await notifyWorkspace(manager, workspaceId, {
        type: 'internal_note.updated',
        conversationId,
        noteId,
      });
      return toDto(updated);
    });
  }

  async delete(
    workspaceId: WorkspaceId,
    conversationId: string,
    noteId: string,
    actorUserId: UserId,
    expectedVersion: number,
  ): Promise<InternalNote> {
    return this.ds.transaction(async (manager) => {
      const role = await this.actorRole(workspaceId, actorUserId, manager);
      const note = await this.notes.lock(workspaceId, conversationId, noteId, manager);
      this.assertVersion(note, expectedVersion);
      this.assertCanManage(note, actorUserId, role);
      if (note.deletedAt !== null) throw new AppError('not_found');
      const now = this.clock.now();
      await manager.query(
        `UPDATE conversation_internal_notes
            SET body = NULL, deleted_at = $4, deleted_by_user_id = $5,
                version = version + 1, updated_at = $4
          WHERE workspace_id = $1 AND conversation_id = $2 AND id = $3`,
        [workspaceId, conversationId, noteId, now, actorUserId],
      );
      const deleted = await this.getInTransaction(workspaceId, conversationId, noteId, manager);
      await this.audit.record(
        {
          workspaceId,
          actorUserId,
          action: 'internal_note.deleted',
          targetType: 'conversation_internal_note',
          targetId: noteId,
          metadata: { conversationId, version: deleted.version },
        },
        manager,
      );
      await notifyWorkspace(manager, workspaceId, {
        type: 'internal_note.deleted',
        conversationId,
        noteId,
      });
      return toDto(deleted);
    });
  }

  private async assertConversation(
    workspaceId: WorkspaceId,
    conversationId: string,
    manager?: EntityManager,
  ): Promise<void> {
    if (!isUuid(conversationId)) throw new AppError('not_found');
    const rows = await (manager ?? this.ds).query<{ id: string }[]>(
      `SELECT id FROM conversations WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, conversationId],
    );
    if (rows[0] === undefined) throw new AppError('not_found');
  }

  private async actorRole(
    workspaceId: WorkspaceId,
    actorUserId: UserId,
    manager: EntityManager,
  ): Promise<Role> {
    const rows = await manager.query<{ role: Role }[]>(
      `SELECT role FROM memberships WHERE workspace_id = $1 AND user_id = $2 FOR KEY SHARE`,
      [workspaceId, actorUserId],
    );
    const role = rows[0]?.role;
    if (role === undefined) throw new AppError('not_found');
    return role;
  }

  private assertVersion(note: InternalNoteEntity, expectedVersion: number): void {
    if (note.version !== expectedVersion) throw new AppError('stale_note');
  }

  private assertCanManage(note: InternalNoteEntity, actorUserId: UserId, role: Role): void {
    if (role === 'owner' || role === 'admin' || note.authorUserId === actorUserId) return;
    throw new AppError('forbidden');
  }

  private async getInTransaction(
    workspaceId: WorkspaceId,
    conversationId: string,
    noteId: string | undefined,
    manager: EntityManager,
  ): Promise<InternalNoteEntity> {
    return this.notes.findInTransaction(workspaceId, conversationId, noteId, manager);
  }
}

function toDto(note: InternalNoteEntity): InternalNote {
  return {
    id: note.id,
    conversationId: note.conversationId,
    author:
      note.authorUserId === null
        ? null
        : { id: note.authorUserId, name: note.author?.name ?? null },
    body: note.body,
    version: note.version,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
    deletedAt: note.deletedAt?.toISOString() ?? null,
    deletedBy:
      note.deletedByUserId === null
        ? null
        : { id: note.deletedByUserId, name: note.deletedBy?.name ?? null },
  };
}
