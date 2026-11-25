// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { api } from '@/lib/api-client';
import {
  evalDatasetSchema,
  evalResultDto,
  evalRunDto,
  evalSummarySchema,
  type EvalCaseInput,
  type EvalGate,
  type StartEvalRunRequest,
} from '@app/shared';

const root = (workspaceId: string, botId: string) =>
  ['workspaces', workspaceId, 'bots', botId, 'eval'] as const;
const path = (workspaceId: string, botId: string) =>
  `/v1/workspaces/${workspaceId}/bots/${botId}/eval`;
const pageSchema = <T extends z.ZodType>(item: T) =>
  z.object({ data: z.array(item), nextCursor: z.string().nullable() });
const datasetSchema = evalDatasetSchema.extend({ caseCount: z.number().optional() });
const evalCaseDtoSchema = z.object({
  id: z.string(),
  datasetId: z.string(),
  question: z.string(),
  history: z.array(z.object({ role: z.enum(['visitor', 'ai']), content: z.string() })),
  expectedAnswer: z.string().nullable(),
  expectedDocumentIds: z.array(z.string()),
  mustInclude: z.array(z.string()),
  mustNotInclude: z.array(z.string()),
  expectHandoff: z.boolean().nullable(),
  needsExpectation: z.boolean(),
  origin: z.enum(['manual', 'correction', 'feedback', 'import']),
  originRef: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const evalCasePageSchema = pageSchema(evalCaseDtoSchema);
type EvalCasePage = z.infer<typeof evalCasePageSchema>;
const runSchema = evalRunDto.extend({
  config: z.record(z.string(), z.unknown()).optional(),
  baselineRunId: z.string().nullable().optional(),
  baselineSummary: evalSummarySchema.nullable().optional(),
});

export function useEvalDatasets(workspaceId: string, botId: string, enabled = true) {
  return useQuery({
    queryKey: [...root(workspaceId, botId), 'datasets'],
    enabled,
    queryFn: () => api(`${path(workspaceId, botId)}/datasets`, { schema: z.array(datasetSchema) }),
  });
}

export function useEvalCases(workspaceId: string, botId: string, datasetId: string) {
  return useQuery({
    queryKey: [...root(workspaceId, botId), 'datasets', datasetId, 'cases'],
    enabled: datasetId !== '',
    queryFn: () =>
      api(`${path(workspaceId, botId)}/datasets/${datasetId}/cases?limit=100`, {
        schema: evalCasePageSchema,
      }),
  });
}

export function useEvalRuns(workspaceId: string, botId: string, datasetId: string) {
  return useQuery({
    queryKey: [...root(workspaceId, botId), 'runs', datasetId],
    enabled: datasetId !== '',
    refetchInterval: 2500,
    queryFn: () =>
      api(`${path(workspaceId, botId)}/runs?datasetId=${datasetId}&limit=30`, {
        schema: pageSchema(runSchema),
      }),
  });
}

export function useEvalResults(
  workspaceId: string,
  botId: string,
  runId: string,
  filter: 'all' | 'failed' | 'regressed' = 'all',
) {
  return useQuery({
    queryKey: [...root(workspaceId, botId), 'runs', runId, 'results'],
    enabled: runId !== '',
    refetchInterval: 2500,
    queryFn: () =>
      api(`${path(workspaceId, botId)}/runs/${runId}/results?filter=${filter}&limit=100`, {
        schema: pageSchema(evalResultDto),
      }),
  });
}

export function useEvalRun(workspaceId: string, botId: string, runId: string) {
  return useQuery({
    queryKey: [...root(workspaceId, botId), 'runs', runId],
    enabled: runId !== '',
    queryFn: () => api(`${path(workspaceId, botId)}/runs/${runId}`, { schema: runSchema }),
  });
}

export function useCreateEvalDataset(workspaceId: string, botId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string }) =>
      api(`${path(workspaceId, botId)}/datasets`, {
        method: 'POST',
        body: { ...input, allowPartial: false },
        schema: datasetSchema,
      }),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: [...root(workspaceId, botId), 'datasets'] }),
  });
}

export function useCreateEvalCase(workspaceId: string, botId: string, datasetId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: EvalCaseInput) =>
      api(`${path(workspaceId, botId)}/datasets/${datasetId}/cases`, {
        method: 'POST',
        body: input,
        schema: z.object({ data: z.array(evalCaseDtoSchema) }),
      }),
    onSuccess: ({ data: created }) => {
      const queryKey = [...root(workspaceId, botId), 'datasets', datasetId, 'cases'];
      client.setQueryData<EvalCasePage>(queryKey, (current) => ({
        data: [...(current?.data ?? []), ...created],
        nextCursor: current?.nextCursor ?? null,
      }));
      void client.invalidateQueries({ queryKey: [...root(workspaceId, botId), 'datasets'] });
    },
  });
}

export function useStartEvalRun(workspaceId: string, botId: string, datasetId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<StartEvalRunRequest, 'datasetId'>) =>
      api(`${path(workspaceId, botId)}/runs`, {
        method: 'POST',
        body: { ...input, datasetId },
        schema: runSchema,
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: [...root(workspaceId, botId), 'runs'] }),
  });
}

export function useSetEvalGate(workspaceId: string, botId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (gate: EvalGate | null) =>
      api(`${path(workspaceId, botId)}/gate`, { method: 'PUT', body: gate, schema: z.unknown() }),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ['workspaces', workspaceId, 'bots', botId] }),
  });
}
