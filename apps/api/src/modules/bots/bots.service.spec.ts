// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';

import { FixedClock } from '../../common/clock';
import type { BotEntity } from './bot.entity';
import { REEMBED_BOT_JOB } from './bots.jobs';
import { BotsService } from './bots.service';

const WS = '0192f8a1-7c3e-7a4b-9c2d-1e2f3a4b5c00';
const BOT = '0192f8a1-7c3e-7a4b-9c2d-1e2f3a4b5c01';
const ACTOR = '0192f8a1-7c3e-7a4b-9c2d-1e2f3a4b5c02';
const CRED = '0192f8a1-7c3e-7a4b-9c2d-1e2f3a4b5c03';

function build(chunkCount: number) {
  const manager = { tag: 'tx' };
  const existing = {
    id: BOT,
    deletedAt: null,
    embeddingCredentialId: CRED,
    embeddingModel: 'text-embedding-3-small',
    embeddingDim: 1536,
    appearance: {},
  } as unknown as BotEntity;
  const ds = {
    transaction: (fn: (m: unknown) => Promise<unknown>) => fn(manager),
  };
  const repository = {
    getById: vi.fn(() => Promise.resolve(existing)),
    countChunks: vi.fn(() => Promise.resolve(chunkCount)),
    clearReembedPending: vi.fn(() => Promise.resolve()),
    markReembedPending: vi.fn(() => Promise.resolve(7)),
    updateById: vi.fn(() => Promise.resolve(existing)),
  };
  const credentials = {
    get: vi.fn(() => Promise.resolve({ id: CRED, provider: 'openai' })),
  };
  const jobs = { enqueue: vi.fn(() => Promise.resolve()) };
  const audit = { record: vi.fn(() => Promise.resolve()) };
  const service = new BotsService(
    ds as never,
    repository as never,
    credentials as never,
    jobs as never,
    audit,
    new FixedClock(new Date('2026-01-01T00:00:00.000Z')),
    {} as never,
  );
  return { service, repository, jobs, manager };
}

function switchModel(service: BotsService) {
  return service.update(
    WS as never,
    BOT,
    { embeddingModel: 'text-embedding-3-large' },
    ACTOR as never,
  );
}

describe('BotsService embedding change', () => {
  it('applies the model directly and clears a pending re-embed when there is no corpus', async () => {
    const fakes = build(0);

    await switchModel(fakes.service);

    expect(fakes.repository.clearReembedPending).toHaveBeenCalledWith(fakes.manager, WS, BOT);
    expect(fakes.repository.markReembedPending).not.toHaveBeenCalled();
    expect(fakes.jobs.enqueue).not.toHaveBeenCalled();
    expect(fakes.repository.updateById).toHaveBeenCalledWith(
      WS,
      BOT,
      expect.objectContaining({ embeddingModel: 'text-embedding-3-large', embeddingDim: 3072 }),
      fakes.manager,
    );
    // The clear must land before the update so the stale pending columns never survive it.
    expect(fakes.repository.clearReembedPending.mock.invocationCallOrder[0]).toBeLessThan(
      fakes.repository.updateById.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('marks the model pending and enqueues a re-embed when chunks exist', async () => {
    const fakes = build(5);

    await switchModel(fakes.service);

    expect(fakes.repository.clearReembedPending).not.toHaveBeenCalled();
    expect(fakes.repository.markReembedPending).toHaveBeenCalledWith(
      fakes.manager,
      expect.objectContaining({ model: 'text-embedding-3-large', dim: 3072 }),
    );
    // The bot keeps answering with the old model until the re-embed swaps it.
    const patch = (fakes.repository.updateById.mock.calls[0] as unknown[])[2];
    expect(patch).not.toHaveProperty('embeddingModel');
    expect(fakes.jobs.enqueue).toHaveBeenCalledWith(
      REEMBED_BOT_JOB,
      expect.objectContaining({ targetModel: 'text-embedding-3-large', generation: 7 }),
      { manager: fakes.manager },
    );
  });

  it('touches neither path when the form resends the stored model', async () => {
    const fakes = build(0);

    await fakes.service.update(
      WS as never,
      BOT,
      { name: 'Renamed', embeddingModel: 'text-embedding-3-small' },
      ACTOR as never,
    );

    expect(fakes.repository.clearReembedPending).not.toHaveBeenCalled();
    expect(fakes.repository.markReembedPending).not.toHaveBeenCalled();
  });
});
