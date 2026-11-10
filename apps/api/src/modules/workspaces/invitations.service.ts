// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import { Clock } from '../../common/clock';
import { sha256Hex } from '../../common/crypto';
import { AppError } from '../../common/errors';
import type { InvitationAcceptance, PendingInvitation } from '../auth';
import { InvitationsRepository } from './invitations.repository';
import { MembershipsRepository } from './memberships.repository';

/**
 * Invitation use cases. Task 1.11 adds the admin routes; the signup half lives here so the
 * auth module never touches workspace tables.
 */
@Injectable()
export class InvitationsService implements InvitationAcceptance {
  constructor(
    private readonly invitations: InvitationsRepository,
    private readonly memberships: MembershipsRepository,
    private readonly clock: Clock,
  ) {}

  async findValidForSignup(
    token: string,
    email: string,
    manager: EntityManager,
  ): Promise<PendingInvitation> {
    const row = await this.invitations.findPendingByTokenHashForUpdate(sha256Hex(token), manager);
    if (row === null) throw new AppError('invitation_required');
    const now = this.clock.now();
    if (
      row.acceptedAt !== null ||
      row.expiresAt.getTime() <= now.getTime() ||
      row.email.trim().toLowerCase() !== email.trim().toLowerCase()
    ) {
      throw new AppError('invitation_required');
    }
    return { invitationId: row.id, workspaceId: row.workspaceId, role: row.role };
  }

  async acceptForSignup(
    invitation: PendingInvitation,
    userId: string,
    manager: EntityManager,
  ): Promise<void> {
    await this.invitations.markAccepted(
      invitation.workspaceId,
      invitation.invitationId,
      this.clock.now(),
      manager,
    );
    await this.memberships.insert(invitation.workspaceId, userId, invitation.role, manager);
  }
}
