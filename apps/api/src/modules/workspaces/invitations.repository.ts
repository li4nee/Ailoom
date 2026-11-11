// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource, IsNull, type EntityManager, type Repository } from 'typeorm';

import type { InvitationRole } from '@app/shared';

import { AppError } from '../../common/errors';
import { isUuid, type WorkspaceId } from '../../db/ids';
import { InvitationEntity } from './entities/invitation.entity';

export interface NewInvitation {
  email: string;
  role: InvitationRole;
  tokenHash: string;
  invitedBy: string;
  expiresAt: Date;
}

/** The parts of a user an invitation needs: who sent it, and whose address must match. */
export interface UserContact {
  email: string;
  name: string | null;
}

/**
 * Admin-facing invitation queries (Task 1.11) and the signup path share this repository.
 */
@Injectable()
export class InvitationsRepository {
  constructor(private readonly ds: DataSource) {}

  /**
   * Raw SQL: TypeORM's upsert cannot target a partial unique index. Re-inviting the same
   * address (citext, so case-insensitively) replaces the pending row's token, role and expiry,
   * which invalidates the earlier link.
   */
  async upsertPending(
    workspaceId: WorkspaceId,
    row: NewInvitation,
    manager: EntityManager,
  ): Promise<InvitationEntity> {
    const rows = await manager.query<{ id: string }[]>(
      `INSERT INTO invitations (workspace_id, email, role, token_hash, invited_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (workspace_id, email) WHERE accepted_at IS NULL
       DO UPDATE SET role = EXCLUDED.role, token_hash = EXCLUDED.token_hash,
                     invited_by = EXCLUDED.invited_by, expires_at = EXCLUDED.expires_at
       RETURNING id`,
      [workspaceId, row.email, row.role, row.tokenHash, row.invitedBy, row.expiresAt],
    );
    const id = rows[0]?.id;
    if (id === undefined) {
      throw new AppError('internal_error', { message: 'The invitation upsert returned no row.' });
    }
    const saved = await this.repository(manager).findOne({ where: { id, workspaceId } });
    if (saved === null)
      throw new AppError('internal_error', { message: 'The invitation vanished.' });
    return saved;
  }

  /** Pending invitations, expired ones included so an admin can see and re-send them. */
  async listPending(workspaceId: WorkspaceId): Promise<InvitationEntity[]> {
    return this.repository().find({
      where: { workspaceId, acceptedAt: IsNull() },
      order: { email: 'ASC', id: 'ASC' },
    });
  }

  /** Revokes a pending invitation; an accepted or unknown id is `not_found`. */
  async deletePending(
    workspaceId: WorkspaceId,
    id: string,
    manager: EntityManager,
  ): Promise<InvitationEntity> {
    if (!isUuid(id)) throw new AppError('not_found');
    const repository = this.repository(manager);
    const row = await repository.findOne({ where: { id, workspaceId, acceptedAt: IsNull() } });
    if (row === null) throw new AppError('not_found');
    await repository.delete({ id, workspaceId });
    return row;
  }

  /**
   * Raw SQL against `users`: workspaces must not depend on the auth module's providers (it
   * would close a module cycle, see the Task 1.3 ruling), and this is a single-row read.
   */
  async findUserContact(userId: string, manager?: EntityManager): Promise<UserContact | null> {
    if (!isUuid(userId)) return null;
    const rows = await (manager ?? this.ds.manager).query<UserContact[]>(
      'SELECT email, name FROM users WHERE id = $1',
      [userId],
    );
    return rows[0] ?? null;
  }
  /**
   * A token is globally unique and unguessable, so it identifies its invitation without a
   * workspace parameter; the returned row carries the workspace every later step is scoped by.
   * `FOR UPDATE` holds the row for the rest of the signup transaction, so two concurrent
   * signups cannot both accept one invitation.
   */
  async findPendingByTokenHashForUpdate(
    tokenHash: string,
    manager: EntityManager,
  ): Promise<InvitationEntity | null> {
    return manager
      .getRepository(InvitationEntity)
      .createQueryBuilder('invitation')
      .setLock('pessimistic_write')
      .where('invitation.tokenHash = :tokenHash', { tokenHash })
      .getOne();
  }

  /** A read-only lookup for the preview page; the accept path locks the row instead. */
  async findByTokenHash(tokenHash: string): Promise<InvitationEntity | null> {
    return this.repository().findOne({ where: { tokenHash } });
  }

  /** Only a still-pending row is accepted; a second attempt is `invitation_required`. */
  async markAccepted(
    workspaceId: WorkspaceId,
    id: string,
    acceptedAt: Date,
    manager: EntityManager,
  ): Promise<void> {
    const result = await manager
      .getRepository(InvitationEntity)
      .update({ id, workspaceId, acceptedAt: IsNull() }, { acceptedAt });
    if ((result.affected ?? 0) === 0) throw new AppError('invitation_required');
  }

  private repository(manager?: EntityManager): Repository<InvitationEntity> {
    return (manager ?? this.ds.manager).getRepository(InvitationEntity);
  }
}
