// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

import type {
  AcceptInvitationResponse,
  CreateInvitationRequest,
  InvitationPreview,
} from '@app/shared';

import { Clock } from '../../common/clock';
import { APP_CONFIG, type AppConfig } from '../../common/config';
import { randomToken, sha256Hex } from '../../common/crypto';
import { AppError } from '../../common/errors';
import { AUDIT_LOG, type AuditWriter } from '../../common/ports/audit';
import { asWorkspaceId, type UserId, type WorkspaceId } from '../../db/ids';
import type { InvitationAcceptance, PendingInvitation } from '../auth';
import { EmailService, siteLink } from '../email';
import type { InvitationEntity } from './entities/invitation.entity';
import { InvitationsRepository } from './invitations.repository';
import { MembershipsRepository } from './memberships.repository';
import { WorkspacesRepository } from './workspaces.repository';

const INVITATION_TTL_MS = 7 * 86_400_000;

export interface CreatedInvitation {
  invitation: InvitationEntity;
  /** Only without an email transport (see `createdInvitationSchema`); null otherwise. */
  acceptUrl: string | null;
}

function sameEmail(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Invitation use cases. Task 1.11 adds the admin routes; the signup half lives here so the
 * auth module never touches workspace tables.
 */
@Injectable()
export class InvitationsService implements InvitationAcceptance {
  constructor(
    private readonly ds: DataSource,
    private readonly invitations: InvitationsRepository,
    private readonly memberships: MembershipsRepository,
    private readonly workspaces: WorkspacesRepository,
    private readonly email: EmailService,
    @Inject(AUDIT_LOG) private readonly audit: AuditWriter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly clock: Clock,
  ) {}

  /**
   * Creates or replaces the pending invitation for this address. The email is queued in the
   * same transaction, so a rolled-back invitation never sends a link. Without an email
   * transport the admin shares `acceptUrl` by hand.
   */
  async create(
    workspaceId: WorkspaceId,
    actorId: UserId,
    input: CreateInvitationRequest,
  ): Promise<CreatedInvitation> {
    const workspace = await this.workspaces.findById(workspaceId);
    if (workspace === null) throw new AppError('not_found');
    const token = randomToken();

    const invitation = await this.ds.transaction(async (manager) => {
      const inviter = await this.invitations.findUserContact(actorId, manager);
      if (inviter === null) throw new AppError('unauthorized');
      const row = await this.invitations.upsertPending(
        workspaceId,
        {
          email: input.email,
          role: input.role,
          tokenHash: sha256Hex(token),
          invitedBy: actorId,
          expiresAt: new Date(this.clock.now().getTime() + INVITATION_TTL_MS),
        },
        manager,
      );
      if (this.email.isEnabled()) {
        await this.email.send(
          'invitation',
          input.email,
          {
            inviterName: inviter.name ?? inviter.email,
            workspaceName: workspace.name,
            token,
            role: input.role,
          },
          { manager },
        );
      }
      await this.audit.record(
        {
          workspaceId,
          actorUserId: actorId,
          action: 'member.invited',
          targetType: 'invitation',
          targetId: row.id,
          metadata: { email: input.email, role: input.role },
        },
        manager,
      );
      return row;
    });

    return {
      invitation,
      acceptUrl: this.email.isEnabled()
        ? null
        : siteLink(this.config.publicUrl, '/invitations/accept', { token }),
    };
  }

  async list(workspaceId: WorkspaceId): Promise<InvitationEntity[]> {
    return this.invitations.listPending(workspaceId);
  }

  async revoke(workspaceId: WorkspaceId, actorId: UserId, invitationId: string): Promise<void> {
    await this.ds.transaction(async (manager) => {
      const row = await this.invitations.deletePending(workspaceId, invitationId, manager);
      await this.audit.record(
        {
          workspaceId,
          actorUserId: actorId,
          action: 'member.invitation_revoked',
          targetType: 'invitation',
          targetId: row.id,
          metadata: { email: row.email, role: row.role },
        },
        manager,
      );
    });
  }

  /**
   * What the invite page shows before sign-in. The token is the credential, so revealing the
   * workspace name and invited address to its holder discloses nothing new.
   */
  async preview(token: string): Promise<InvitationPreview> {
    const row = await this.invitations.findByTokenHash(sha256Hex(token));
    if (row?.acceptedAt !== null) throw new AppError('invalid_token');
    this.assertNotExpired(row);
    const workspace = await this.workspaces.findById(row.workspaceId);
    if (workspace === null) throw new AppError('invalid_token');
    return { workspaceName: workspace.name, role: row.role, email: row.email };
  }

  /**
   * A signed-in user accepts with the token from the email. The account's address must match
   * the invited one (case-insensitively): the token alone could have been forwarded.
   * Expiry answers 410, not 401, so the admin client does not mistake it for an expired
   * access token and try to refresh the session.
   */
  async accept(userId: UserId, token: string): Promise<AcceptInvitationResponse> {
    return this.ds.transaction(async (manager) => {
      const row = await this.invitations.findPendingByTokenHashForUpdate(sha256Hex(token), manager);
      if (row?.acceptedAt !== null) throw new AppError('invalid_token');
      this.assertNotExpired(row);
      const user = await this.invitations.findUserContact(userId, manager);
      if (user === null) throw new AppError('unauthorized');
      if (!sameEmail(user.email, row.email)) {
        throw new AppError('invalid_token', {
          status: 403,
          message: 'This invitation was sent to a different email address.',
        });
      }

      const workspaceId = asWorkspaceId(row.workspaceId);
      await this.invitations.markAccepted(workspaceId, row.id, this.clock.now(), manager);
      await this.memberships.insert(workspaceId, userId, row.role, manager);
      await this.audit.record(
        {
          workspaceId,
          actorUserId: userId,
          action: 'member.joined',
          targetType: 'user',
          targetId: userId,
          metadata: { role: row.role, invitationId: row.id },
        },
        manager,
      );
      return { workspaceId: row.workspaceId, role: row.role };
    });
  }

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
      !sameEmail(row.email, email)
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

  /** 410, not 401: the admin client must not mistake it for an expired access token. */
  private assertNotExpired(row: InvitationEntity): void {
    if (row.expiresAt.getTime() <= this.clock.now().getTime()) {
      throw new AppError('token_expired', {
        status: 410,
        message: 'This invitation has expired. Ask for a new one.',
      });
    }
  }
}
