// SPDX-License-Identifier: AGPL-3.0-only
import type { EntityManager } from 'typeorm';

import type { InvitationRole, SignupMode } from '@app/shared';

import type { WorkspaceId } from '../../db/ids';

/**
 * Signup needs two decisions that other modules own: the instance's signup mode (`instance`)
 * and invitation acceptance (`workspaces`). They are injected as narrow ports instead of
 * imported, because both of those modules already import auth's user entity; importing back
 * would form an index-level cycle, which the dependency rules reject.
 */
export interface SignupSettings {
  getSignupMode(): Promise<SignupMode>;
}

export const SIGNUP_SETTINGS = Symbol('SIGNUP_SETTINGS');

/** An invitation already locked and validated for the signing-up email address. */
export interface PendingInvitation {
  invitationId: string;
  workspaceId: WorkspaceId;
  role: InvitationRole;
}

export interface InvitationAcceptance {
  /**
   * Locks the invitation for the rest of the caller's transaction (so one token cannot be
   * accepted twice) and returns it when it is pending, unexpired and addressed to `email`.
   * Signup maps every failure to `invitation_required`: it must not reveal why.
   */
  findValidForSignup(
    token: string,
    email: string,
    manager: EntityManager,
  ): Promise<PendingInvitation>;
  /** Marks the invitation accepted and grants the membership in the same transaction. */
  acceptForSignup(
    invitation: PendingInvitation,
    userId: string,
    manager: EntityManager,
  ): Promise<void>;
}

export const INVITATION_ACCEPTANCE = Symbol('INVITATION_ACCEPTANCE');
