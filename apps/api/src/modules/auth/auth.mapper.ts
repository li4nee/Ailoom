// SPDX-License-Identifier: AGPL-3.0-only
import type { MembershipSummary, MeResponse, SessionDto } from '@app/shared';

import type { AuthSessionEntity } from './entities/auth-session.entity';
import type { UserEntity } from './entities/user.entity';

/** The wire shape of `GET /auth/me`; the database columns never leak (e.g. `passwordHash`). */
export function toMeResponse(user: UserEntity, memberships: MembershipSummary[]): MeResponse {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: user.emailVerifiedAt !== null,
    isInstanceAdmin: user.isInstanceAdmin,
    memberships,
  };
}

export function toSessionDto(session: AuthSessionEntity, currentSessionId: string): SessionDto {
  return {
    sessionId: session.id,
    userAgent: session.userAgent,
    ip: session.ip,
    lastUsedAt: session.lastUsedAt?.toISOString() ?? null,
    createdAt: session.createdAt.toISOString(),
    current: session.id === currentSessionId,
  };
}
