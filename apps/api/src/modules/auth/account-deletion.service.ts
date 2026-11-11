// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AppError } from '../../common/errors';
import { PasswordHasher } from './password-hasher';
import type { Principal } from './principal';
import { UsersRepository } from './users.repository';

/**
 * Account deletion (spec §10.1). Blocked while the user owns a live workspace: ownership must
 * be transferred or the workspace deleted first, so no workspace is ever left ownerless.
 * Deleting the user row cascades to memberships and sessions, which ends every login at once.
 */
@Injectable()
export class AccountDeletionService {
  constructor(
    private readonly ds: DataSource,
    private readonly users: UsersRepository,
    private readonly hasher: PasswordHasher,
  ) {}

  async deleteAccount(principal: Principal, password: string): Promise<void> {
    const user = await this.users.findById(principal.userId);
    if (user === null) throw new AppError('unauthorized');
    if (!(await this.hasher.verify(user.passwordHash, password))) {
      throw new AppError('invalid_credentials', { message: 'The password is incorrect.' });
    }
    await this.ds.transaction(async (manager) => {
      if (await this.users.ownsLiveWorkspace(user.id, manager)) {
        throw new AppError('sole_owner');
      }
      await this.users.delete(user.id, manager);
    });
  }
}
