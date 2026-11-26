// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { EvalToolDefinition, StartEvalRunRequest } from '@app/shared';
import { evalGateSchema, startEvalRunSchema } from '@app/shared';

import { AppError } from '../../common/errors';
import { AUDIT_LOG, type AuditWriter } from '../../common/ports/audit';
import type { UserId, WorkspaceId } from '../../db/ids';
import { decodeCursor, encodeCursor } from '../../db/pagination';
import { JobsService } from '../../jobs';
import { BotsService } from '../bots';
import { CredentialsRepository } from '../credentials';
import { PromptsService } from '../prompts';
import { notifyWorkspace } from '../realtime';
import { ToolsService } from '../tools';
import { validateToolArguments } from '../tools';
import { DatasetsRepository } from './datasets.repository';
import { EVAL_RUN_JOB } from './eval.jobs';
import type { EvalRunConfig, EvalRunRow } from './runs.repository';
import { RunsRepository } from './runs.repository';

function runDto(row: EvalRunRow) {
  return {
    id: row.id,
    datasetId: row.dataset_id,
    status: row.status,
    casesTotal: row.cases_total,
    casesDone: row.cases_done,
    summary: row.summary,
    costUsd: Number(row.cost_usd),
    error: row.error,
    config: row.config,
    baselineRunId: row.baseline_run_id,
    createdAt: new Date(row.created_at).toISOString(),
    startedAt: row.started_at === null ? null : new Date(row.started_at).toISOString(),
    finishedAt: row.finished_at === null ? null : new Date(row.finished_at).toISOString(),
  };
}

@Injectable()
export class RunsService {
  constructor(
    private readonly ds: DataSource,
    private readonly runs: RunsRepository,
    private readonly datasets: DatasetsRepository,
    private readonly bots: BotsService,
    private readonly credentials: CredentialsRepository,
    private readonly prompts: PromptsService,
    private readonly tools: ToolsService,
    private readonly jobs: JobsService,
    @Inject(AUDIT_LOG) private readonly audit: AuditWriter,
  ) {}

