// SPDX-License-Identifier: AGPL-3.0-only
import type { DataSource } from 'typeorm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getTestDataSource, resetDatabase } from '../../../test/helpers/db';
import { asWorkspaceId, type WorkspaceId } from '../../db/ids';
import { SpendCapService } from './spend-cap.service';
import { UsageRepository } from './usage.repository';
import { utcDay } from './utc';

let ds: DataSource;
let usage: UsageRepository;
let service: SpendCapService;

interface Seeded {
  workspaceId: WorkspaceId;
  botId: string;
}

async function seedBot(cap: string | null = null): Promise<Seeded> {
  const rows = await ds.query<{ id: string }[]>(
    `INSERT INTO workspaces (name, slug) VALUES ('Usage', $1) RETURNING id`,
    [`usage-${Math.random().toString(36).slice(2, 8)}`],
  );
  const workspaceId = asWorkspaceId(rows[0]?.id ?? '');
  const credentials = await ds.query<{ id: string }[]>(
    `INSERT INTO provider_credentials (workspace_id, provider, label)
     VALUES ($1, 'mock', 'chat'), ($1, 'mock', 'embed') RETURNING id`,
    [workspaceId],
  );
  const [chat, embed] = credentials.map((row) => row.id);
  const bot = await ds.query<{ id: string }[]>(
    `INSERT INTO bots (workspace_id, name, public_key, chat_credential_id, chat_model,
                       embedding_credential_id, embedding_model, embedding_dim, monthly_spend_cap_usd)
     VALUES ($1, 'Help', $2, $3, 'mock-chat', $4, 'mock-embed', 384, $5) RETURNING id`,
    [workspaceId, `pk_live_${Math.random().toString(36).slice(2, 10)}`, chat, embed, cap],
  );
  return { workspaceId, botId: bot[0]?.id ?? '' };
}

async function add(seeded: Seeded, day: Date, costUsd: string): Promise<void> {
  await ds.transaction(async (manager) => {
    await usage.increment(
      manager,
      { workspaceId: seeded.workspaceId, botId: seeded.botId, day: utcDay(day) },
      { costUsd },
    );
  });
}

beforeAll(async () => {
  ds = await getTestDataSource();
  usage = new UsageRepository(ds);
  service = new SpendCapService(usage);
});

beforeEach(async () => {
  await resetDatabase(ds);
});

describe('monthToDateCost', () => {
  it('separates months at the UTC boundary', async () => {
    const seeded = await seedBot();
    await add(seeded, new Date('2026-01-31T23:59:59Z'), '5.000000');
    await add(seeded, new Date('2026-02-01T00:00:00Z'), '1.000000');

    expect(
      await usage.monthToDateCost(
        seeded.workspaceId,
        seeded.botId,
        new Date('2026-02-01T00:00:00Z'),
      ),
    ).toBe('1.000000');
    expect(
      await usage.monthToDateCost(
        seeded.workspaceId,
        seeded.botId,
        new Date('2026-01-31T23:59:59Z'),
      ),
    ).toBe('5.000000');
  });

  it('is zero with no usage', async () => {
    const seeded = await seedBot();
    expect(
      await usage.monthToDateCost(
        seeded.workspaceId,
        seeded.botId,
        new Date('2026-02-01T00:00:00Z'),
      ),
    ).toBe('0.000000');
  });

  it('never crosses workspaces or bots', async () => {
    const mine = await seedBot();
    const theirs = await seedBot();
    await add(theirs, new Date('2026-02-01T00:00:00Z'), '9.000000');

    expect(
      await usage.monthToDateCost(mine.workspaceId, mine.botId, new Date('2026-02-01T00:00:00Z')),
    ).toBe('0.000000');
  });

  it('adds concurrent increments exactly', async () => {
    const seeded = await seedBot();
    const day = new Date('2026-02-01T00:00:00Z');
    await Promise.all(
      Array.from({ length: 50 }, async () => {
        await add(seeded, day, '0.000001');
      }),
    );

    expect(await usage.monthToDateCost(seeded.workspaceId, seeded.botId, day)).toBe('0.000050');
  });
});

describe('SpendCapService.check', () => {
  it.each([
    ['7.99', 'ok'],
    ['8.00', 'warn'],
    ['10.00', 'reached'],
    ['12.00', 'reached'],
  ] as const)('mtd %s of cap 10 → %s', async (mtd, state) => {
    const seeded = await seedBot('10.00');
    const now = new Date('2026-02-01T12:00:00Z');
    await add(seeded, now, mtd);

    expect(
      await service.check(
        seeded.workspaceId,
        { id: seeded.botId, monthlySpendCapUsd: '10.00' },
        now,
      ),
    ).toMatchObject({ state, mtdUsd: `${mtd}0000`, capUsd: '10.00' });
  });

  it('no cap is always ok', async () => {
    const seeded = await seedBot(null);
    const now = new Date('2026-02-01T12:00:00Z');
    await add(seeded, now, '999.000000');

    expect(
      await service.check(seeded.workspaceId, { id: seeded.botId, monthlySpendCapUsd: null }, now),
    ).toEqual({ state: 'ok', mtdUsd: '999.000000', capUsd: null, ratio: null });
  });

  it('resets at the UTC month boundary', async () => {
    const seeded = await seedBot('10.00');
    await add(seeded, new Date('2026-01-31T23:59:59Z'), '10.000000');

    expect(
      await service.check(
        seeded.workspaceId,
        { id: seeded.botId, monthlySpendCapUsd: '10.00' },
        new Date('2026-01-31T23:59:59Z'),
      ),
    ).toMatchObject({ state: 'reached' });
    expect(
      await service.check(
        seeded.workspaceId,
        { id: seeded.botId, monthlySpendCapUsd: '10.00' },
        new Date('2026-02-01T00:00:00Z'),
      ),
    ).toMatchObject({ state: 'ok', mtdUsd: '0.000000' });
  });
});
