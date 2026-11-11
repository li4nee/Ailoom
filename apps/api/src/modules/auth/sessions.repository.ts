// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource, IsNull, type EntityManager, type Repository } from 'typeorm';

import { AppError } from '../../common/errors';
import { isUuid } from '../../db/ids';
import { AuthSessionEntity, type RevokedReason } from './entities/auth-session.entity';

/** A session row to insert. The raw refresh token never reaches this layer. */
export interface NewSession {
  userId: string;
  refreshTokenHash: string;
  familyId: string;
  userAgent: string | null;
  ip: string | null;
  lastUsedAt: Date | null;
  expiresAt: Date;
}

/**
 * Sessions are not tenant rows: a user can be a member of many workspaces, and a login is
 * not scoped to one. Every method keys on the user instead, and callers that act on a
 * single device pass the user id as well, so one user cannot revoke another's session.
 */
@Injectable()
export class SessionsRepository {
  constructor(private readonly ds: DataSource) {}

  async insert(row: NewSession, manager?: EntityManager): Promise<AuthSessionEntity> {
    const repository = this.repository(manager);
    const result = await repository.insert(row);
    const generated: unknown = (result.identifiers[0] as Record<string, unknown> | undefined)?.[
      'id'
    ];
    if (typeof generated !== 'string') {
      throw new AppError('internal_error', {
        message: 'The insert did not return the id of the new session.',
      });
    }
    const session = await repository.findOne({ where: { id: generated } });
    if (session === null) {
      throw new AppError('internal_error', { message: 'The new session vanished.' });
    }
    return session;
  }

  /**
   * Locks the row for the rest of the transaction so two concurrent rotations of the same
   * token cannot both create a child. The query builder (not raw SQL) keeps the predicate
   * parameterized and the result mapped to the entity.
   */
  async lockByHash(
    refreshTokenHash: string,
    manager: EntityManager,
  ): Promise<AuthSessionEntity | null> {
    const rows = await manager
      .getRepository(AuthSessionEntity)
      .createQueryBuilder('session')
      .setLock('pessimistic_write')
      .where('session.refreshTokenHash = :refreshTokenHash', { refreshTokenHash })
      .getMany();
    return rows[0] ?? null;
  }

  async revokeById(
    id: string,
    reason: RevokedReason,
    revokedAt: Date,
    manager?: EntityManager,
  ): Promise<void> {
    if (!isUuid(id)) return;
    await this.repository(manager).update(
      { id, revokedAt: IsNull() },
      { revokedAt, revokedReason: reason },
    );
  }

  async revokeAllActiveForUser(
    userId: string,
    reason: RevokedReason,
    revokedAt: Date,
    manager?: EntityManager,
  ): Promise<void> {
    await this.repository(manager).update(
      { userId, revokedAt: IsNull() },
      { revokedAt, revokedReason: reason },
    );
  }

  async findActiveForUser(userId: string): Promise<AuthSessionEntity[]> {
    return this.repository().find({
      where: { userId, revokedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
  }

  async findForUser(userId: string, id: string): Promise<AuthSessionEntity | null> {
    if (!isUuid(id)) return null;
    return this.repository().findOne({ where: { id, userId } });
  }

  private repository(manager?: EntityManager): Repository<AuthSessionEntity> {
    return manager === undefined
      ? this.ds.getRepository(AuthSessionEntity)
      : manager.getRepository(AuthSessionEntity);
  }
}