  async start(workspaceId: WorkspaceId, botId: string, userId: UserId, input: StartEvalRunRequest) {
    const parsed = startEvalRunSchema.safeParse(input);
    if (!parsed.success) throw new AppError('validation_failed');
    const bot = await this.bots.get(workspaceId, botId);
    const dataset = await this.datasets.getDataset(workspaceId, botId, parsed.data.datasetId);
    if (dataset === null) throw new AppError('not_found');

    const [cases, chatCredential, judgeCredential, enabledTools] = await Promise.all([
      this.datasets.listCases(workspaceId, parsed.data.datasetId, 500),
      this.credentials.findById(workspaceId, parsed.data.chatCredentialId ?? bot.chatCredentialId),
      this.credentials.findById(workspaceId, parsed.data.judgeCredentialId),
      this.tools.enabledForBot(workspaceId, botId),
    ]);
    if (cases.data.length === 0) {
      throw new AppError('validation_failed', {
        details: [{ path: 'datasetId', message: 'Add at least one case before starting a run.' }],
      });
    }
    if (chatCredential === null || judgeCredential === null) throw new AppError('not_found');
    if (parsed.data.promptVersionId !== undefined) {
      await this.prompts.getForEval(workspaceId, botId, parsed.data.promptVersionId);
    }

    const config: EvalRunConfig = {
      promptVersionId: parsed.data.promptVersionId ?? bot.activePromptVersionId,
      chatCredentialId: parsed.data.chatCredentialId ?? bot.chatCredentialId,
      chatModel: parsed.data.chatModel ?? bot.chatModel,
      retrievalThreshold: parsed.data.retrievalThreshold ?? bot.retrievalThreshold,
      judgeCredentialId: parsed.data.judgeCredentialId,
      judgeModel: parsed.data.judgeModel,
      judgePromptVersion: 'eval-judge-v1',
      allowPartial: dataset.allow_partial,
      toolDefinitions: enabledTools.map((tool) => ({
        id: tool.id,
        version: tool.version,
        name: tool.name,
        description: tool.description,
        useWhen: tool.useWhen,
        neverUse: tool.neverUse,
        failureBehavior: tool.failureBehavior,
        inputs: tool.inputs,
        responseFields: tool.responseFields
          .filter((field) => field.visibleToVisitor)
          .map(({ name, path, description }) => ({ name, path, description })),
        maxCalls: tool.maxCalls,
      })),
    };
    const toolsByName = new Map(config.toolDefinitions.map((tool) => [tool.name, tool]));
    let fixtureBytes = 0;
    for (const testCase of cases.data) {
      for (const fixture of testCase.toolFixtures) {
        const tool = toolsByName.get(fixture.toolName);
        if (tool === undefined) throw new AppError('validation_failed');
        validateFixture(tool, fixture.arguments, fixture.result);
        fixtureBytes += JSON.stringify(fixture).length;
      }
    }
    if (fixtureBytes > 1_000_000) throw new AppError('validation_failed');
    const snapshots = cases.data.map((item) => ({
      id: item.id,
      question: item.question,
      history: item.history,
      expectedAnswer: item.expectedAnswer,
      expectedDocumentIds: item.expectedDocumentIds,
      mustInclude: item.mustInclude,
      mustNotInclude: item.mustNotInclude,
      expectHandoff: item.expectHandoff,
      needsExpectation: item.needsExpectation,
      toolFixtures: item.toolFixtures,
    }));

    return this.ds.transaction(async (manager) => {
      await this.runs.lockWorkspace(workspaceId, manager);
      const lockedBot = await this.runs.lockBot(workspaceId, botId, manager);
      if (lockedBot?.deleted_at !== null && lockedBot !== null) throw new AppError('not_found');
      if ((await this.runs.activeRunsForBot(workspaceId, botId, manager)) > 0) {
        throw new AppError('conflict', {
          message: 'This bot already has an active evaluation run.',
        });
      }
      if ((await this.runs.activeRunsForWorkspace(workspaceId, manager)) >= 3) {
        throw new AppError('conflict', {
          message: 'This workspace already has three active evaluation runs.',
        });
      }
      const baselineRunId = await this.runs.baselineFor(
        workspaceId,
        botId,
        parsed.data.datasetId,
        {
          promptVersionId: bot.activePromptVersionId,
          chatCredentialId: bot.chatCredentialId,
          chatModel: bot.chatModel,
          retrievalThreshold: bot.retrievalThreshold,
          toolDefinitions: config.toolDefinitions,
        },
        manager,
      );
      const row = await this.runs.createRun(
        workspaceId,
        botId,
        parsed.data.datasetId,
        userId,
        config,
        snapshots,
        baselineRunId,
        manager,
      );
      await this.jobs.enqueue(
        EVAL_RUN_JOB,
        { workspaceId, runId: row.id },
        {
          manager,
          singletonKey: row.id,
        },
      );
      await this.audit.record(
        {
          workspaceId,
          actorUserId: userId,
          action: 'eval.run_started',
          targetType: 'eval_run',
          targetId: row.id,
          metadata: { botId, datasetId: parsed.data.datasetId, casesTotal: snapshots.length },
        },
        manager,
      );
      await notifyWorkspace(manager, workspaceId, { type: 'eval.updated', runId: row.id });
      return runDto(row);
    });
  }

  async list(
    workspaceId: WorkspaceId,
    botId: string,
    query: { limit: number; cursor?: string; datasetId?: string },
  ) {
    await this.bots.get(workspaceId, botId);
    const page = await this.runs.listRuns(
      workspaceId,
      botId,
      query.datasetId,
      query.limit,
      query.cursor,
    );
    return { ...page, data: page.data.map(runDto) };
  }

  async get(workspaceId: WorkspaceId, botId: string, runId: string) {
    await this.bots.get(workspaceId, botId);
    const row = await this.runs.findRun(workspaceId, runId);
    if (row?.bot_id !== botId) throw new AppError('not_found');
    const baseline =
      row.baseline_run_id === null
        ? null
        : await this.runs.findRun(workspaceId, row.baseline_run_id);
    return { ...runDto(row), baselineSummary: baseline?.summary ?? null };
  }

