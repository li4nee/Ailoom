// SPDX-License-Identifier: AGPL-3.0-only
import type { DataSource } from 'typeorm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getTestDataSource, resetDatabase } from '../../../test/helpers/db';
import { addMember, createUser, createWorkspace } from '../../../test/helpers/factories';
import { UsersRepository } from './users.repository';

let ds: DataSource;
let users: UsersRepository;

beforeAll(async () => {
  ds = await getTestDataSource();
  users = new UsersRepository(ds);
});

beforeEach(async () => {
  await resetDatabase(ds);
});

describe('UsersRepository.ownsLiveWorkspace', () => {
  it('sees an ownership transfer to the user that commits while it waits', async () => {
    const { user: owner } = await createUser({ ds }, { email: 'owner@example.com' });
    const { user: heir } = await createUser({ ds }, { email: 'heir@example.com' });
    const ws = await createWorkspace({ ds }, owner);
    await addMember({ ds }, ws, heir, 'admin');

    // A transfer to `heir` is in flight: demote, promote, not yet committed.
    const transfer = ds.createQueryRunner();
    await transfer.connect();
    await transfer.startTransaction();
    try {
      await transfer.query(
        "UPDATE memberships SET role = 'admin' WHERE workspace_id = $1 AND user_id = $2",
        [ws.id, owner.id],
      );
      await transfer.query(
        "UPDATE memberships SET role = 'owner' WHERE workspace_id = $1 AND user_id = $2",
        [ws.id, heir.id],
      );

      const check = ds.transaction((manager) => users.ownsLiveWorkspace(heir.id, manager));
      await new Promise((resolve) => setTimeout(resolve, 300));
      await transfer.commitTransaction();

      // Deleting `heir` now would leave the workspace without an owner.
      await expect(check).resolves.toBe(true);
    } finally {
      await transfer.release();
    }
  });
});
