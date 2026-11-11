// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type {
  LoginRequest,
  MeResponse,
  MembershipSummary,
  Role,
  SessionDto,
  SignupRequest,
  UpdateMeRequest,
} from '@app/shared';

import { AppError } from '../../common/errors';
import { asUserId } from '../../db/ids';
import { toMeResponse, toSessionDto } from './auth.mapper';
import type { SessionTokens } from './cookies';
import { checkPassword } from './domain/password-policy';
import { PasswordHasher } from './password-hasher';
import type { Principal } from './principal';
import type { SessionMeta } from './sessions.service';
import { SessionsService } from './sessions.service';
import { SignupService } from './signup.service';
import { TokenService } from './token.service';
import { UsersRepository } from './users.repository';

const MEMBERSHIPS_SQL = `
  SELECT m.workspace_id, w.name AS workspace_name, m.role
    FROM memberships m
    JOIN workspaces w ON w.id = m.workspace_id AND w.deleted_at IS NULL
   WHERE m.user_id = $1
   ORDER BY w.name, m.workspace_id
`;

interface MembershipRow {
  workspace_id: string;
  workspace_name: string;
  role: Role;
}

export interface LoginResult extends SessionTokens {
  me: MeResponse;
}

export interface UpdateMeResult {
  me: MeResponse;
  /** Null unless the password changed; only then are fresh session cookies set. */
  tokens: SessionTokens | null;
}

/**
 * The auth use cases (spec §10.1). Login answers unknown emails with the same code and a dummy
 * hash verification, so response contents and timing do not reveal registered addresses.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly hasher: PasswordHasher,
    private readonly users: UsersRepository,
    private readonly sessions: SessionsService,
    private readonly tokens: TokenService,
    private readonly signupService: SignupService,
  ) {}

  async signup(input: SignupRequest, meta: SessionMeta): Promise<{ id: string }> {
    const user = await this.signupService.signup(input, meta);
    return { id: user.id };
  }

  async login(input: LoginRequest, meta: SessionMeta): Promise<LoginResult> {
    const user = await this.users.findByEmail(input.email);
    if (user === null) {
      await this.hasher.verifyDummy(input.password);
      throw new AppError('invalid_credentials');
    }
    if (!(await this.hasher.verify(user.passwordHash, input.password))) {
      throw new AppError('invalid_credentials');
    }
    if (this.hasher.needsRehash(user.passwordHash)) {
      await this.users.update(user.id, { passwordHash: await this.hasher.hash(input.password) });
    }

    const { session, refreshToken } = await this.sessions.create(asUserId(user.id), meta);
    const accessToken = await this.tokens.issueAccess({
      userId: asUserId(user.id),
      sessionId: session.id,
      tokenVersion: user.tokenVersion,
    });
    return {
      accessToken,
      refreshToken,
      me: toMeResponse(user, await this.memberships(user.id)),
    };
  }

  async refresh(refreshToken: string | undefined, meta: SessionMeta): Promise<SessionTokens> {
    if (refreshToken === undefined) throw new AppError('unauthorized');
    const rotated = await this.sessions.rotate(refreshToken, meta);
    const accessToken = await this.tokens.issueAccess({
      userId: asUserId(rotated.user.id),
      sessionId: rotated.session.id,
      tokenVersion: rotated.user.tokenVersion,
    });
    return { accessToken, refreshToken: rotated.refreshToken };
  }

  /**
   * Idempotent: unknown or already-revoked tokens still clear the cookies. The refresh cookie is
   * scoped to /auth/refresh, so a browser normally sends only the access cookie here; its `sid`
   * names the session. An expired access token is accepted so an idle tab can still log out.
   */
  async logout(tokens: {
    refreshToken: string | undefined;
    accessToken: string | undefined;
  }): Promise<void> {
    if (tokens.refreshToken !== undefined) {
      await this.sessions.revokeByRefreshToken(tokens.refreshToken);
      return;
    }
    if (tokens.accessToken === undefined) return;
    let claims;
    try {
      claims = await this.tokens.verifyAccess(tokens.accessToken, { allowExpired: true });
    } catch {
      return;
    }
    await this.sessions.revoke(claims.sub, claims.sid);
  }

  async logoutAll(principal: Principal): Promise<void> {
    await this.sessions.revokeAllForUser(principal.userId, 'logout_all');
  }

  async me(principal: Principal): Promise<MeResponse> {
    const user = await this.users.findById(principal.userId);
    if (user === null) throw new AppError('unauthorized');
    return toMeResponse(user, await this.memberships(user.id));
  }

  async updateMe(
    principal: Principal,
    input: UpdateMeRequest,
    meta: SessionMeta,
  ): Promise<UpdateMeResult> {
    const user = await this.users.findById(principal.userId);
    if (user === null) throw new AppError('unauthorized');

    if (input.newPassword === undefined) {
      const updated =
        input.name === undefined ? user : await this.users.update(user.id, { name: input.name });
      return { me: toMeResponse(updated, await this.memberships(updated.id)), tokens: null };
    }

    if (input.currentPassword === undefined) {
      throw new AppError('validation_failed', {
        details: [{ path: 'currentPassword', message: 'Current password is required.' }],
      });
    }
    if (!(await this.hasher.verify(user.passwordHash, input.currentPassword))) {
      throw new AppError('invalid_credentials', {
        message: 'The current password is incorrect.',
      });
    }
    const problems = checkPassword(input.newPassword, { email: user.email });
    if (problems.length > 0) {
      throw new AppError('password_policy', {
        details: problems.map((problem) => ({ path: 'newPassword', message: problem })),
      });
    }

    const passwordHash = await this.hasher.hash(input.newPassword);
    await this.dataSource.transaction(async (manager) => {
      await this.users.update(
        user.id,
        { passwordHash, ...(input.name === undefined ? {} : { name: input.name }) },
        manager,
      );
      await this.sessions.revokeAllForUser(asUserId(user.id), 'password_change', manager);
    });

    // The transaction bumped token_version; the response must carry a token with the new value.
    const updated = await this.users.findById(user.id);
    if (updated === null) throw new AppError('unauthorized');
    const { session, refreshToken } = await this.sessions.create(asUserId(updated.id), meta);
    const accessToken = await this.tokens.issueAccess({
      userId: asUserId(updated.id),
      sessionId: session.id,
      tokenVersion: updated.tokenVersion,
    });
    return {
      me: toMeResponse(updated, await this.memberships(updated.id)),
      tokens: { accessToken, refreshToken },
    };
  }

  async listSessions(principal: Principal): Promise<SessionDto[]> {
    const rows = await this.sessions.listForUser(principal.userId);
    return rows.map((row) => toSessionDto(row, principal.sessionId));
  }

  async revokeSession(principal: Principal, sessionId: string): Promise<void> {
    await this.sessions.revokeOne(principal.userId, sessionId);
  }

  private async memberships(userId: string): Promise<MembershipSummary[]> {
    const rows = await this.dataSource.query<MembershipRow[]>(MEMBERSHIPS_SQL, [userId]);
    return rows.map((row) => ({
      workspaceId: row.workspace_id,
      workspaceName: row.workspace_name,
      role: row.role,
    }));
  }
}
