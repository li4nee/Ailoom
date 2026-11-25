// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import {
  casePassed,
  citationAccuracy,
  hitAtK,
  phraseCheck,
  reciprocalRank,
  summarize,
} from './metrics';

describe('eval metrics', () => {
  it('computes retrieval and citation metrics', () => {
    expect(hitAtK(['a', 'b', 'expected'], ['expected'])).toBe(1);
    expect(reciprocalRank(['a', 'b', 'expected'], ['expected'])).toBeCloseTo(1 / 3, 4);
    expect(reciprocalRank(['a', 'b'], ['expected'])).toBe(0);
    expect(citationAccuracy([], ['expected'])).toBeNull();
    expect(citationAccuracy(['expected', 'other'], ['expected'])).toBe(0.5);
  });

  it('normalizes case and whitespace for required and forbidden phrases', () => {
    expect(
      phraseCheck('Refunds are available\nwithin 30 days.', ['WITHIN 30   days'], 'include'),
    ).toBe(true);
    expect(phraseCheck('Refunds are available in 30 days.', ['14 days'], 'exclude')).toBe(true);
    expect(phraseCheck('Refunds take 14 days.', ['14 days'], 'exclude')).toBe(false);
  });

  it('applies pass policy including optional partial-credit judging', () => {
    const metrics = {
      hitAtK: 1,
      mrr: 0.5,
      citationAccuracy: null,
      mustInclude: true,
      mustNotInclude: true,
      escalationCorrect: null,
      judge: {
        verdict: 'partially_correct' as const,
        score: 0.7,
        rationale: 'Missing a detail.',
        unsupportedClaims: [],
      },
    };
    expect(casePassed(metrics, false)).toBe(false);
    expect(casePassed(metrics, true)).toBe(true);
    expect(casePassed({ ...metrics, mustInclude: false }, true)).toBe(false);
  });

  it('summarizes only applicable values and uses nearest-rank latency percentiles', () => {
    const summary = summarize([
      {
        passed: true,
        metrics: {
          hitAtK: 1,
          mrr: 1,
          citationAccuracy: null,
          mustInclude: true,
          mustNotInclude: null,
          escalationCorrect: null,
          judge: { verdict: 'correct', score: 1, rationale: 'Accurate.', unsupportedClaims: [] },
        },
        latencyMs: 100,
        costUsd: 0.02,
      },
      {
        passed: false,
        metrics: {
          hitAtK: 0,
          mrr: 0,
          citationAccuracy: 0.5,
          mustInclude: false,
          mustNotInclude: true,
          escalationCorrect: false,
          judge: null,
        },
        latencyMs: 300,
        costUsd: 0.03,
      },
    ]);
    expect(summary).toMatchObject({
      casesTotal: 2,
      casesPassed: 1,
      passRate: 0.5,
      hitAtK: 0.5,
      mrr: 0.5,
      citationAccuracy: 0.5,
      mustIncludeRate: 0.5,
      mustNotIncludeRate: 1,
      escalationAccuracy: 0,
      judgeScore: 1,
      totalCostUsd: 0.05,
      p50LatencyMs: 100,
      p95LatencyMs: 300,
    });
  });
});
