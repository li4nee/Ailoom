// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

import { AppError } from '../../common/errors';
import { isUuid, type WorkspaceId } from '../../db/ids';
import { InternalNoteEntity } from './entities/internal-note.entity';

@Injectable()
export class InternalNotesRepository {
  constructor(private readonly ds: DataSource) {}

  async list(workspaceId: WorkspaceId, conversationId: string): Promise<InternalNoteEntity[]> {
    return this.ds.getRepository(InternalNoteEntity).find({
      where: { workspaceId, conversationId },
      relations: { author: true, deletedBy: true },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
  }

  async lock(
    workspaceId: WorkspaceId,
    conversationId: string,
    noteId: string,
    manager: EntityManager,
  ): Promise<InternalNoteEntity> {
    if (!isUuid(conversationId) || !isUuid(noteId)) throw new AppError('not_found');
    const rows = await manager.query<{ id: string }[]>(
      `SELECT id FROM conversation_internal_notes
        WHERE workspace_id = $1 AND conversation_id = $2 AND id = $3 FOR UPDATE`,
      [workspaceId, conversationId, noteId],
    );
    if (rows[0] === undefined) throw new AppError('not_found');
    const note = await manager.getRepository(InternalNoteEntity).findOne({
      where: { workspaceId, conversationId, id: noteId },
      relations: { author: true, deletedBy: true },
    });
    if (note === null) throw new AppError('not_found');
    return note;
  }

  async findInTransaction(
    workspaceId: WorkspaceId,
    conversationId: string,
    noteId: string | undefined,
    manager: EntityManager,
  ): Promise<InternalNoteEntity> {
    if (noteId === undefined) throw new AppError('not_found');
    const note = await manager.getRepository(InternalNoteEntity).findOne({
      where: { workspaceId, conversationId, id: noteId },
      relations: { author: true, deletedBy: true },
    });
    if (note === null) throw new AppError('not_found');
    return note;
  }
}
