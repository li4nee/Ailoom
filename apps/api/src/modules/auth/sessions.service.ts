// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

import { Clock } from '../../common/clock';
import { APP_CONFIG, type AppConfig } from '../../common/config';
import { randomToken, sha256Hex } from '../../common/crypto';
import { AppError } from '../../common/errors';
import type { UserId } from '../../db/ids';
import { EmailService } from '../email';
import { AuthSessionEntity } from './entities/auth-session.entity';
import { UserEntity } from './entities/user.entity';
import { SessionsRepository } from './sessions.repository';
import { UsersRepository } from './users.repository';

export interface SessionMeta {
  userAgent: string;
  ip: string;
}

const DAY_MS = 86_400_000;
const RACE_WINDOW_MS = 10_000;

const REUSE_REASON =
  'A refresh token was presented again after it had been replaced, which usually means it was copied. All sessions have been signed out.';

type RotateOutcome =
  | { kind: 'rotated'; session: AuthSessionEntity; refreshToken: string; user: UserEntity }
  | { kind: 'reuse'; user: UserEntity | null };

/**
 * Login sessions (spec §10.1). The refresh token is an opaque random value; only its hash is
 * stored. Every rotation revokes the presented row and issues a new one in the same family,
 * so presenting a rotated token again is evidence of a copy and signs the whole family out.
 */
@Injectable()
export class SessionsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly sessions: SessionsRepository,
    private readonly users: UsersRepository,
    private readonly email: EmailService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly clock: Clock,
  ) {}

  async create(
    userId: UserId,
    meta: SessionMeta,
  ): Promise<{ session: AuthSessionEntity; refreshToken: string }> {
    const now = this.clock.now();
    const refreshToken = randomToken();
    const session = await this.sessions.insert({
      userId,
      refreshTokenHash: sha256Hex(refreshToken),
      familyId: randomUUID(),
      userAgent: meta.userAgent,
      ip: meta.ip,
      lastUsedAt: now,
      expiresAt: new Date(now.getTime() + this.config.auth.refreshTokenTtlDays * DAY_MS),
    });
    return { session, refreshToken };
  }

  async rotate(
    refreshToken: string,
    meta: SessionMeta,
  ): Promise<{ session: AuthSessionEntity; refreshToken: string; user: UserEntity }> {
    const refreshTokenHash = sha256Hex(refreshToken);

    const outcome = await this.dataSource.transaction(async (manager): Promise<RotateOutcome> => {
      const current = await this.sessions.lockByHash(refreshTokenHash, manager);
      // An unknown token is indistinguishable from one revoked long ago; both answer the same.
      if (current === null) throw new AppError('session_revoked');

      const now = this.clock.now();
      if (current.revokedAt !== null) {
        const withinRaceWindow =
          current.revokedReason === 'rotated' &&
          now.getTime() - current.revokedAt.getTime() < RACE_WINDOW_MS;
        if (withinRaceWindow) throw new AppError('refresh_race');

        await this.sessions.revokeFamily(current.familyId, 'reuse_detected', now, manager);
        return { kind: 'reuse', user: await this.users.findById(current.userId) };
      }

      if (current.expiresAt.getTime() <= now.getTime()) throw new AppError('session_expired');

      await this.sessions.revokeById(current.id, 'rotated', now, manager);
      const nextToken = randomToken();
      const session = await this.sessions.insert(
        {
          userId: current.userId,
          refreshTokenHash: sha256Hex(nextToken),
          familyId: current.familyId,
          userAgent: meta.userAgent,
          ip: meta.ip,
          lastUsedAt: now,
          expiresAt: new Date(now.getTime() + this.config.auth.refreshTokenTtlDays * DAY_MS),
        },
        manager,
      );
      const user = await this.users.findById(current.userId);
      if (user === null) throw new AppError('session_revoked');
      return { kind: 'rotated', session, refreshToken: nextToken, user };
    });

    if (outcome.kind === 'reuse') {
      // The revocation is committed before the alert is queued: a mail failure must not undo
      // the sign-out, and the caller still gets the same error.
      if (outcome.user !== null) {
        await this.email.send('security_alert', outcome.user.email, {
          name: outcome.user.name,
          reason: REUSE_REASON,
        });
      }
      throw new AppError('session_revoked');
    }
    return { session: outcome.session, refreshToken: outcome.refreshToken, user: outcome.user };
  }

  /** Revokes the current device's session; logout stays idempotent. */
  async revoke(sessionId: string): Promise<void> {
    await this.sessions.revokeById(sessionId, 'logout', this.clock.now());
  }

  /** Signs the user out everywhere: every session and every outstanding access token. */
  async revokeAllForUser(userId: UserId, manager?: EntityManager): Promise<void> {
    const revoke = async (m: EntityManager): Promise<void> => {
      await this.sessions.revokeAllActiveForUser(userId, 'logout_all', this.clock.now(), m);
      await this.users.incrementTokenVersion(userId, m);
    };
    if (manager === undefined) await this.dataSource.transaction(revoke);
    else await revoke(manager);
  }

  async listForUser(userId: UserId): Promise<AuthSessionEntity[]> {
    return this.sessions.findActiveForUser(userId);
  }

  async revokeOne(userId: UserId, sessionId: string): Promise<void> {
    const session = await this.sessions.findForUser(userId, sessionId);
    if (session === null) throw new AppError('not_found');
    if (session.revokedAt === null) {
      await this.sessions.revokeById(session.id, 'logout', this.clock.now());
    }
  }
}
