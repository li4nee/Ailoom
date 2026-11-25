// SPDX-License-Identifier: AGPL-3.0-only
import type { EvalSummary } from '@app/shared';

export interface EvalMetrics {
  hitAtK: number | null;
  mrr: number | null;
  citationAccuracy: number | null;
  mustInclude: boolean | null;
  mustNotInclude: boolean | null;
  escalationCorrect: boolean | null;
  judge:
    | {
        verdict: 'correct' | 'partially_correct' | 'incorrect';
        score: number;
        rationale: string;
        unsupportedClaims: string[];
      }
    | { error: 'judge_error' }
    | null;
}

export interface EvalResultRow {
  passed: boolean;
  metrics: EvalMetrics;
  latencyMs: number | null;
  costUsd: number;
  error?: string | null;
}

export function hitAtK(usedDocumentIds: string[], expected: string[]): 0 | 1 {
  const wanted = new Set(expected);
  return usedDocumentIds.slice(0, 5).some((id) => wanted.has(id)) ? 1 : 0;
}

export function reciprocalRank(retrievedDocumentIds: string[], expected: string[]): number {
  const wanted = new Set(expected);
  const rank = retrievedDocumentIds.slice(0, 8).findIndex((id) => wanted.has(id));
  return rank < 0 ? 0 : 1 / (rank + 1);
}

export function citationAccuracy(citedDocumentIds: string[], expected: string[]): number | null {
  if (citedDocumentIds.length === 0) return null;
  const wanted = new Set(expected);
  return citedDocumentIds.filter((id) => wanted.has(id)).length / citedDocumentIds.length;
}

function normalizeAnswer(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, ' ').trim();
}

export function phraseCheck(
  answer: string,
  phrases: string[],
  mode: 'include' | 'exclude',
): boolean {
  const normalized = normalizeAnswer(answer);
  const matches = phrases.map((phrase) => normalized.includes(normalizeAnswer(phrase)));
  return mode === 'include' ? matches.every(Boolean) : matches.every((match) => !match);
}

export function casePassed(metrics: EvalMetrics, allowPartial: boolean): boolean {
  if (metrics.hitAtK !== null && metrics.hitAtK !== 1) return false;
  if (metrics.mustInclude === false || metrics.mustNotInclude === false) return false;
  if (metrics.escalationCorrect === false) return false;
  if (metrics.judge !== null) {
    if ('error' in metrics.judge) return false;
    return (
      metrics.judge.verdict === 'correct' ||
      (allowPartial && metrics.judge.verdict === 'partially_correct')
    );
  }
  return true;
}

function mean(values: (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0
    ? null
    : present.reduce((total, value) => total + value, 0) / present.length;
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] ?? null;
}

export function summarize(results: EvalResultRow[]): EvalSummary {
  const metrics = results.map((row) => row.metrics);
  const aggregateMetrics = results.map((row) =>
    row.error === 'stale_expectation' ? { ...row.metrics, hitAtK: null } : row.metrics,
  );
  const latencies = results
    .map((row) => row.latencyMs)
    .filter((value): value is number => value !== null);
  const casesPassed = results.filter((row) => row.passed).length;
  const averageBoolean = (values: (boolean | null)[]): number | null =>
    mean(values.map((value) => (value === null ? null : value ? 1 : 0)));

  return {
    casesTotal: results.length,
    casesPassed,
    casesFailed: results.length - casesPassed,
    passRate: results.length === 0 ? 0 : casesPassed / results.length,
    hitAtK: mean(aggregateMetrics.map((row) => row.hitAtK)),
    mrr: mean(metrics.map((row) => row.mrr)),
    citationAccuracy: mean(metrics.map((row) => row.citationAccuracy)),
    mustIncludeRate: averageBoolean(metrics.map((row) => row.mustInclude)),
    mustNotIncludeRate: averageBoolean(metrics.map((row) => row.mustNotInclude)),
    escalationAccuracy: averageBoolean(metrics.map((row) => row.escalationCorrect)),
    judgeScore: mean(
      metrics.map((row) => (row.judge !== null && 'score' in row.judge ? row.judge.score : null)),
    ),
    totalCostUsd: results.reduce((total, row) => total + row.costUsd, 0),
    p50LatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
  };
}
