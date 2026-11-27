// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import type { EvalCaseSnapshot } from './runs.repository';
import { hasCurrentComparisonContext } from './runs.service';

const cases: EvalCaseSnapshot[] = [
  {
    id: 'case-1',
    question: 'Where is my order?',
    history: [],
    expectedAnswer: null,
    expectedDocumentIds: [],
    mustInclude: [],
    mustNotInclude: [],
    expectHandoff: null,
    needsExpectation: false,
    toolFixtures: [],
  },
];
const tools = [
  {
    id: 'tool-1',
    version: 1,
    name: 'lookup_order',
    description: 'Read order status.',
    useWhen: 'The visitor asks where their order is.',
    neverUse: 'Never change or cancel an order.',
    failureBehavior: 'Continue without the lookup result.',
    inputs: [],
    responseFields: [],
    maxCalls: 1,
  },
];
const config = {
  knowledgeVersionFingerprint: 'knowledge-v1',
  allowPartial: false,
  toolDefinitions: tools,
};
const row = { cases_snapshot: cases, config };

describe('hasCurrentComparisonContext', () => {
  it('accepts matching cases, knowledge, dataset policy, and tool snapshots regardless of object key order', () => {
    const reorderedCase = Object.fromEntries(
      Object.entries(cases[0]!).reverse(),
    ) as unknown as EvalCaseSnapshot;
    const reorderedTool = Object.fromEntries(Object.entries(tools[0]!).reverse());
    expect(
      hasCurrentComparisonContext(row, [reorderedCase], 'knowledge-v1', false, [reorderedTool]),
    ).toBe(true);
  });

  it('rejects a baseline when any saved comparison context has changed', () => {
    expect(
      hasCurrentComparisonContext(
        row,
        [{ ...cases[0], question: 'Different case' }],
        'knowledge-v1',
        false,
        tools,
      ),
    ).toBe(false);
    expect(hasCurrentComparisonContext(row, cases, 'knowledge-v2', false, tools)).toBe(false);
    expect(hasCurrentComparisonContext(row, cases, 'knowledge-v1', true, tools)).toBe(false);
    expect(
      hasCurrentComparisonContext(row, cases, 'knowledge-v1', false, [
        { ...tools[0], name: 'other_tool' },
      ]),
    ).toBe(false);
  });
});
