// SPDX-License-Identifier: AGPL-3.0-only
export { AccessGuard } from './access.guard';
export { AccessRepository, type AccessInfo } from './access.repository';
export {
  CurrentPrincipal,
  InstanceAdminOnly,
  Public,
  RequireRole,
  RequireVerifiedEmail,
} from './decorators';
export type { Principal } from './principal';
export {
  AuthSessionEntity,
  REVOKED_REASONS,
  type RevokedReason,
} from './entities/auth-session.entity';
export { EmailTokenEntity } from './entities/email-token.entity';
export { UserEntity } from './entities/user.entity';
export {
  INVITATION_ACCEPTANCE,
  SIGNUP_SETTINGS,
  type InvitationAcceptance,
  type PendingInvitation,
  type SignupSettings,
} from './ports';
export { SessionsRepository, type NewSession } from './sessions.repository';
export { SessionsService, type SessionMeta } from './sessions.service';
export { TokenService, type AccessClaims } from './token.service';
