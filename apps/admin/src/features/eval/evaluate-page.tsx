// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';

import { FormAlert } from '@/components/form-alert';
import { hasRole, useWorkspaceRole } from '@/components/role-gate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useBot, usePromptVersions } from '@/features/bots/api';
import { useCredentials } from '@/features/credentials/api';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';
import { evalCaseInputSchema } from '@app/shared';

import {
  useCreateEvalCase,
  useCreateEvalDataset,
  useEvalCases,
  useEvalDatasets,
  useEvalResults,
  useEvalRun,
  useEvalRuns,
  useSetEvalGate,
  useStartEvalRun,
} from './api';

export function EvaluatePage({
  workspaceId,
  botId,
  selection,
}: {
  workspaceId: string;
  botId: string;
  selection?: {
    datasetId?: string | undefined;
    promptVersionId?: string | undefined;
    runId?: string | undefined;
  };
}) {
  const role = useWorkspaceRole();
  const canEdit = hasRole(role, 'admin');
  const bot = useBot(workspaceId, botId);
  const promptVersions = usePromptVersions(workspaceId, botId, canEdit);
  const credentials = useCredentials(workspaceId, canEdit);
  const datasets = useEvalDatasets(workspaceId, botId);
  const [datasetId, setDatasetId] = useState(selection?.datasetId ?? '');
  const [runId, setRunId] = useState(selection?.runId ?? '');
  const [promptVersionId, setPromptVersionId] = useState(selection?.promptVersionId ?? '');
  const [resultFilter, setResultFilter] = useState<'all' | 'failed' | 'changed' | 'regressed'>(
    'all',
  );
  const [datasetName, setDatasetName] = useState('');
  const [question, setQuestion] = useState('');
  const [expectedAnswer, setExpectedAnswer] = useState('');
  const [toolFixturesText, setToolFixturesText] = useState('[]');
  const [judgeCredentialId, setJudgeCredentialId] = useState('');
  const [judgeModel, setJudgeModel] = useState('');
  const [retrievalMode, setRetrievalMode] = useState<'vector' | 'hybrid' | null>(null);
  const [baselineRunId, setBaselineRunId] = useState('');
  const [minPassRate, setMinPassRate] = useState('0.8');
  const [maxRegression, setMaxRegression] = useState('0.1');
  const [pageError, setPageError] = useState<string | null>(null);

  const selectedDataset = datasetId !== '' ? datasetId : (datasets.data?.[0]?.id ?? '');
  const cases = useEvalCases(workspaceId, botId, selectedDataset);
  const runs = useEvalRuns(workspaceId, botId, selectedDataset);
  const results = useEvalResults(workspaceId, botId, runId, resultFilter);
  const selectedRun = useEvalRun(workspaceId, botId, runId);
  const createDataset = useCreateEvalDataset(workspaceId, botId);
  const createCase = useCreateEvalCase(workspaceId, botId, selectedDataset);
  const startRun = useStartEvalRun(workspaceId, botId, selectedDataset);
  const setGate = useSetEvalGate(workspaceId, botId);

  if (bot.isPending || datasets.isPending) return <Skeleton className="h-40 w-full" />;
  if (bot.isError) return <FormAlert message={errorMessage(bot.error)} />;
  if (datasets.isError) return <FormAlert message={errorMessage(datasets.error)} />;
  const botData = bot.data;
  const credentialRows = credentials.data ?? [];
  const selectedPrompt = (promptVersions.data ?? []).find(
    (version) => version.id === promptVersionId,
  );
  const runPrompt = (promptVersions.data ?? []).find(
    (version) => version.id === selectedRun.data?.config?.['promptVersionId'],
  );
  const effectiveRetrievalMode = retrievalMode ?? botData.retrievalMode;
  const expectedPromptVersionId = promptVersionId || botData.activePromptVersionId;
  const expectedJudgeCredentialId = judgeCredentialId || botData.chatCredentialId;
  const expectedJudgeModel = judgeModel || botData.chatModel;
  const comparisonCandidates = (runs.data?.data ?? []).filter((run) => {
    const config = run.config ?? {};
    return (
      run.status === 'completed' &&
      config['retrievalMode'] !== effectiveRetrievalMode &&
      config['comparisonOnly'] !== true &&
      run.summary?.inconclusive !== true &&
      config['promptVersionId'] === expectedPromptVersionId &&
      config['chatCredentialId'] === botData.chatCredentialId &&
      config['chatModel'] === botData.chatModel &&
      config['retrievalThreshold'] === botData.retrievalThreshold &&
      config['judgeCredentialId'] === expectedJudgeCredentialId &&
      config['judgeModel'] === expectedJudgeModel &&
      config['embeddingCredentialId'] === botData.embeddingCredentialId &&
      config['embeddingModel'] === botData.embeddingModel &&
      config['embeddingDim'] === botData.embeddingDim
    );
  });

  return (
    <div className="max-w-5xl space-y-6">
      <header className="space-y-1">
        <h2 className="text-xl font-semibold">Evaluation</h2>
        <p className="text-sm text-muted-foreground">
          Run repeatable checks against this bot’s answers, retrieval and prompt versions. Runs use
          the configured model providers and count toward bot spend.
        </p>
      </header>
      {pageError ? <FormAlert message={pageError} /> : null}

      <section className="space-y-3 rounded-lg border p-4">
        <h3 className="font-medium">Datasets and cases</h3>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="sr-only" htmlFor="eval-dataset">
            Dataset
          </label>
          <select
            id="eval-dataset"
            className="min-h-10 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm"
            value={selectedDataset}
            onChange={(event) => {
              setDatasetId(event.target.value);
              setRunId('');
            }}
          >
            <option value="">Choose a dataset</option>
            {datasets.data.map((dataset) => (
              <option key={dataset.id} value={dataset.id}>
                {dataset.name} ({dataset.caseCount ?? '—'} cases)
              </option>
            ))}
          </select>
          {canEdit ? (
            <form
              className="flex min-w-0 gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (!datasetName.trim()) return;
                createDataset.mutate(
                  { name: datasetName.trim() },
                  {
                    onSuccess: (created) => {
                      setDatasetId(created.id);
                      setDatasetName('');
                      setRunId('');
                    },
                  },
                );
              }}
            >
              <Input
                aria-label="New dataset name"
                placeholder="New dataset name"
                value={datasetName}
                onChange={(event) => {
                  setDatasetName(event.target.value);
                }}
              />
              <Button type="submit" disabled={createDataset.isPending || !datasetName.trim()}>
                Create
              </Button>
            </form>
          ) : null}
        </div>
        {!selectedDataset ? (
          <p className="text-sm text-muted-foreground">
            Create a dataset to start collecting test questions.
          </p>
        ) : (
          <>
            {cases.isPending ? (
              <Skeleton className="h-16 w-full" />
            ) : cases.isError ? (
              <FormAlert message={errorMessage(cases.error)} />
            ) : (
              <ul className="divide-y rounded-md border">
                {cases.data.data.length === 0 ? (
                  <li className="p-3 text-sm text-muted-foreground">
                    No cases yet. Add at least one question and expectation before running the
                    dataset.
                  </li>
                ) : (
                  cases.data.data.map((item) => (
                    <li key={item.id} className="grid gap-1 p-3 text-sm sm:grid-cols-[1fr_auto]">
                      <span className="font-medium">{item.question}</span>
                      <span className="text-muted-foreground">
                        {item.expectedAnswer
                          ? 'Answer expected'
                          : item.needsExpectation
                            ? 'Needs expectation'
                            : 'Other checks'}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {strings.eval.caseToolFixtures(item.toolFixtures.length)}
                      </span>
                    </li>
                  ))
                )}
              </ul>
            )}
            {canEdit ? (
              <form
                className="grid gap-3 rounded-md bg-muted/40 p-3 sm:grid-cols-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  setPageError(null);
                  const answer = expectedAnswer.trim();
                  let toolFixtures: ReturnType<typeof evalCaseInputSchema.shape.toolFixtures.parse>;
                  try {
                    toolFixtures = evalCaseInputSchema.shape.toolFixtures.parse(
                      JSON.parse(toolFixturesText) as unknown,
                    );
                  } catch {
                    setPageError(strings.eval.invalidToolFixtures);
                    return;
                  }
                  if (!question.trim() || !answer) {
                    setPageError('Enter a question and an expected answer.');
                    return;
                  }
                  createCase.mutate(
                    {
                      question: question.trim(),
                      expectedAnswer: answer,
                      expectedDocumentIds: [],
                      history: [],
                      mustInclude: [],
                      mustNotInclude: [],
                      needsExpectation: false,
                      toolFixtures,
                      origin: 'manual',
                    },
                    {
                      onSuccess: () => {
                        setQuestion('');
                        setExpectedAnswer('');
                        setToolFixturesText('[]');
                      },
                      onError: (error: unknown) => {
                        setPageError(errorMessage(error));
                      },
                    },
                  );
                }}
              >
                <div className="space-y-1">
                  <Label htmlFor="eval-question">Question</Label>
                  <Input
                    id="eval-question"
                    value={question}
                    onChange={(event) => {
                      setQuestion(event.target.value);
                    }}
                    maxLength={2000}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="eval-expected-answer">Expected answer</Label>
                  <Input
                    id="eval-expected-answer"
                    value={expectedAnswer}
                    onChange={(event) => {
                      setExpectedAnswer(event.target.value);
                    }}
                    maxLength={4000}
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="eval-tool-fixtures">{strings.eval.toolFixtures}</Label>
                  <p className="mb-1 text-xs text-muted-foreground">
                    {strings.eval.toolFixturesHelp}
                  </p>
                  <textarea
                    id="eval-tool-fixtures"
                    className="min-h-24 w-full rounded-md border bg-background p-2 font-mono text-xs"
                    value={toolFixturesText}
                    onChange={(event) => {
                      setToolFixturesText(event.target.value);
                    }}
                    disabled={!canEdit}
                  />
                </div>
                <div className="sm:col-span-2">
                  <Button type="submit" disabled={createCase.isPending}>
                    Add case
                  </Button>
                </div>
              </form>
            ) : null}
          </>
        )}
      </section>

      {selectedDataset ? (
        <section className="space-y-3 rounded-lg border p-4">
          <h3 className="font-medium">Run evaluation</h3>
          <p className="text-sm text-muted-foreground">
            The judge grades against each case’s expected answer. Choose a credential and model that
            support chat completion.
          </p>
          {canEdit ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="eval-prompt-version">Prompt version</Label>
                <select
                  id="eval-prompt-version"
                  className="min-h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={promptVersionId}
                  onChange={(event) => {
                    setPromptVersionId(event.target.value);
                  }}
                >
                  <option value="">Current active prompt</option>
                  {promptVersionId !== '' && selectedPrompt === undefined ? (
                    <option value={promptVersionId} disabled>
                      Selected prompt version
                    </option>
                  ) : null}
                  {(promptVersions.data ?? []).map((version) => (
                    <option key={version.id} value={version.id}>
                      Version {version.version}
                      {version.id === botData.activePromptVersionId ? ' · live' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="eval-retrieval-mode">Retrieval mode</Label>
                <select
                  id="eval-retrieval-mode"
                  className="min-h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={retrievalMode ?? botData.retrievalMode}
                  onChange={(event) => {
                    setRetrievalMode(event.target.value as 'vector' | 'hybrid');
                    setBaselineRunId('');
                  }}
                >
                  <option value="vector">Semantic search</option>
                  <option value="hybrid">Hybrid search</option>
                </select>
                <p className="text-xs text-muted-foreground">
                  Runs use this mode without changing the live bot setting.
                </p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="eval-baseline-run">Compare against</Label>
                <select
                  id="eval-baseline-run"
                  className="min-h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={baselineRunId}
                  onChange={(event) => {
                    setBaselineRunId(event.target.value);
                  }}
                >
                  <option value="">Use a matching baseline automatically</option>
                  {comparisonCandidates.map((run) => (
                    <option key={run.id} value={run.id}>
                      {(run.config?.['retrievalMode'] === 'hybrid' ? 'Hybrid' : 'Semantic') +
                        ` · ${String(Math.round((run.summary?.passRate ?? 0) * 100))}% pass · ${run.id.slice(0, 8)}`}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  Pick a completed run in the other search mode with matching evaluation settings.
                </p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="eval-judge-credential">Judge credential</Label>
                <select
                  id="eval-judge-credential"
                  className="min-h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={judgeCredentialId || botData.chatCredentialId}
                  onChange={(event) => {
                    setJudgeCredentialId(event.target.value);
                  }}
                >
                  <option value="">Choose credential</option>
                  {credentialRows.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label} · {item.provider}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="eval-judge-model">Judge model</Label>
                <Input
                  id="eval-judge-model"
                  value={judgeModel || botData.chatModel}
                  onChange={(event) => {
                    setJudgeModel(event.target.value);
                  }}
                />
              </div>
            </div>
          ) : null}
          {canEdit ? (
            <Button
              disabled={
                startRun.isPending ||
                (cases.data?.data.length ?? 0) === 0 ||
                credentialRows.length === 0 ||
                (promptVersionId !== '' && selectedPrompt === undefined)
              }
              onClick={() => {
                setPageError(null);
                startRun.mutate(
                  {
                    ...(promptVersionId === '' ? {} : { promptVersionId }),
                    judgeCredentialId: judgeCredentialId || botData.chatCredentialId,
                    judgeModel: judgeModel || botData.chatModel,
                    retrievalMode: effectiveRetrievalMode,
                    ...(baselineRunId === '' ? {} : { baselineRunId }),
                  },
                  {
                    onSuccess: (run) => {
                      setRunId(run.id);
                      void runs.refetch();
                    },
                    onError: (error: unknown) => {
                      setPageError(errorMessage(error));
                    },
                  },
                );
              }}
            >
              Start run
            </Button>
          ) : null}
          {runs.isError ? <FormAlert message={errorMessage(runs.error)} /> : null}
          {runs.data?.data.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="p-2">Run</th>
                    <th className="p-2">Status</th>
                    <th className="p-2">Pass rate</th>
                    <th className="p-2">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.data.data.map((run) => (
                    <tr key={run.id} className="border-b">
                      <td className="p-2">
                        <button
                          className="text-primary underline"
                          onClick={() => {
                            setRunId(run.id);
                          }}
                        >
                          {run.createdAt.slice(0, 16).replace('T', ' ')}
                        </button>
                      </td>
                      <td className="p-2">
                        {run.status} ·{' '}
                        {run.config?.['retrievalMode'] === 'hybrid' ? 'Hybrid' : 'Semantic'}
                        {run.config?.['comparisonOnly'] === true ? ' comparison' : ''} ·{' '}
                        {run.casesDone}/{run.casesTotal}
                      </td>
                      <td className="p-2">
                        {run.summary
                          ? `${Math.round(run.summary.passRate * 100).toFixed(0)}%`
                          : '—'}
                      </td>
                      <td className="p-2">${run.costUsd.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No runs yet.</p>
          )}
        </section>
      ) : null}

      {runId ? (
        <section className="space-y-3 rounded-lg border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium">Run results</h3>
            <label className="flex items-center gap-2 text-sm">
              Filter
              <select
                aria-label="Result filter"
                className="min-h-9 rounded-md border bg-background px-2"
                value={resultFilter}
                onChange={(event) => {
                  setResultFilter(event.target.value as typeof resultFilter);
                }}
              >
                <option value="all">All</option>
                <option value="failed">Failed</option>
                <option value="changed">Changed vs baseline</option>
                <option value="regressed">Regressed</option>
              </select>
            </label>
          </div>
          {selectedRun.isError ? <FormAlert message={errorMessage(selectedRun.error)} /> : null}
          {selectedRun.data?.summary?.inconclusive ? (
            <p
              role="alert"
              className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
            >
              The published knowledge or embedding configuration changed while this evaluation was
              running. Its retrieval comparison is inconclusive; rerun it against the current
              configuration before using the result as a baseline.
            </p>
          ) : null}
          {runPrompt === undefined ? null : (
            <a
              className="inline-block text-sm text-primary underline"
              href={`/w/${workspaceId}/bots/${botId}/instructions?${new URLSearchParams({ versionId: runPrompt.id })}`}
            >
              Review prompt version {runPrompt.version}
            </a>
          )}
          {(() => {
            const summary = selectedRun.data?.summary;
            if (summary === null || summary === undefined) return null;
            const baseline = selectedRun.data?.baselineSummary;
            const delta = (
              value: number | null | undefined,
              base: number | null | undefined,
              digits = 0,
            ) =>
              value === null || value === undefined || base === null || base === undefined
                ? '—'
                : `${value - base >= 0 ? '+' : ''}${(value - base).toFixed(digits)}`;
            return (
              <div className="space-y-1 rounded-md bg-muted/40 p-3 text-sm">
                {baseline ? (
                  <p>
                    Compared with baseline · pass rate {Math.round(summary.passRate * 100)}% (
                    {delta(summary.passRate * 100, baseline.passRate * 100)} pp) · hit@5{' '}
                    {summary.hitAtK === null ? '—' : `${String(Math.round(summary.hitAtK * 100))}%`}{' '}
                    (n=
                    {summary.hitAtKCases ?? 0};{' '}
                    {delta(
                      summary.hitAtK === null ? null : summary.hitAtK * 100,
                      baseline.hitAtK === null ? null : baseline.hitAtK * 100,
                    )}{' '}
                    pp) · MRR {summary.mrr?.toFixed(3) ?? '—'} (n={summary.mrrCases ?? 0};{' '}
                    {delta(summary.mrr, baseline.mrr, 3)}) · Citation accuracy{' '}
                    {summary.citationAccuracy === null
                      ? '—'
                      : `${String(Math.round(summary.citationAccuracy * 100))}%`}{' '}
                    (n={summary.citationAccuracyCases ?? 0}) · Handoff accuracy{' '}
                    {summary.escalationAccuracy === null
                      ? '—'
                      : `${String(Math.round(summary.escalationAccuracy * 100))}%`}{' '}
                    (n={summary.handoffCases ?? 0})
                  </p>
                ) : (
                  <p>Retrieval metrics for this run</p>
                )}
                <p className="text-muted-foreground">
                  Retrieval p50/p95 {summary.retrievalP50LatencyMs ?? '—'}/
                  {summary.retrievalP95LatencyMs ?? '—'} ms (n={summary.retrievalLatencyCases ?? 0})
                  {baseline ? (
                    <>
                      {' '}
                      · retrieval p95 Δ{' '}
                      {delta(summary.retrievalP95LatencyMs, baseline.retrievalP95LatencyMs)} ms
                    </>
                  ) : null}
                  · Total latency p50/p95 {summary.p50LatencyMs ?? '—'}/
                  {summary.p95LatencyMs ?? '—'} ms · Query embedding cost{' '}
                  {summary.queryEmbeddingCostUsd === null ||
                  summary.queryEmbeddingCostUsd === undefined
                    ? 'unknown'
                    : `$${summary.queryEmbeddingCostUsd.toFixed(6)}`}{' '}
                  ({summary.queryEmbeddingCostKnownCases ?? 0} priced cases) · Total eval cost $
                  {summary.totalCostUsd.toFixed(4)}
                  {baseline ? (
                    <>
                      {' '}
                      · embedding cost Δ $
                      {delta(summary.queryEmbeddingCostUsd, baseline.queryEmbeddingCostUsd, 6)}
                    </>
                  ) : null}
                </p>
              </div>
            );
          })()}
          {results.isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : results.isError ? (
            <FormAlert message={errorMessage(results.error)} />
          ) : (
            <ul className="space-y-2">
              {results.data.data.map((result) => (
                <li key={result.id} className="rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap justify-between gap-2">
                    <strong>
                      {result.passed ? 'Passed' : 'Failed'} · {result.decision}
                      {result.baselinePassed === null || result.baselinePassed === undefined
                        ? ''
                        : result.passed === result.baselinePassed
                          ? ' · unchanged'
                          : result.passed
                            ? ' · improved'
                            : ' · regressed'}
                    </strong>
                    <span className="text-muted-foreground">
                      {result.latencyMs ?? '—'} ms · ${result.costUsd.toFixed(4)}
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap">
                    {result.answer !== '' ? result.answer : (result.error ?? 'No answer recorded.')}
                  </p>
                  {result.traceId ? (
                    <a
                      className="mt-1 inline-block text-primary underline"
                      href={`/w/${workspaceId}/traces/${result.traceId}`}
                    >
                      Open trace
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {selectedDataset && canEdit ? (
        <section className="space-y-3 rounded-lg border p-4">
          <h3 className="font-medium">Prompt activation gate</h3>
          <p className="text-sm text-muted-foreground">
            Require a recent evaluation before a prompt version can be activated. Owners can
            override a failed gate with an audited reason.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="eval-min-rate">Minimum pass rate</Label>
              <Input
                id="eval-min-rate"
                type="number"
                min="0"
                max="1"
                step="0.01"
                value={minPassRate}
                onChange={(event) => {
                  setMinPassRate(event.target.value);
                }}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="eval-max-regression">Maximum regression</Label>
              <Input
                id="eval-max-regression"
                type="number"
                min="0"
                max="1"
                step="0.01"
                value={maxRegression}
                onChange={(event) => {
                  setMaxRegression(event.target.value);
                }}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={setGate.isPending}
              onClick={() => {
                setGate.mutate(
                  {
                    datasetId: selectedDataset,
                    minPassRate: Number(minPassRate),
                    maxRegression: Number(maxRegression),
                  },
                  {
                    onError: (error: unknown) => {
                      setPageError(errorMessage(error));
                    },
                  },
                );
              }}
            >
              Save gate
            </Button>
            {botData.evalGate ? (
              <Button
                variant="outline"
                disabled={setGate.isPending}
                onClick={() => {
                  setGate.mutate(null, {
                    onError: (error: unknown) => {
                      setPageError(errorMessage(error));
                    },
                  });
                }}
              >
                Disable gate
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
