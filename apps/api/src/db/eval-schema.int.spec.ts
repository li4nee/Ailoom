// SPDX-License-Identifier: AGPL-3.0-only
import type { DataSource } from 'typeorm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getTestDataSource, resetDatabase } from '../../test/helpers/db';

let ds: DataSource;

beforeAll(async () => {
  ds = await getTestDataSource();
});

beforeEach(async () => {
  await resetDatabase(ds);
});

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const [row] = await ds.query<T[]>(sql, params);
  if (row === undefined) throw new Error(`no row: ${sql}`);
  return row;
}

async function seedBot(): Promise<{ workspaceId: string; botId: string }> {
  const { id: workspaceId } = await one<{ id: string }>(
    `INSERT INTO workspaces (name, slug) VALUES ('Eval Workspace', 'eval-workspace') RETURNING id`,
  );
  const { id: credentialId } = await one<{ id: string }>(
    `INSERT INTO provider_credentials (workspace_id, provider, label)
     VALUES ($1, 'local', 'Built-in') RETURNING id`,
    [workspaceId],
  );
  const { id: botId } = await one<{ id: string }>(
    `INSERT INTO bots (workspace_id, name, public_key, chat_credential_id, chat_model,
                       embedding_credential_id, embedding_model, embedding_dim, no_answer_behavior)
     VALUES ($1, 'Eval bot', 'pk_live_eval', $2, 'mock-chat', $2, 'bge-small-en-v1.5', 384,
             'offer_handoff') RETURNING id`,
    [workspaceId, credentialId],
  );
  return { workspaceId, botId };
}

describe('eval schema', () => {
  it('runs the migration and creates the dataset, case, run and result tables', async () => {
    const names = await ds.query<{ name: string }[]>(
      `SELECT name FROM migrations WHERE name = 'EvalSuite1794620000000'`,
    );
    expect(names).toHaveLength(1);

    const tables = await ds.query<{ tablename: string }[]>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
    );
    expect(tables.map((row) => row.tablename)).toEqual(
      expect.arrayContaining(['eval_datasets', 'eval_cases', 'eval_runs', 'eval_results']),
    );
  });

  it('accepts eval as a trace origin', async () => {
    const { workspaceId, botId } = await seedBot();
    await expect(
      ds.query(
        `INSERT INTO generation_traces (workspace_id, bot_id, origin, decision)
         VALUES ($1, $2, 'eval', 'answered')`,
        [workspaceId, botId],
      ),
    ).resolves.toBeDefined();
  });

  it('cascades bot deletion through datasets and cases', async () => {
    const { workspaceId, botId } = await seedBot();
    const { id: datasetId } = await one<{ id: string }>(
      `INSERT INTO eval_datasets (workspace_id, bot_id, name) VALUES ($1, $2, 'Refunds') RETURNING id`,
      [workspaceId, botId],
    );
    await ds.query(
      `INSERT INTO eval_cases (workspace_id, dataset_id, question, expected_answer)
       VALUES ($1, $2, 'How long?', '30 days')`,
      [workspaceId, datasetId],
    );

    await ds.query(`DELETE FROM bots WHERE id = $1`, [botId]);

    expect(await ds.query(`SELECT 1 FROM eval_datasets WHERE id = $1`, [datasetId])).toHaveLength(
      0,
    );
    expect(
      await ds.query(`SELECT 1 FROM eval_cases WHERE dataset_id = $1`, [datasetId]),
    ).toHaveLength(0);
  });

  it('enforces a single result per run and case', async () => {
    const { workspaceId, botId } = await seedBot();
    const { id: datasetId } = await one<{ id: string }>(
      `INSERT INTO eval_datasets (workspace_id, bot_id, name) VALUES ($1, $2, 'Regression') RETURNING id`,
      [workspaceId, botId],
    );
    const { id: caseId } = await one<{ id: string }>(
      `INSERT INTO eval_cases (workspace_id, dataset_id, question, expect_handoff)
       VALUES ($1, $2, 'Should this hand off?', true) RETURNING id`,
      [workspaceId, datasetId],
    );
    const { id: runId } = await one<{ id: string }>(
      `INSERT INTO eval_runs (workspace_id, bot_id, dataset_id, config)
       VALUES ($1, $2, $3, '{}'::jsonb) RETURNING id`,
      [workspaceId, botId, datasetId],
    );
    const values = [workspaceId, runId, caseId];
    const insert = `INSERT INTO eval_results (workspace_id, run_id, case_id, decision)
                    VALUES ($1, $2, $3, 'answered')`;

    await ds.query(insert, values);
    await expect(ds.query(insert, values)).rejects.toThrow();
  });

  it('requires an expectation unless the case is explicitly incomplete', async () => {
    const { workspaceId, botId } = await seedBot();
    const { id: datasetId } = await one<{ id: string }>(
      `INSERT INTO eval_datasets (workspace_id, bot_id, name) VALUES ($1, $2, 'Incomplete') RETURNING id`,
      [workspaceId, botId],
    );
    await expect(
      ds.query(
        `INSERT INTO eval_cases (workspace_id, dataset_id, question)
         VALUES ($1, $2, 'No expected result')`,
        [workspaceId, datasetId],
      ),
    ).rejects.toThrow();
    await expect(
      ds.query(
        `INSERT INTO eval_cases (workspace_id, dataset_id, question, needs_expectation)
         VALUES ($1, $2, 'Needs review', true)`,
        [workspaceId, datasetId],
      ),
    ).resolves.toBeDefined();
  });
});
