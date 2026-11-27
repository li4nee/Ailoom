// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { DataSource } from 'typeorm';

import type { EvalRunStatus, EvalSummary, EvalToolDefinition, EvalToolFixture } from '@app/shared';

import type { WorkspaceId } from '../../db/ids';
import { decodeCursor, encodeCursor } from '../../db/pagination';
import { summarize, type EvalResultRow } from './metrics';

export interface EvalCaseSnapshot {
  id: string;
  question: string;
  history: { role: 'visitor' | 'ai'; content: string }[];
  expectedAnswer: string | null;
  expectedDocumentIds: string[];
  mustInclude: string[];
  mustNotInclude: string[];
  expectHandoff: boolean | null;
  needsExpectation: boolean;
  toolFixtures: EvalToolFixture[];
}

export interface EvalRunConfig {
  promptVersionId: string | null;
  chatCredentialId: string;
  chatModel: string;
  retrievalThreshold: number;
  retrievalMode: 'vector' | 'hybrid';
  rerankingEnabled: boolean;
  queryRewritingEnabled: boolean;
  comparisonOnly: boolean;
  embeddingCredentialId: string;
  embeddingModel: string;
  embeddingDim: number;
  knowledgeVersionFingerprint: string;
  judgeCredentialId: string;
  judgeModel: string;
  judgePromptVersion: string;
  allowPartial: boolean;
  toolDefinitions: EvalToolDefinition[];
}

export interface EvalRunRow {
  id: string;
  workspace_id: string;
  bot_id: string;
  dataset_id: string;
  status: EvalRunStatus;
  config: EvalRunConfig;
  cases_snapshot: EvalCaseSnapshot[];
  cases_total: number;
  cases_done: number;
  summary: EvalSummary | null;
  baseline_run_id: string | null;
  cost_usd: string;
  error: string | null;
  created_by: string | null;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
}

interface EvalResultDbRow {
  id: string;
  run_id: string;
  case_id: string | null;
  trace_id: string | null;
  decision: string;
  answer: string;
  citations: unknown[];
  retrieved: unknown[];
  metrics: EvalResultRow['metrics'];
  passed: boolean;
  error: string | null;
  latency_ms: number | null;
  cost_usd: string;
  created_at: Date;
}

function rowsFromReturning<T>(result: T[] | [T[], number]): T[] {
  const first = result[0] as T | T[] | undefined;
  return Array.isArray(first) ? first : (result as T[]);
}

@Injectable()
export class RunsRepository {
  constructor(private readonly ds: DataSource) {}

  async lockWorkspace(workspaceId: WorkspaceId, manager: EntityManager) {
    await manager.query(`SELECT id FROM workspaces WHERE id = $1 FOR UPDATE`, [workspaceId]);
  }

  async lockBot(workspaceId: WorkspaceId, botId: string, manager: EntityManager) {
    const rows = await manager.query<{ id: string; deleted_at: Date | null }[]>(
      `SELECT id, deleted_at FROM bots WHERE workspace_id = $1 AND id = $2 FOR UPDATE`,
      [workspaceId, botId],
    );
    return rows[0] ?? null;
  }

  async activeRunsForBot(workspaceId: WorkspaceId, botId: string, manager: EntityManager) {
    const rows = await manager.query<{ count: number }[]>(
      `SELECT count(*)::int AS count FROM eval_runs
        WHERE workspace_id = $1 AND bot_id = $2 AND status IN ('queued', 'running')`,
      [workspaceId, botId],
    );
    return rows[0]?.count ?? 0;
  }

