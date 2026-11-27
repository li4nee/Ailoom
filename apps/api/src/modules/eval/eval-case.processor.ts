// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import Big from 'big.js';
import { DataSource } from 'typeorm';

import { asCredentialId, asWorkspaceId } from '../../db/ids';
import { JobProcessor, type JobContext, type JobHandler } from '../../jobs';
import { Llm } from '../../providers';
import { BotsRepository } from '../bots';
import { ChatOrchestrator, CollectingAnswerSink } from '../chat';
import { CredentialsRepository } from '../credentials';
import { notifyWorkspace } from '../realtime';
import { PricingService, UsageRepository, utcDay } from '../usage';
import { EVAL_CASE_JOB, type EvalCasePayload } from './eval.jobs';
import { judgeAnswer } from './judge';
import { casePassed, citationAccuracy, hitAtK, phraseCheck, reciprocalRank } from './metrics';
import { RunsRepository } from './runs.repository';

interface TraceRetrieval {
  chunk_id: string;
  rank: number;
  used: boolean;
  score: number;
  vector_rank?: number | null;
  keyword_rank?: number | null;
  fusion_score?: number;
}

@Injectable()
@JobProcessor(EVAL_CASE_JOB)
export class EvalCaseProcessor implements JobHandler<EvalCasePayload> {
  constructor(
    private readonly ds: DataSource,
    private readonly runs: RunsRepository,
    private readonly bots: BotsRepository,
    private readonly orchestrator: ChatOrchestrator,
    private readonly credentials: CredentialsRepository,
    private readonly pricing: PricingService,
    private readonly usage: UsageRepository,
    private readonly llm: Llm,
  ) {}

