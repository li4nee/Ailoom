// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';

import {
  EVAL_RUN_STATUSES,
  evalCaseInputSchema,
  evalDatasetExportSchema,
  startEvalRunSchema,
} from './eval.js';

const uuid = '018f0a4e-7b2c-7abc-8def-0123456789ab';

describe('eval contracts', () => {
  it('requires a question and at least one expectation unless needsExpectation is set', () => {
    expect(
      evalCaseInputSchema.safeParse({ question: 'How long is the refund window?' }).success,
    ).toBe(false);
    expect(
      evalCaseInputSchema.safeParse({
        question: 'How long is the refund window?',
        expectedAnswer: '30 days',
      }).success,
    ).toBe(true);
    expect(
      evalCaseInputSchema.safeParse({
        question: 'How long is the refund window?',
        needsExpectation: true,
      }).success,
    ).toBe(true);
  });

  it('validates bounded case expectations and dataset export format', () => {
    expect(
      evalCaseInputSchema.safeParse({
        question: 'Where is the policy?',
        expectedDocumentIds: [uuid],
        mustInclude: ['billing'],
      }).success,
    ).toBe(true);
    expect(
      evalDatasetExportSchema.safeParse({
        format: 'ailoom-eval-dataset',
        version: 1,
        cases: [{ question: 'Q', expectHandoff: true }],
      }).success,
    ).toBe(true);
    expect(
      evalDatasetExportSchema.safeParse({
        format: 'wrong-format',
        version: 2,
        cases: [],
      }).success,
    ).toBe(false);
  });

  it('validates the requested chat and judge configuration', () => {
    expect(
      startEvalRunSchema.safeParse({
        datasetId: uuid,
        judgeCredentialId: uuid,
        judgeModel: 'mock-judge',
        retrievalThreshold: 0.65,
      }).success,
    ).toBe(true);
    expect(startEvalRunSchema.safeParse({ datasetId: uuid }).success).toBe(false);
  });

  it('exposes the supported run lifecycle', () => {
    expect(EVAL_RUN_STATUSES).toEqual(['queued', 'running', 'completed', 'failed', 'cancelled']);
  });
});
