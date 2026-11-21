// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';

import { OutboxRepository } from './outbox.repository';

describe('OutboxRepository', () => {
  it('unwraps rows from TypeORM UPDATE RETURNING results', async () => {
    const claimed = {
      id: '01a1fc38-4f30-75eb-87aa-4a3c30b592eb',
      workspaceId: '01a1fc36-a794-7f62-8c86-2c77a5ed0ae6',
    };
    const query = vi.fn().mockResolvedValue([[claimed], 1]);
    const repository = new OutboxRepository({
      getRepository: vi.fn().mockReturnValue({}),
      query,
    } as never);

    await expect(repository.claimBatch(100, 'lease-owner', new Date(), 60_000)).resolves.toEqual([
      claimed,
    ]);
    expect(query).toHaveBeenCalledOnce();
  });
});
