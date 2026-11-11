// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager, type Repository } from 'typeorm';

import { AppError } from '../../common/errors';
import { isUuid } from '../../db/ids';
import { isUniqueViolation } from '../../db/postgres-errors';
import { UserEntity } from './entities/user.entity';

export interface NewUser {
  email: string;
  passwordHash: string;
  name: string | null;
  isInstanceAdmin: boolean;
  emailVerifiedAt: Date | null;
}

export interface UserPatch {
  name?: string | null;
  passwordHash?: string;
  emailVerifiedAt?: Date | null;
  isInstanceAdmin?: boolean;
  tokenVersion?: number;
}

/**
 * Users are not owned by a workspace, so this is a plain repository: the tenant rule does not
 * apply. Every caller that reads a user for a tenant-relevant decision still scopes the
 * workspace first (Membership/access), not this repository.
 */
@Injectable()
export class UsersRepository {
  constructor(private readonly ds: DataSource) {}

  async findById(id: string): Promise<UserEntity | null> {
    if (!isUuid(id)) return null;
    return this.repository().findOne({ where: { id } });
  }

  /** `email` is a citext column, so this is case-insensitive; callers still trim input. */
  async findByEmail(email: string): Promise<UserEntity | null> {
    return this.repository().findOne({ where: { email: email.trim() } });
  }

  async insert(data: NewUser, manager?: EntityManager): Promise<UserEntity> {
    let id: string;
    try {
      const result = await this.repository(manager).insert(data);
      const generated: unknown = (result.identifiers[0] as Record<string, unknown> | undefined)?.[
        'id'
      ];
      if (typeof generated !== 'string') {
        throw new Error('The insert did not return the id of the new user.');
      }
      id = generated;
    } catch (error) {
      // A concurrent signup can slip past the earlier existence check; the unique index is
      // the final arbiter and reports the same code as a sequential duplicate.
      if (isUniqueViolation(error)) throw new AppError('email_taken', { cause: error });
      throw error;
    }
    const user = await this.repository(manager).findOne({ where: { id } });
    if (user === null) throw new AppError('internal_error', { message: 'The user vanished.' });
    return user;
  }

  async update(id: string, patch: UserPatch, manager?: EntityManager): Promise<UserEntity> {
    if (!isUuid(id)) throw new AppError('not_found');
    const result = await this.repository(manager).update({ id }, patch);
    if ((result.affected ?? 0) === 0) throw new AppError('not_found');
    const user = await this.repository(manager).findOne({ where: { id } });
    if (user === null) throw new AppError('not_found');
    return user;
  }

  async count(manager?: EntityManager): Promise<number> {
    return this.repository(manager).count();
  }

  /** Raw SQL: an atomic increment cannot be expressed as a read followed by an update. */
  async incrementTokenVersion(id: string, manager?: EntityManager): Promise<void> {
    if (!isUuid(id)) throw new AppError('not_found');
    await this.repository(manager).query(
      'UPDATE users SET token_version = token_version + 1 WHERE id = $1',
      [id],
    );
  }

  /**
   * Raw SQL: TypeORM has no advisory-lock API. A transaction-scoped advisory lock serializes
   * only the callers racing to be the first user; unlike a table lock it never blocks logins,
   * verifications or token_version bumps. Callers must re-count after taking it.
   */
  async lockForFirstUser(manager: EntityManager): Promise<void> {
    await manager.query("SELECT pg_advisory_xact_lock(hashtext('users.first_signup'))");
  }

  /**
   * Raw SQL: the owner rule spans memberships and workspaces, which belong to the workspaces
   * module (auth cannot import it without a cycle). `FOR UPDATE OF m` locks the owner rows, so
   * an ownership transfer running at the same time waits for this decision.
   */
  async ownsLiveWorkspace(userId: string, manager: EntityManager): Promise<boolean> {
    const rows = await manager.query<unknown[]>(
      `SELECT 1 FROM memberships m
         JOIN workspaces w ON w.id = m.workspace_id AND w.deleted_at IS NULL
        WHERE m.user_id = $1 AND m.role = 'owner'
        FOR UPDATE OF m`,
      [userId],
    );
    return rows.length > 0;
  }

  /** Memberships and sessions go with it (ON DELETE CASCADE); messages keep a null author. */
  async delete(id: string, manager: EntityManager): Promise<void> {
    if (!isUuid(id)) throw new AppError('not_found');
    await manager.getRepository(UserEntity).delete({ id });
  }

  private repository(manager?: EntityManager): Repository<UserEntity> {
    return manager === undefined
      ? this.ds.getRepository(UserEntity)
      : manager.getRepository(UserEntity);
  }
}
