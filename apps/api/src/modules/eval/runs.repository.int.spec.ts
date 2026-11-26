// SPDX-License-Identifier: AGPL-3.0-only
import type { DataSource } from 'typeorm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getTestDataSource, resetDatabase } from '../../../test/helpers/db';
import { asWorkspaceId } from '../../db/ids';
import { RunsRepository, type EvalCaseSnapshot, type EvalRunConfig } from './runs.repository';

let ds: DataSource;
let repository: RunsRepository;

describe('eval run comparison baseline', () => {
  beforeAll(async () => {
    ds = await getTestDataSource();
    repository = new RunsRepository(ds);
  });

  beforeEach(async () => {
    await resetDatabase(ds);
  });

  it('accepts only a completed opposite-mode run with matching immutable inputs', async () => {
    const workspace = await ds.query<{ id: string }[]>(
      `INSERT INTO workspaces (name, slug) VALUES ('Eval comparison', $1) RETURNING id`,
      [`eval-compare-${Math.random().toString(36).slice(2, 9)}`],
    );
    const workspaceId = workspace[0]?.id;
    if (workspaceId === undefined) throw new Error('Workspace insert returned no row.');
    const credential = await ds.query<{ id: string }[]>(
      `INSERT INTO provider_credentials (workspace_id, provider, label)
       VALUES ($1, 'local', 'Eval') RETURNING id`,
      [workspaceId],
    );
    const credentialId = credential[0]?.id;
    if (credentialId === undefined) throw new Error('Credential insert returned no row.');
    const bot = await ds.query<{ id: string }[]>(
      `INSERT INTO bots (workspace_id, name, public_key, chat_credential_id, chat_model,
                         embedding_credential_id, embedding_model, embedding_dim)
       VALUES ($1, 'Comparison bot', $2, $3, 'chat', $3, 'embed', 384) RETURNING id`,
      [workspaceId, `pk_live_${Math.random().toString(36).slice(2, 10)}`, credentialId],
    );
    const botId = bot[0]?.id;
    if (botId === undefined) throw new Error('Bot insert returned no row.');
    const dataset = await ds.query<{ id: string }[]>(
      `INSERT INTO eval_datasets (workspace_id, bot_id, name)
       VALUES ($1, $2, 'Comparison') RETURNING id`,
      [workspaceId, botId],
    );
    const datasetId = dataset[0]?.id;
    if (datasetId === undefined) throw new Error('Dataset insert returned no row.');

    const casesSnapshot: EvalCaseSnapshot[] = [];
    const baselineConfig: EvalRunConfig = {
      promptVersionId: null,
      chatCredentialId: credentialId,
      chatModel: 'chat',
      retrievalThreshold: 0.4,
      retrievalMode: 'vector',
      comparisonOnly: false,
      embeddingCredentialId: credentialId,
      embeddingModel: 'embed',
      embeddingDim: 384,
      knowledgeVersionFingerprint: 'stable-knowledge',
      judgeCredentialId: credentialId,
      judgeModel: 'judge',
      judgePromptVersion: 'eval-judge-v1',
      allowPartial: false,
      toolDefinitions: [],
    };
    const run = await ds.query<{ id: string }[]>(
      `INSERT INTO eval_runs (workspace_id, bot_id, dataset_id, status, config, cases_snapshot,
                              summary, finished_at)
       VALUES ($1, $2, $3, 'completed', $4::jsonb, $5::jsonb, $6::jsonb, now()) RETURNING id`,
      [
        workspaceId,
        botId,
        datasetId,
        JSON.stringify(baselineConfig),
        JSON.stringify(casesSnapshot),
        JSON.stringify({ passRate: 1, inconclusive: false }),
      ],
    );
    const baselineRunId = run[0]?.id;
    if (baselineRunId === undefined) throw new Error('Eval run insert returned no row.');

    const comparisonConfig = { ...baselineConfig, retrievalMode: 'hybrid' as const };
    const findBaseline = () =>
      repository.comparisonBaselineFor(
        asWorkspaceId(workspaceId),
        botId,
        datasetId,
        baselineRunId,
        comparisonConfig,
        casesSnapshot,
        ds.manager,
      );

    await expect(findBaseline()).resolves.toBe(baselineRunId);
    await ds.query(`UPDATE eval_runs SET config = config || '{"comparisonOnly": true}'::jsonb`);
    await expect(findBaseline()).resolves.toBeNull();
    await ds.query(`UPDATE eval_runs SET config = config || '{"comparisonOnly": false}'::jsonb,
                    summary = '{"passRate": 1, "inconclusive": true}'::jsonb`);
    await expect(findBaseline()).resolves.toBeNull();
    await ds.query(`UPDATE eval_runs SET summary = '{"passRate": 1, "inconclusive": false}'::jsonb,
                    config = config || '{"retrievalMode": "hybrid"}'::jsonb`);
    await expect(findBaseline()).resolves.toBeNull();
  });
});