  async results(
    workspaceId: WorkspaceId,
    botId: string,
    runId: string,
    query: { limit: number; cursor?: string; filter: 'all' | 'failed' | 'regressed' },
  ) {
    const run = await this.runs.findRun(workspaceId, runId);
    if (run?.bot_id !== botId) throw new AppError('not_found');
    if (query.filter !== 'regressed') {
      if (query.filter === 'all') {
        return this.runs.listResults(workspaceId, runId, query.limit, query.cursor);
      }
      const failed = (await this.runs.listResults(workspaceId, runId, 500)).data.filter(
        (result) => !result.passed,
      );
      const cursorId = query.cursor === undefined ? null : decodeCursor(query.cursor);
      const cursorIndex =
        cursorId === null ? -1 : failed.findIndex((result) => result.id === cursorId);
      if (cursorId !== null && cursorIndex < 0) throw new AppError('validation_failed');
      const remaining = failed.slice(cursorIndex + 1);
      const data = remaining.slice(0, query.limit);
      return {
        data,
        nextCursor: remaining.length > query.limit ? encodeCursor(data.at(-1)?.id ?? '') : null,
      };
    }
    const current = await this.runs.listResults(workspaceId, runId, 500);
    const baseline =
      run.baseline_run_id === null
        ? { data: [] as { caseId: string | null; passed: boolean }[] }
        : await this.runs.listResults(workspaceId, run.baseline_run_id, 500);
    const baselinePasses = new Map(
      baseline.data
        .filter((result) => result.caseId !== null)
        .flatMap((result) =>
          result.caseId === null ? [] : [[result.caseId, result.passed] as const],
        ),
    );
    const regressed = current.data.filter(
      (result) =>
        !result.passed && result.caseId !== null && baselinePasses.get(result.caseId) === true,
    );
    const cursorId = query.cursor === undefined ? null : decodeCursor(query.cursor);
    const cursorIndex =
      cursorId === null ? -1 : regressed.findIndex((result) => result.id === cursorId);
    if (cursorId !== null && cursorIndex < 0) throw new AppError('validation_failed');
    const remaining = regressed.slice(cursorIndex + 1);
    const data = remaining.slice(0, query.limit);
    return {
      data,
      nextCursor: remaining.length > query.limit ? encodeCursor(data.at(-1)?.id ?? '') : null,
    };
  }

  async cancel(workspaceId: WorkspaceId, botId: string, runId: string, userId: UserId) {
    await this.bots.get(workspaceId, botId);
    return this.ds.transaction(async (manager) => {
      const row = await this.runs.cancelRun(workspaceId, botId, runId, manager);
      if (row === null) {
        const existing = await this.runs.findRun(workspaceId, runId, manager);
        if (existing?.bot_id !== botId) throw new AppError('not_found');
        throw new AppError('conflict', {
          message: 'Only a queued or running evaluation can be cancelled.',
        });
      }
      await this.audit.record(
        {
          workspaceId,
          actorUserId: userId,
          action: 'eval.run_cancelled',
          targetType: 'eval_run',
          targetId: runId,
          metadata: { botId },
        },
        manager,
      );
      await notifyWorkspace(manager, workspaceId, { type: 'eval.updated', runId });
      return runDto(row);
    });
  }

  async setGate(workspaceId: WorkspaceId, botId: string, userId: UserId, input: unknown) {
    const parsed = evalGateSchema.safeParse(input);
    if (!parsed.success) {
      throw new AppError('validation_failed', {
        details: parsed.error.issues.map((issue) => ({
          path: issue.path.map(String).join('.'),
          message: issue.message,
        })),
      });
    }
    await this.bots.get(workspaceId, botId);
    if (parsed.data !== null) {
      const dataset = await this.datasets.getDataset(workspaceId, botId, parsed.data.datasetId);
      if (dataset === null) throw new AppError('not_found');
    }
    await this.ds.transaction(async (manager) => {
      await manager.query(
        `UPDATE bots SET eval_gate = $3::jsonb, updated_at = now()
          WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [workspaceId, botId, parsed.data === null ? null : JSON.stringify(parsed.data)],
      );
      await this.audit.record(
        {
          workspaceId,
          actorUserId: userId,
          action: 'eval.gate_updated',
          targetType: 'bot',
          targetId: botId,
          metadata: { gate: parsed.data },
        },
        manager,
      );
    });
    return parsed.data;
  }
}

function validateFixture(
  tool: EvalToolDefinition,
  arguments_: Record<string, unknown>,
  result: Record<string, unknown>,
): void {
  validateToolArguments(tool, arguments_);
  const resultFields = new Set(tool.responseFields.map((field) => field.name));
  for (const [name, value] of Object.entries(result)) {
    const scalar =
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value));
    if (!resultFields.has(name) || !scalar || (typeof value === 'string' && value.length > 1_000)) {
      throw new AppError('validation_failed');
    }
  }
}