  async handle(payload: EvalCasePayload, context: JobContext): Promise<void> {
    const workspaceId = asWorkspaceId(payload.workspaceId);
    const run = await this.runs.findRun(workspaceId, payload.runId);
    if (run?.status !== 'running') return;
    const bot = await this.bots.findById(workspaceId, run.bot_id);
    if (bot?.deletedAt !== null && bot !== null) {
      await this.failRun(workspaceId, payload.runId, 'bot_unavailable');
      return;
    }
    const testCase = run.cases_snapshot[payload.caseIndex];
    if (testCase === undefined) return;

    if (testCase.needsExpectation) {
      await this.ds.transaction(async (manager) => {
        const updated = await this.runs.finishCase(
          workspaceId,
          run.id,
          testCase.id,
          {
            traceId: null,
            decision: 'error',
            answer: '',
            citations: [],
            retrieved: [],
            metrics: {
              hitAtK: null,
              mrr: null,
              retrievalLatencyMs: null,
              queryEmbeddingCostUsd: null,
              citationAccuracy: null,
              mustInclude: null,
              mustNotInclude: null,
              escalationCorrect: null,
              judge: null,
            },
            passed: false,
            error: 'needs_expectation',
            latencyMs: null,
            costUsd: '0',
          },
          manager,
        );
        if (updated.inserted) {
          await notifyWorkspace(manager, workspaceId, { type: 'eval.updated', runId: run.id });
        }
      });
      return;
    }

    try {
      const sink = new CollectingAnswerSink();
      await this.orchestrator.handle(
        {
          workspaceId,
          botId: run.bot_id,
          mode: {
            kind: 'eval',
            runId: run.id,
            caseId: testCase.id,
            history: testCase.history,
            content: testCase.question,
            overrides: {
              promptVersionId: run.config.promptVersionId,
              chatCredentialId: run.config.chatCredentialId,
              chatModel: run.config.chatModel,
              retrievalThreshold: run.config.retrievalThreshold,
              retrievalMode: (run.config as Partial<typeof run.config>).retrievalMode ?? 'vector',
              rerankingEnabled: run.config.rerankingEnabled,
              toolDefinitions: run.config.toolDefinitions.filter((tool) =>
                testCase.toolFixtures.some((fixture) => fixture.toolName === tool.name),
              ),
              toolFixtures: testCase.toolFixtures,
            },
          },
          signal: context.signal,
        },
        sink,
      );
      const collected = sink.result();
      const trace = collected.trace;
      const retrieval = trace === null ? [] : await this.traceRetrieval(workspaceId, trace.traceId);
      const retrievalStats =
        trace === null ? null : await this.traceRetrievalStats(workspaceId, trace.traceId);
      const toolCalls =
        trace === null ? [] : await this.runs.toolCallsForTrace(workspaceId, trace.traceId);
      const toolFixtures = testCase.toolFixtures;
      const toolFixturesPassed =
        toolFixtures.length === 0 ||
        (toolCalls.length === toolFixtures.length &&
          toolCalls.every((call) => call.status === 'complete'));
      const expected = testCase.expectedDocumentIds;
      const usedDocumentIds = retrieval.filter((item) => item.used).map((item) => item.documentId);
      const retrievedDocumentIds = retrieval.map((item) => item.documentId);
      const staleExpectation = await this.hasDeletedExpectation(workspaceId, expected);
      const metrics = {
        retrievalLatencyMs: retrievalStats?.retrieval_ms ?? null,
        queryEmbeddingCostUsd:
          retrievalStats?.retrieval_cost_usd === null ||
          retrievalStats?.retrieval_cost_usd === undefined
            ? null
            : Number(retrievalStats.retrieval_cost_usd),
        hitAtK: expected.length === 0 ? null : hitAtK(usedDocumentIds, expected),
        mrr: expected.length === 0 ? null : reciprocalRank(retrievedDocumentIds, expected),
        citationAccuracy:
          expected.length === 0
            ? null
            : citationAccuracy(
                collected.citations.map((citation) => citation.documentId),
                expected,
              ),
        mustInclude:
          testCase.mustInclude.length === 0
            ? null
            : phraseCheck(collected.content, testCase.mustInclude, 'include'),
        mustNotInclude:
          testCase.mustNotInclude.length === 0
            ? null
            : phraseCheck(collected.content, testCase.mustNotInclude, 'exclude'),
        escalationCorrect:
          testCase.expectHandoff === null
            ? null
            : (collected.escalated !== null) === testCase.expectHandoff,
        judge: null as
          | null
          | {
              verdict: 'correct' | 'partially_correct' | 'incorrect';
              score: number;
              rationale: string;
              unsupportedClaims: string[];
            }
          | { error: 'judge_error' },
      };
      let judgeCostUsd = '0';
      let judgeInputTokens = 0;
      let judgeOutputTokens = 0;
      if (testCase.expectedAnswer !== null) {
        const judgeCredential = await this.credentials.findById(
          workspaceId,
          run.config.judgeCredentialId,
        );
        const judge =
          judgeCredential === null
            ? { error: 'judge_error' as const, inputTokens: 0, outputTokens: 0 }
            : await judgeAnswer(
                this.llm,
                {
                  workspaceId,
                  credentialId: asCredentialId(judgeCredential.id),
                  provider: judgeCredential.provider,
                  model: run.config.judgeModel,
                },
                {
                  question: testCase.question,
                  expectedAnswer: testCase.expectedAnswer,
                  answer: collected.content,
                  sources: retrieval
                    .filter((item) => item.used)
                    .map((item) => ({ title: item.title, content: item.content })),
                },
                context.signal,
              );
        judgeInputTokens = judge.inputTokens;
        judgeOutputTokens = judge.outputTokens;
        if ('error' in judge) {
          metrics.judge = { error: 'judge_error' };
        } else {
          metrics.judge = {
            verdict: judge.verdict,
            score: judge.score,
            rationale: judge.rationale,
            unsupportedClaims: judge.unsupportedClaims,
          };
        }
        const cost = await this.pricing.cost(workspaceId, {
          chat: {
            provider: judgeCredential?.provider ?? 'local',
            model: run.config.judgeModel,
            inputTokens: judge.inputTokens,
            outputTokens: judge.outputTokens,
          },
        });
        judgeCostUsd = cost.costUsd;
      }
      const resultError = staleExpectation
        ? 'stale_expectation'
        : !toolFixturesPassed
          ? 'tool_fixture_mismatch'
          : metrics.judge !== null && 'error' in metrics.judge
            ? 'judge_error'
            : (collected.error?.code ?? null);
      const evalConfig = run.config as Partial<typeof run.config>;
      const knowledgeVersionFingerprint = evalConfig.knowledgeVersionFingerprint;
      const knowledgeUnchanged =
        knowledgeVersionFingerprint === undefined ||
        (await this.knowledgeVersionFingerprint(workspaceId, run.bot_id)) ===
          knowledgeVersionFingerprint;
      const currentBot = await this.bots.findById(workspaceId, run.bot_id);
      const embeddingConfigUnchanged =
        evalConfig.embeddingModel === undefined ||
        (currentBot !== null &&
          currentBot.embeddingCredentialId === evalConfig.embeddingCredentialId &&
          currentBot.embeddingModel === evalConfig.embeddingModel &&
          currentBot.embeddingDim === evalConfig.embeddingDim);
      const evaluationInputsUnchanged = knowledgeUnchanged && embeddingConfigUnchanged;
      const finalError = !knowledgeUnchanged
        ? 'knowledge_changed_during_eval'
        : !embeddingConfigUnchanged
          ? 'embedding_config_changed_during_eval'
          : resultError;
      const totalCost = new Big(trace?.costUsd ?? '0').plus(judgeCostUsd).toFixed(6);
      const result = {
        traceId: trace?.traceId ?? null,
        decision: trace?.decision ?? 'error',
        answer: collected.content,
        citations: collected.citations,
        retrieved: retrieval,
        metrics,
        passed:
          evaluationInputsUnchanged &&
          toolFixturesPassed &&
          casePassed(metrics, run.config.allowPartial),
        error: finalError,
        latencyMs: trace?.latencyMs ?? null,
        costUsd: totalCost,
      };

      const caseStillExists = await this.ds.query<{ id: string }[]>(
        `SELECT id FROM eval_cases WHERE workspace_id = $1 AND dataset_id = $2 AND id = $3`,
        [workspaceId, run.dataset_id, testCase.id],
      );
      const stored = await this.ds.transaction(async (manager) => {
        const updated = await this.runs.finishCase(
          workspaceId,
          run.id,
          caseStillExists[0] === undefined ? null : testCase.id,
          result,
          manager,
        );
        if (updated.inserted && collected.escalated?.reason === 'spend_cap_reached') {
          await this.runs.failRun(workspaceId, run.id, 'spend_cap_reached', manager);
          updated.completed = false;
          updated.failed = true;
        }
        if (updated.inserted) {
          if (judgeInputTokens > 0 || judgeOutputTokens > 0 || judgeCostUsd !== '0') {
            await this.usage.increment(
              manager,
              { workspaceId, botId: run.bot_id, day: utcDay(new Date()) },
              {
                inputTokens: judgeInputTokens,
                outputTokens: judgeOutputTokens,
                costUsd: judgeCostUsd,
              },
            );
          }
          await notifyWorkspace(manager, workspaceId, { type: 'eval.updated', runId: run.id });
        }
        return updated;
      });
      if (stored.failed) return;
    } catch {
      if (context.signal.aborted) return;
      await this.failRun(workspaceId, run.id, 'case_failed');
    }
  }