  async toolCallsForTrace(
    workspaceId: WorkspaceId,
    traceId: string,
  ): Promise<{ name: string; status: 'started' | 'complete' | 'failed' }[]> {
    const rows = await this.ds.query<{ tool_calls: unknown }[]>(
      `SELECT tool_calls FROM generation_traces WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, traceId],
    );
    const calls = rows[0]?.tool_calls;
    if (!Array.isArray(calls)) return [];
    return calls.flatMap((call) => {
      if (call === null || typeof call !== 'object') return [];
      const record = call as Record<string, unknown>;
      const name = record['name'];
      const status = record['status'];
      if (
        typeof name !== 'string' ||
        (status !== 'started' && status !== 'complete' && status !== 'failed')
      ) {
        return [];
      }
      return [{ name, status }];
    });
  }

  async activeRunsForWorkspace(workspaceId: WorkspaceId, manager: EntityManager) {
    const rows = await manager.query<{ count: number }[]>(
      `SELECT count(*)::int AS count FROM eval_runs
        WHERE workspace_id = $1 AND status IN ('queued', 'running')`,
      [workspaceId],
    );
    return rows[0]?.count ?? 0;
  }

  async createRun(
    workspaceId: WorkspaceId,
    botId: string,
    datasetId: string,
    userId: string,
    config: EvalRunConfig,
    cases: EvalCaseSnapshot[],
    baselineRunId: string | null,
    manager: EntityManager,
  ) {
    const rows = await manager.query<EvalRunRow[]>(
      `INSERT INTO eval_runs (workspace_id, bot_id, dataset_id, config, cases_snapshot,
                              cases_total, created_by, baseline_run_id)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8)
       RETURNING *`,
      [
        workspaceId,
        botId,
        datasetId,
        JSON.stringify(config),
        JSON.stringify(cases),
        cases.length,
        userId,
        baselineRunId,
      ],
    );
    const row = rows[0];
    if (row === undefined) throw new Error('Eval run insert did not return a row.');
    return row;
  }

  async baselineFor(
    workspaceId: WorkspaceId,
    botId: string,
    datasetId: string,
    activeConfig: Pick<
      EvalRunConfig,
      | 'promptVersionId'
      | 'chatCredentialId'
      | 'chatModel'
      | 'retrievalThreshold'
      | 'retrievalMode'
      | 'rerankingEnabled'
      | 'queryRewritingEnabled'
      | 'judgeCredentialId'
      | 'judgeModel'
      | 'embeddingCredentialId'
      | 'embeddingModel'
      | 'embeddingDim'
      | 'knowledgeVersionFingerprint'
      | 'comparisonOnly'
      | 'toolDefinitions'
    >,
    casesSnapshot: EvalCaseSnapshot[],
    manager: EntityManager,
  ) {
    const rows = await manager.query<{ id: string }[]>(
      `SELECT id FROM eval_runs
        WHERE workspace_id = $1 AND bot_id = $2 AND dataset_id = $3 AND status = 'completed'
          AND config->>'promptVersionId' IS NOT DISTINCT FROM $4
          AND config->>'chatCredentialId' = $5
          AND config->>'chatModel' = $6
          AND (config->>'retrievalThreshold')::real = $7
          AND COALESCE(config->'toolDefinitions', '[]'::jsonb) = $8::jsonb
          AND COALESCE(config->>'retrievalMode', 'vector') = $9
          AND COALESCE((config->>'rerankingEnabled')::boolean, false) = $18
          AND COALESCE((config->>'queryRewritingEnabled')::boolean, false) = $19
          AND COALESCE((config->>'comparisonOnly')::boolean, false) = false
          AND config->>'judgeCredentialId' = $10
          AND config->>'judgeModel' = $11
          AND COALESCE(config->>'embeddingCredentialId', $12) = $12
          AND COALESCE(config->>'embeddingModel', $13) = $13
          AND COALESCE((config->>'embeddingDim')::int, $14) = $14
          AND cases_snapshot = $15::jsonb
          AND (
            ($16::boolean AND config->>'knowledgeVersionFingerprint' = $17)
            OR (NOT $16::boolean AND (
              config->>'knowledgeVersionFingerprint' IS NULL
              OR config->>'knowledgeVersionFingerprint' = $17
            ))
          )
          AND COALESCE((summary->>'inconclusive')::boolean, false) = false
        ORDER BY finished_at DESC NULLS LAST, id DESC LIMIT 1`,
      [
        workspaceId,
        botId,
        datasetId,
        activeConfig.promptVersionId,
        activeConfig.chatCredentialId,
        activeConfig.chatModel,
        activeConfig.retrievalThreshold,
        JSON.stringify(activeConfig.toolDefinitions),
        activeConfig.retrievalMode,
        activeConfig.judgeCredentialId,
        activeConfig.judgeModel,
        activeConfig.embeddingCredentialId,
        activeConfig.embeddingModel,
        activeConfig.embeddingDim,
        JSON.stringify(casesSnapshot),
        activeConfig.comparisonOnly,
        activeConfig.knowledgeVersionFingerprint,
        activeConfig.rerankingEnabled,
        activeConfig.queryRewritingEnabled,
      ],
    );
    return rows[0]?.id ?? null;
  }

  async comparisonBaselineFor(
    workspaceId: WorkspaceId,
    botId: string,
    datasetId: string,
    baselineRunId: string,
    activeConfig: Pick<
      EvalRunConfig,
      | 'promptVersionId'
      | 'chatCredentialId'
      | 'chatModel'
      | 'retrievalThreshold'
      | 'retrievalMode'
      | 'rerankingEnabled'
      | 'queryRewritingEnabled'
      | 'judgeCredentialId'
      | 'judgeModel'
      | 'embeddingCredentialId'
      | 'embeddingModel'
      | 'embeddingDim'
      | 'knowledgeVersionFingerprint'
      | 'toolDefinitions'
    >,
    casesSnapshot: EvalCaseSnapshot[],
    manager: EntityManager,
  ) {
    const rows = await manager.query<{ id: string }[]>(
      `SELECT id FROM eval_runs
        WHERE workspace_id = $1 AND bot_id = $2 AND dataset_id = $3 AND id = $4
          AND status = 'completed'
          AND (COALESCE(config->>'retrievalMode', 'vector') <> $5
            OR COALESCE((config->>'rerankingEnabled')::boolean, false) <> $18
            OR COALESCE((config->>'queryRewritingEnabled')::boolean, false) <> $19)
          AND COALESCE((config->>'comparisonOnly')::boolean, false) = false
          AND config->>'promptVersionId' IS NOT DISTINCT FROM $6
          AND config->>'chatCredentialId' = $7
          AND config->>'chatModel' = $8
          AND (config->>'retrievalThreshold')::real = $9
          AND COALESCE(config->'toolDefinitions', '[]'::jsonb) = $10::jsonb
          AND config->>'judgeCredentialId' = $11
          AND config->>'judgeModel' = $12
          AND COALESCE(config->>'embeddingCredentialId', $13) = $13
          AND COALESCE(config->>'embeddingModel', $14) = $14
          AND COALESCE((config->>'embeddingDim')::int, $15) = $15
          AND config->>'knowledgeVersionFingerprint' = $16
          AND cases_snapshot = $17::jsonb
          AND COALESCE((summary->>'inconclusive')::boolean, false) = false
        LIMIT 1`,
      [
        workspaceId,
        botId,
        datasetId,
        baselineRunId,
        activeConfig.retrievalMode,
        activeConfig.promptVersionId,
        activeConfig.chatCredentialId,
        activeConfig.chatModel,
        activeConfig.retrievalThreshold,
        JSON.stringify(activeConfig.toolDefinitions),
        activeConfig.judgeCredentialId,
        activeConfig.judgeModel,
        activeConfig.embeddingCredentialId,
        activeConfig.embeddingModel,
        activeConfig.embeddingDim,
        activeConfig.knowledgeVersionFingerprint,
        JSON.stringify(casesSnapshot),
        activeConfig.rerankingEnabled,
        activeConfig.queryRewritingEnabled,
      ],
    );
    return rows[0]?.id ?? null;
  }

  async findRun(workspaceId: WorkspaceId, runId: string, manager = this.ds.manager) {
    const rows = await manager.query<EvalRunRow[]>(
      `SELECT * FROM eval_runs WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, runId],
    );
    return rows[0] ?? null;
  }

  async findRunForUpdate(workspaceId: WorkspaceId, runId: string, manager: EntityManager) {
    const rows = await manager.query<EvalRunRow[]>(
      `SELECT * FROM eval_runs WHERE workspace_id = $1 AND id = $2 FOR UPDATE`,
      [workspaceId, runId],
    );
    return rows[0] ?? null;
  }

  async listRuns(
    workspaceId: WorkspaceId,
    botId: string,
    datasetId: string | undefined,
    limit: number,
    cursor?: string,
  ) {
    const cursorId = cursor === undefined ? null : decodeCursor(cursor);
    if (cursorId !== null) {
      const exists = await this.ds.query<{ id: string }[]>(
        `SELECT id FROM eval_runs WHERE workspace_id = $1 AND bot_id = $2 AND id = $3`,
        [workspaceId, botId, cursorId],
      );
      if (exists[0] === undefined) throw new Error('Invalid eval run cursor.');
    }
    const rows = await this.ds.query<EvalRunRow[]>(
      `SELECT * FROM eval_runs WHERE workspace_id = $1 AND bot_id = $2
          AND ($3::uuid IS NULL OR dataset_id = $3)
          AND ($4::uuid IS NULL OR id < $4)
        ORDER BY id DESC LIMIT $5`,
      [workspaceId, botId, datasetId ?? null, cursorId, limit + 1],
    );
    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    return {
      data,
      nextCursor: hasMore ? encodeCursor(data.at(-1)?.id ?? '') : null,
    };
  }

  async startQueuedRun(workspaceId: WorkspaceId, runId: string, manager: EntityManager) {
    const result = await manager.query<EvalRunRow[] | [EvalRunRow[], number]>(
      `UPDATE eval_runs SET status = 'running', started_at = now()
        WHERE workspace_id = $1 AND id = $2 AND status = 'queued' RETURNING *`,
      [workspaceId, runId],
    );
    return rowsFromReturning(result)[0] ?? null;
  }

  async cancelRun(workspaceId: WorkspaceId, botId: string, runId: string, manager: EntityManager) {
    const result = await manager.query<EvalRunRow[] | [EvalRunRow[], number]>(
      `UPDATE eval_runs SET status = 'cancelled', finished_at = now()
        WHERE workspace_id = $1 AND bot_id = $2 AND id = $3 AND status IN ('queued', 'running')
        RETURNING *`,
      [workspaceId, botId, runId],
    );
    return rowsFromReturning(result)[0] ?? null;
  }

  async storeResult(
    workspaceId: WorkspaceId,
    runId: string,
    caseId: string | null,
    result: {
      traceId: string | null;
      decision: string;
      answer: string;
      citations: unknown[];
      retrieved: unknown[];
      metrics: Record<string, unknown>;
      passed: boolean;
      error: string | null;
      latencyMs: number | null;
      costUsd: string;
    },
    manager: EntityManager,
  ) {
    const rows = await manager.query<{ id: string }[]>(
      `INSERT INTO eval_results (workspace_id, run_id, case_id, trace_id, decision, answer,
          citations, retrieved, metrics, passed, error, latency_ms, cost_usd)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11, $12, $13)
       ON CONFLICT (run_id, case_id) DO NOTHING RETURNING id`,
      [
        workspaceId,
        runId,
        caseId,
        result.traceId,
        result.decision,
        result.answer,
        JSON.stringify(result.citations),
        JSON.stringify(result.retrieved),
        JSON.stringify(result.metrics),
        result.passed,
        result.error,
        result.latencyMs,
        result.costUsd,
      ],
    );
    return rows[0]?.id ?? null;
  }

  async allResults(workspaceId: WorkspaceId, runId: string, manager: EntityManager) {
    return manager.query<EvalResultDbRow[]>(
      `SELECT id, run_id, case_id, trace_id, decision, answer, citations, retrieved, metrics,
              passed, error, latency_ms, cost_usd, created_at
         FROM eval_results WHERE workspace_id = $1 AND run_id = $2 ORDER BY created_at, id`,
      [workspaceId, runId],
    );
  }

  async finishCase(
    workspaceId: WorkspaceId,
    runId: string,
    caseId: string | null,
    result: Parameters<RunsRepository['storeResult']>[3],
    manager: EntityManager,
  ): Promise<{
    completed: boolean;
    inserted: boolean;
    failed?: boolean;
    run?: EvalRunRow | null;
  }> {
    const run = await this.findRunForUpdate(workspaceId, runId, manager);
    if (run?.status !== 'running') return { completed: false, inserted: false };
    const insertedId = await this.storeResult(workspaceId, runId, caseId, result, manager);
    if (insertedId === null) return { completed: false, inserted: false };

    const resultRows = await this.allResults(workspaceId, runId, manager);
    const done = resultRows.length;
    const aggregateRows: EvalResultRow[] = resultRows.map((row) => ({
      passed: row.passed,
      metrics: row.metrics,
      latencyMs: row.latency_ms,
      costUsd: Number(row.cost_usd),
      error: row.error,
    }));
    const summary = summarize(aggregateRows);
    const completed = done >= run.cases_total;
    const update = await manager.query<EvalRunRow[] | [EvalRunRow[], number]>(
      `UPDATE eval_runs SET cases_done = $3, cost_usd = $4, summary = $5::jsonb,
          status = CASE WHEN $6 THEN 'completed'::eval_run_status ELSE status END,
          finished_at = CASE WHEN $6 THEN now() ELSE finished_at END
        WHERE workspace_id = $1 AND id = $2 RETURNING *`,
      [workspaceId, runId, done, summary.totalCostUsd, JSON.stringify(summary), completed],
    );
    return { completed, inserted: true, run: rowsFromReturning(update)[0] ?? null };
  }

  async failRun(workspaceId: WorkspaceId, runId: string, code: string, manager: EntityManager) {
    const result = await manager.query<EvalRunRow[] | [EvalRunRow[], number]>(
      `UPDATE eval_runs SET status = 'failed', error = $3, finished_at = now()
        WHERE workspace_id = $1 AND id = $2 AND status IN ('queued', 'running', 'completed') RETURNING *`,
      [workspaceId, runId, code],
    );
    return rowsFromReturning(result)[0] ?? null;
  }

  async listResults(workspaceId: WorkspaceId, runId: string, limit: number, cursor?: string) {
    const cursorId = cursor === undefined ? null : decodeCursor(cursor);
    const rows = await this.ds.query<EvalResultDbRow[]>(
      `SELECT id, run_id, case_id, trace_id, decision, answer, citations, retrieved, metrics,
              passed, error, latency_ms, cost_usd, created_at
         FROM eval_results WHERE workspace_id = $1 AND run_id = $2 AND ($3::uuid IS NULL OR id < $3)
        ORDER BY id DESC LIMIT $4`,
      [workspaceId, runId, cursorId, limit + 1],
    );
    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    return {
      data: data.map((row) => ({
        id: row.id,
        runId: row.run_id,
        caseId: row.case_id,
        traceId: row.trace_id,
        decision: row.decision,
        answer: row.answer,
        citations: row.citations,
        retrieved: row.retrieved,
        metrics: row.metrics,
        passed: row.passed,
        error: row.error,
        latencyMs: row.latency_ms,
        costUsd: Number(row.cost_usd),
        createdAt: new Date(row.created_at).toISOString(),
      })),
      nextCursor: hasMore ? encodeCursor(data.at(-1)?.id ?? '') : null,
    };
  }
}
