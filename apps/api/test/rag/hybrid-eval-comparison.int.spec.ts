// SPDX-License-Identifier: AGPL-3.0-only
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { asBotId, asCredentialId, asUserId, asWorkspaceId } from '../../src/db/ids';
import { EvalCaseProcessor } from '../../src/modules/eval/eval-case.processor';
import { EvalRunProcessor } from '../../src/modules/eval/eval-run.processor';
import { RunsRepository } from '../../src/modules/eval/runs.repository';
import { RunsService } from '../../src/modules/eval/runs.service';
import { Llm } from '../../src/providers/llm.service';
import { createTestApp, type TestApp } from '../helpers/app';
import { resetDatabase } from '../helpers/db';
import { createUser, createWorkspace } from '../helpers/factories';

const QUESTION = 'What warranty applies to product SKU TRL-8472-BLK?';

function unitBlend(queryVector: number[]): number[] {
  const axis = queryVector[0] ?? 0;
  const orthogonal: number[] = queryVector.map(
    (value, index) => value - (index === 0 ? axis : 0) * value,
  );
  const dot = queryVector[0] ?? 0;
  const norm = Math.hypot(...queryVector);
  const projection = dot / norm;
  for (let index = 0; index < queryVector.length; index += 1) {
    const current = queryVector[index] ?? 0;
    orthogonal[index] = (index === 0 ? 1 : 0) - (current / norm) * projection;
  }
  const orthogonalNorm = Math.hypot(...orthogonal);
  return queryVector.map((value, index) => {
    const direction = (orthogonal[index] ?? 0) / orthogonalNorm;
    return value * 0.9 + direction * Math.sqrt(1 - 0.9 ** 2);
  });
}

let app: TestApp;
let ds: DataSource;