  private async traceRetrieval(workspaceId: ReturnType<typeof asWorkspaceId>, traceId: string) {
    const rows = await this.ds.query<{ retrieval: TraceRetrieval[] }[]>(
      `SELECT retrieval FROM generation_traces WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, traceId],
    );
    const traceEntries = rows[0]?.retrieval ?? [];
    if (traceEntries.length === 0) return [];
    const chunks = await this.ds.query<
      { id: string; document_id: string; title: string | null; content: string }[]
    >(
      `SELECT c.id, dv.document_id, d.title, c.content FROM chunks c
         JOIN document_versions dv ON dv.id = c.document_version_id
         JOIN documents d ON d.id = dv.document_id
        WHERE c.workspace_id = $1 AND c.id = ANY($2::uuid[])`,
      [workspaceId, traceEntries.map((item) => item.chunk_id)],
    );
    const documentByChunk = new Map(chunks.map((row) => [row.id, row]));
    return traceEntries.flatMap((item) => {
      const chunk = documentByChunk.get(item.chunk_id);
      return chunk === undefined
        ? []
        : [
            {
              chunkId: item.chunk_id,
              rank: item.rank,
              used: item.used,
              score: item.score,
              ...(item.vector_rank === undefined ? {} : { vectorRank: item.vector_rank }),
              ...(item.keyword_rank === undefined ? {} : { keywordRank: item.keyword_rank }),
              ...(item.fusion_score === undefined ? {} : { fusionScore: item.fusion_score }),
              documentId: chunk.document_id,
              title: chunk.title ?? '',
              content: chunk.content,
            },
          ];
    });
  }

  private async traceRetrievalStats(
    workspaceId: ReturnType<typeof asWorkspaceId>,
    traceId: string,
  ) {
    const rows = await this.ds.query<
      { retrieval_ms: number | null; retrieval_cost_usd: string | null }[]
    >(
      `SELECT retrieval_ms, retrieval_cost_usd FROM generation_traces
        WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, traceId],
    );
    return rows[0] ?? null;
  }

  private async knowledgeVersionFingerprint(
    workspaceId: ReturnType<typeof asWorkspaceId>,
    botId: string,
  ) {
    const rows = await this.ds.query<{ fingerprint: string }[]>(
      `SELECT md5(COALESCE(string_agg(d.id::text || ':' || d.current_version_id::text, ',' ORDER BY d.id), '')) AS fingerprint
         FROM documents d
        WHERE d.workspace_id = $1 AND d.bot_id = $2 AND d.current_version_id IS NOT NULL`,
      [workspaceId, botId],
    );
    return rows[0]?.fingerprint ?? '';
  }

  private async hasDeletedExpectation(
    workspaceId: ReturnType<typeof asWorkspaceId>,
    ids: string[],
  ) {
    if (ids.length === 0) return false;
    const rows = await this.ds.query<{ count: number }[]>(
      `SELECT count(*)::int AS count FROM documents WHERE workspace_id = $1 AND id = ANY($2::uuid[])`,
      [workspaceId, ids],
    );
    return (rows[0]?.count ?? 0) < ids.length;
  }

  private async failRun(
    workspaceId: ReturnType<typeof asWorkspaceId>,
    runId: string,
    reason: string,
  ) {
    await this.ds.transaction(async (manager) => {
      const failed = await this.runs.failRun(workspaceId, runId, reason, manager);
      if (failed !== null) {
        await notifyWorkspace(manager, workspaceId, { type: 'eval.updated', runId });
      }
    });
  }
}
