// SPDX-License-Identifier: MIT
import { z } from 'zod';

export const EVAL_RUN_STATUSES = ['queued', 'running', 'completed', 'failed', 'cancelled'] as const;
export type EvalRunStatus = (typeof EVAL_RUN_STATUSES)[number];

export const EVAL_CASE_ORIGINS = ['manual', 'correction', 'feedback', 'import'] as const;
export type EvalCaseOrigin = (typeof EVAL_CASE_ORIGINS)[number];

const evalHistoryMessageSchema = z.object({
  role: z.enum(['visitor', 'ai']),
  content: z.string().min(1).max(4_000),
});

const evalToolFixtureSchema = z.object({
  toolName: z.string().regex(/^[a-z][a-zA-Z0-9_]{0,39}$/),
  arguments: z.record(z.string(), z.unknown()),
  result: z.record(z.string(), z.unknown()),
});

export const evalToolDefinitionSchema = z.object({
  id: z.uuid(),
  version: z.number().int().positive(),
  name: z.string(),
  description: z.string(),
  useWhen: z.string(),
  neverUse: z.string(),
  failureBehavior: z.string(),
  inputs: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      type: z.enum(['string', 'number', 'boolean']),
      required: z.boolean(),
      enum: z.array(z.string()).optional(),
      maxLength: z.number().int().positive().optional(),
    }),
  ),
  responseFields: z.array(
    z.object({ name: z.string(), path: z.string(), description: z.string() }),
  ),
  maxCalls: z.number().int().min(1).max(3),
});

export const evalCaseInputSchema = z
  .object({
    question: z.string().trim().min(1).max(2_000),
    history: z.array(evalHistoryMessageSchema).max(20).default([]),
    expectedAnswer: z.string().trim().min(1).max(4_000).optional(),
    expectedDocumentIds: z.array(z.uuid()).max(10).default([]),
    mustInclude: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
    mustNotInclude: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
    expectHandoff: z.boolean().optional(),
    needsExpectation: z.boolean().default(false),
    toolFixtures: z.array(evalToolFixtureSchema).max(3).default([]),
    origin: z.enum(EVAL_CASE_ORIGINS).default('manual'),
    originRef: z.uuid().nullable().optional(),
  })
  .superRefine((value, ctx) => {
    const hasExpectation =
      value.expectedAnswer !== undefined ||
      value.expectedDocumentIds.length > 0 ||
      value.mustInclude.length > 0 ||
      value.mustNotInclude.length > 0 ||
      value.expectHandoff !== undefined;
    if (!hasExpectation && !value.needsExpectation) {
      ctx.addIssue({
        code: 'custom',
        path: ['needsExpectation'],
        message: 'Add at least one expectation or mark the case as needing an expectation.',
      });
    }
    if (JSON.stringify(value.toolFixtures).length > 32_000) {
      ctx.addIssue({
        code: 'custom',
        path: ['toolFixtures'],
        message: 'Tool fixtures must stay under 32 KB per case.',
      });
    }
  });

export const evalDatasetSchema = z.object({
  id: z.uuid(),
  botId: z.uuid(),
  name: z.string().min(1).max(100),
  description: z.string().max(2_000).nullable(),
  allowPartial: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const createEvalDatasetSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(2_000).optional(),
  allowPartial: z.boolean().default(false),
});

export const updateEvalDatasetSchema = createEvalDatasetSchema.partial();

export const updateEvalCaseSchema = z.object({
  question: z.string().trim().min(1).max(2_000).optional(),
  history: z.array(evalHistoryMessageSchema).max(20).optional(),
  expectedAnswer: z.string().trim().min(1).max(4_000).nullable().optional(),
  expectedDocumentIds: z.array(z.uuid()).max(10).optional(),
  mustInclude: z.array(z.string().trim().min(1).max(200)).max(10).optional(),
  mustNotInclude: z.array(z.string().trim().min(1).max(200)).max(10).optional(),
  expectHandoff: z.boolean().nullable().optional(),
  needsExpectation: z.boolean().optional(),
  toolFixtures: z.array(evalToolFixtureSchema).max(3).optional(),
});

