// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

import type { InvitationRole, Role } from '@app/shared';

import { AppError } from '../../common/errors';
import { AUDIT_LOG, type AuditWriter } from '../../common/ports/audit';
import type { UserId, WorkspaceId } from '../../db/ids';
import { MembershipsRepository, type MembershipRow } from './memberships.repository';

/**
 * Role changes, removal and ownership transfer (spec §4 permission matrix). The owner can only
 * be changed by transferring ownership: admins get `cannot_modify_owner`, and the owner acting
 * on themselves gets `sole_owner`, because Phase 1 workspaces have exactly one owner.
 */
@Injectable()
export class MembersService {
  constructor(
    private readonly ds: DataSource,
    private readonly memberships: MembershipsRepository,
    @Inject(AUDIT_LOG) private readonly audit: AuditWriter,
  ) {}

  async changeRole(
    workspaceId: WorkspaceId,
    actorId: UserId,
    userId: string,
    role: InvitationRole,
  ): Promise<MembershipRow> {
    await this.ds.transaction(async (manager) => {
      const current = await this.lockTarget(workspaceId, actorId, userId, manager);
      if (current === role) return;
      await this.memberships.updateRole(workspaceId, userId, role, manager);
      await this.audit.record(
        {
          workspaceId,
          actorUserId: actorId,
          action: 'member.role_changed',
          targetType: 'user',
          targetId: userId,
          metadata: { from: current, to: role },
        },
        manager,
      );
    });
    const member = await this.memberships.findMember(workspaceId, userId);
    if (member === null) throw new AppError('not_found');
    return member;
  }

  /** Removes a member; an admin or agent removing themselves is leaving the workspace. */
  async remove(workspaceId: WorkspaceId, actorId: UserId, userId: string): Promise<void> {
    await this.ds.transaction(async (manager) => {
      const current = await this.lockTarget(workspaceId, actorId, userId, manager);
      await this.memberships.delete(workspaceId, userId, manager);
      await this.audit.record(
        {
          workspaceId,
          actorUserId: actorId,
          action: 'member.removed',
          targetType: 'user',
          targetId: userId,
          metadata: { role: current },
        },
        manager,
      );
    });
  }

  /**
   * One transaction: the old owner is demoted before the new one is promoted, because the
   * partial unique index `memberships_one_owner` allows only one owner row at any moment.
   */
  async transferOwnership(
    workspaceId: WorkspaceId,
    ownerId: UserId,
    userId: string,
  ): Promise<void> {
    await this.ds.transaction(async (manager) => {
      const roles = await this.memberships.lockRoles(workspaceId, [ownerId, userId], manager);
      if (roles.get(ownerId) !== 'owner') throw new AppError('forbidden');
      if (!roles.has(userId)) throw new AppError('not_found');
      if (userId === ownerId) return;

      await this.memberships.updateRole(workspaceId, ownerId, 'admin', manager);
      await this.memberships.updateRole(workspaceId, userId, 'owner', manager);
      await this.audit.record(
        {
          workspaceId,
          actorUserId: ownerId,
          action: 'workspace.ownership_transferred',
          targetType: 'user',
          targetId: userId,
          metadata: { fromUserId: ownerId, toUserId: userId },
        },
        manager,
      );
    });
  }

  /** Locks the target row and applies the owner rules; returns the target's current role. */
  private async lockTarget(
    workspaceId: WorkspaceId,
    actorId: UserId,
    userId: string,
    manager: EntityManager,
  ): Promise<Role> {
    const roles = await this.memberships.lockRoles(workspaceId, [userId], manager);
    const current = roles.get(userId);
    if (current === undefined) throw new AppError('not_found');
    if (current === 'owner') {
      throw new AppError(userId === actorId ? 'sole_owner' : 'cannot_modify_owner');
    }
    return current;
  }
}