describe('M15 hybrid retrieval comparison', () => {
  beforeAll(async () => {
    app = await createTestApp();
    ds = app.ds;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(ds);
  });

  it('runs vector and hybrid through M15 and reports a comparable exact-term gain', async () => {
    const { user } = await createUser({ ds });
    const workspace = await createWorkspace(app, user, 'Hybrid Eval');
    const workspaceId = asWorkspaceId(workspace.id);
    const credentials = await ds.query<{ id: string }[]>(
      `INSERT INTO provider_credentials (workspace_id, provider, label)
       VALUES ($1, 'mock', 'M19 test models') RETURNING id`,
      [workspaceId],
    );
    const credentialId = credentials[0]?.id;
    if (credentialId === undefined) throw new Error('Credential insert returned no row.');
    const bots = await ds.query<{ id: string }[]>(
      `INSERT INTO bots (workspace_id, name, public_key, chat_credential_id, chat_model,
                         embedding_credential_id, embedding_model, embedding_dim,
                         retrieval_threshold, retrieval_mode)
       VALUES ($1, 'Hybrid comparison', $2, $3, 'mock-chat', $3, 'mock-embed', 384, 0.5,
               'vector') RETURNING id`,
      [workspaceId, `pk_live_hybrid_eval_${String(Date.now())}`, credentialId],
    );
    const botId = bots[0]?.id;
    if (botId === undefined) throw new Error('Bot insert returned no row.');
    const sourceRows = await ds.query<{ id: string }[]>(
      `INSERT INTO knowledge_sources (workspace_id, bot_id, type, title, options, status)
       VALUES ($1, $2, 'text', 'Hybrid evaluation fixtures', '{}'::jsonb, 'ready') RETURNING id`,
      [workspaceId, botId],
    );
    const sourceId = sourceRows[0]?.id;
    if (sourceId === undefined) throw new Error('Knowledge source insert returned no row.');
    const catalogDocument = await ds.query<{ id: string }[]>(
      `INSERT INTO documents (workspace_id, bot_id, source_id, title)
       VALUES ($1, $2, $3, 'catalog') RETURNING id`,
      [workspaceId, botId, sourceId],
    );
    const distractorDocument = await ds.query<{ id: string }[]>(
      `INSERT INTO documents (workspace_id, bot_id, source_id, title)
       VALUES ($1, $2, $3, 'payments') RETURNING id`,
      [workspaceId, botId, sourceId],
    );
    const catalogId = catalogDocument[0]?.id;
    const distractorId = distractorDocument[0]?.id;
    if (catalogId === undefined || distractorId === undefined) {
      throw new Error('Fixture document insert returned no row.');
    }
    const vectorDistractors: { id: string; content: string }[] = [];
    for (let index = 0; index < 5; index += 1) {
      const rows = await ds.query<{ id: string }[]>(
        `INSERT INTO documents (workspace_id, bot_id, source_id, title)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [workspaceId, botId, sourceId, `unrelated-${String(index)}`],
      );
      const id = rows[0]?.id;
      if (id === undefined) throw new Error('Distractor document insert returned no row.');
      vectorDistractors.push({
        id,
        content: `Unrelated guide entry ${String(index)}: parking hours.`,
      });
    }
    const documents = [
      {
        id: catalogId,
        content: 'SKU-TRL-8472-BLK is covered by the jacket warranty for two years.',
      },
      {
        id: distractorId,
        content: 'SKU-TRL-8473-BLK is an unrelated payment plan with monthly billing.',
      },
      ...vectorDistractors,
    ];
    const versionByDocument = new Map<string, string>();
    for (const [index, document] of documents.entries()) {
      const rows = await ds.query<{ id: string }[]>(
        `INSERT INTO document_versions (workspace_id, document_id, content_hash, content)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [workspaceId, document.id, `hash-${String(index)}`, document.content],
      );
      const versionId = rows[0]?.id;
      if (versionId === undefined) throw new Error('Fixture version insert returned no row.');
      versionByDocument.set(document.id, versionId);
      await ds.query(`UPDATE documents SET current_version_id = $2 WHERE id = $1`, [
        document.id,
        versionId,
      ]);
    }

    const embedding = await app.app.get(Llm).embed({
      workspaceId,
      credentialId: asCredentialId(credentialId),
      model: 'mock-embed',
      purpose: 'query',
      inputs: [QUESTION],
      signal: new AbortController().signal,
    });
    const queryVector = embedding.vectors[0];
    if (queryVector === undefined) throw new Error('Mock embedding returned no vector.');
    const distractorVector = `[${queryVector.join(',')}]`;
    const catalogVector = `[${unitBlend(queryVector).join(',')}]`;
    for (const document of documents) {
      const versionId = versionByDocument.get(document.id);
      if (versionId === undefined) throw new Error('Fixture version was not recorded.');
      await ds.query(
        `INSERT INTO chunks (workspace_id, bot_id, document_version_id, ordinal, heading_path,
                             content, token_count, embedding, embedding_model, embedding_dim)
         VALUES ($1, $2, $3, 0, '# Product', $4, 12, $5::vector, 'mock-embed', 384)`,
        [
          workspaceId,
          botId,
          versionId,
          document.content,
          document.id === catalogId ? catalogVector : distractorVector,
        ],
      );
    }

    const datasets = await ds.query<{ id: string }[]>(
      `INSERT INTO eval_datasets (workspace_id, bot_id, name, created_by)
       VALUES ($1, $2, 'Exact identifier comparison', $3) RETURNING id`,
      [workspaceId, botId, user.id],
    );
    const datasetId = datasets[0]?.id;
    if (datasetId === undefined) throw new Error('Dataset insert returned no row.');
    await ds.query(
      `INSERT INTO eval_cases (workspace_id, dataset_id, question, expected_document_ids)
       VALUES ($1, $2, $3, ARRAY[$4]::uuid[])`,
      [workspaceId, datasetId, QUESTION, catalogId],
    );

    const runs = app.app.get(RunsService);
    const runProcessor = app.app.get(EvalRunProcessor);
    const caseProcessor = app.app.get(EvalCaseProcessor);
    const judgeRequest = { judgeCredentialId: credentialId, judgeModel: 'mock-chat' };
    async function executeRun(runId: string): Promise<void> {
      await runProcessor.handle({ workspaceId, runId });
      await caseProcessor.handle(
        { workspaceId, runId, caseIndex: 0 },
        { jobId: runId, attempt: 1, signal: new AbortController().signal },
      );
    }

    const vectorRun = await runs.start(workspaceId, asBotId(botId), asUserId(user.id), {
      datasetId,
      ...judgeRequest,
      retrievalMode: 'vector',
    });
    await executeRun(vectorRun.id);
    const vectorCompleted = await app.app.get(RunsRepository).findRun(workspaceId, vectorRun.id);
    expect(vectorCompleted?.status).toBe('completed');

    const hybridRun = await runs.start(workspaceId, asBotId(botId), asUserId(user.id), {
      datasetId,
      ...judgeRequest,
      retrievalMode: 'hybrid',
      baselineRunId: vectorRun.id,
    });
    await executeRun(hybridRun.id);

    const hybridCompleted = await app.app.get(RunsRepository).findRun(workspaceId, hybridRun.id);
    expect(hybridCompleted?.status).toBe('completed');
    expect(hybridCompleted?.baseline_run_id).toBe(vectorRun.id);
    expect(hybridCompleted?.summary?.hitAtK).toBe(1);
    expect(vectorCompleted?.summary?.hitAtK).toBe(0);
    expect(hybridCompleted?.summary?.mrr).toBeGreaterThan(vectorCompleted?.summary?.mrr ?? 0);
    expect(hybridCompleted?.summary?.citationAccuracy).toBeGreaterThanOrEqual(
      vectorCompleted?.summary?.citationAccuracy ?? 0,
    );
    const changedCases = await runs.results(workspaceId, asBotId(botId), hybridRun.id, {
      limit: 10,
      filter: 'changed',
    });
    expect(changedCases.data).toHaveLength(1);
    expect(changedCases.data[0]).toMatchObject({ passed: true, baselinePassed: false });

    const knowledgeDriftRun = await runs.start(workspaceId, asBotId(botId), asUserId(user.id), {
      datasetId,
      ...judgeRequest,
      retrievalMode: 'vector',
    });
    const changedVersion = await ds.query<{ id: string }[]>(
      `INSERT INTO document_versions (workspace_id, document_id, content_hash, content)
       VALUES ($1, $2, 'changed-after-eval-start', 'Updated warranty policy.') RETURNING id`,
      [workspaceId, catalogId],
    );
    const changedVersionId = changedVersion[0]?.id;
    if (changedVersionId === undefined) throw new Error('Changed version insert returned no row.');
    await ds.query(`UPDATE documents SET current_version_id = $2 WHERE id = $1`, [
      catalogId,
      changedVersionId,
    ]);
    await executeRun(knowledgeDriftRun.id);
    const knowledgeDriftCompleted = await app.app
      .get(RunsRepository)
      .findRun(workspaceId, knowledgeDriftRun.id);
    expect(knowledgeDriftCompleted?.status).toBe('completed');
    expect(knowledgeDriftCompleted?.summary?.inconclusive).toBe(true);
    const knowledgeDriftCases = await runs.results(
      workspaceId,
      asBotId(botId),
      knowledgeDriftRun.id,
      { limit: 10, filter: 'all' },
    );
    expect(knowledgeDriftCases.data[0]?.error).toBe('knowledge_changed_during_eval');

    const embeddingDriftRun = await runs.start(workspaceId, asBotId(botId), asUserId(user.id), {
      datasetId,
      ...judgeRequest,
      retrievalMode: 'vector',
    });
    await ds.query(
      `UPDATE bots SET embedding_model = 'mock-embed-alt', embedding_dim = 384 WHERE id = $1`,
      [botId],
    );
    await executeRun(embeddingDriftRun.id);
    const embeddingDriftCompleted = await app.app
      .get(RunsRepository)
      .findRun(workspaceId, embeddingDriftRun.id);
    expect(embeddingDriftCompleted?.status).toBe('completed');
    expect(embeddingDriftCompleted?.summary?.inconclusive).toBe(true);
    const embeddingDriftCases = await runs.results(
      workspaceId,
      asBotId(botId),
      embeddingDriftRun.id,
      { limit: 10, filter: 'all' },
    );
    expect(embeddingDriftCases.data[0]?.error).toBe('embedding_config_changed_during_eval');
  }, 120_000);
});
