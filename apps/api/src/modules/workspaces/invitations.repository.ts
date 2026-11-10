// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { IsNull, type EntityManager } from 'typeorm';

import { AppError } from '../../common/errors';
import type { WorkspaceId } from '../../db/ids';
import { InvitationEntity } from './entities/invitation.entity';

/**
 * Admin-facing invitation queries (Task 1.11) and the signup path share this repository.
 */
@Injectable()
export class InvitationsRepository {
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
}