export const startEvalRunSchema = z.object({
  datasetId: z.uuid(),
  promptVersionId: z.uuid().optional(),
  chatCredentialId: z.uuid().optional(),
  chatModel: z.string().trim().min(1).max(200).optional(),
  retrievalThreshold: z.number().min(0).max(1).optional(),
  judgeCredentialId: z.uuid(),
  judgeModel: z.string().trim().min(1).max(200),
});

export const evalGateSchema = z
  .object({
    datasetId: z.uuid(),
    minPassRate: z.number().min(0).max(1),
    maxRegression: z.number().min(0).max(1),
  })
  .nullable();

export const evalSummarySchema = z.object({
  casesTotal: z.number().int().nonnegative(),
  casesPassed: z.number().int().nonnegative(),
  casesFailed: z.number().int().nonnegative(),
  passRate: z.number().min(0).max(1),
  hitAtK: z.number().min(0).max(1).nullable(),
  mrr: z.number().min(0).max(1).nullable(),
  citationAccuracy: z.number().min(0).max(1).nullable(),
  mustIncludeRate: z.number().min(0).max(1).nullable(),
  mustNotIncludeRate: z.number().min(0).max(1).nullable(),
  escalationAccuracy: z.number().min(0).max(1).nullable(),
  judgeScore: z.number().min(0).max(1).nullable(),
  totalCostUsd: z.number().nonnegative(),
  p50LatencyMs: z.number().nonnegative().nullable(),
  p95LatencyMs: z.number().nonnegative().nullable(),
});

export const evalJudgeOutputSchema = z.object({
  verdict: z.enum(['correct', 'partially_correct', 'incorrect']),
  score: z.number().min(0).max(1),
  rationale: z.string().max(400),
  unsupportedClaims: z.array(z.string().max(400)).max(5),
});

export const evalRunDto = z.object({
  id: z.uuid(),
  datasetId: z.uuid(),
  status: z.enum(EVAL_RUN_STATUSES),
  casesTotal: z.number().int().nonnegative(),
  casesDone: z.number().int().nonnegative(),
  summary: evalSummarySchema.nullable(),
  costUsd: z.number().nonnegative(),
  error: z.string().nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});

export const evalResultDto = z.object({
  id: z.uuid(),
  runId: z.uuid(),
  caseId: z.uuid().nullable(),
  traceId: z.uuid().nullable(),
  decision: z.enum(['answered', 'escalated', 'refused', 'error']),
  answer: z.string(),
  citations: z.array(z.unknown()),
  retrieved: z.array(z.unknown()),
  metrics: z.record(z.string(), z.unknown()),
  passed: z.boolean(),
  error: z.string().nullable(),
  latencyMs: z.number().int().nullable(),
  costUsd: z.number().nonnegative(),
  createdAt: z.string(),
});

export const evalDatasetExportSchema = z.object({
  format: z.literal('ailoom-eval-dataset'),
  version: z.literal(1),
  cases: z.array(evalCaseInputSchema).max(500),
});

export type EvalCaseInput = z.infer<typeof evalCaseInputSchema>;
export type EvalToolFixture = z.infer<typeof evalToolFixtureSchema>;
export type EvalToolDefinition = z.infer<typeof evalToolDefinitionSchema>;
export type EvalDatasetDto = z.infer<typeof evalDatasetSchema>;
export type CreateEvalDatasetRequest = z.infer<typeof createEvalDatasetSchema>;
export type UpdateEvalDatasetRequest = z.infer<typeof updateEvalDatasetSchema>;
export type UpdateEvalCaseRequest = z.infer<typeof updateEvalCaseSchema>;
export type StartEvalRunRequest = z.infer<typeof startEvalRunSchema>;
export type EvalGate = z.infer<typeof evalGateSchema>;
export type EvalSummary = z.infer<typeof evalSummarySchema>;
export type EvalJudgeOutput = z.infer<typeof evalJudgeOutputSchema>;
export type EvalRunDto = z.infer<typeof evalRunDto>;
export type EvalResultDto = z.infer<typeof evalResultDto>;
export type EvalDatasetExport = z.infer<typeof evalDatasetExportSchema>;
