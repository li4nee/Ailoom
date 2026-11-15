// SPDX-License-Identifier: AGPL-3.0-only
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
      <a href={to}>{children}</a>
    ),
  };
});

vi.mock('@/features/bots/api', () => ({
  useBots: () => ({
    data: [{ id: 'b1', name: 'Help' }],
    isLoading: false,
    error: null,
  }),
}));

import { strings } from '@/strings';
import { mockApi } from '@/test/fetch';
import { renderWithQuery } from '@/test/render';
import type { TraceDetail, UsageReport as Report } from '@app/shared';

import { defaultUsageRange } from './api';
import { FeedbackReport } from './components/feedback-report';
import { UnansweredReport } from './components/unanswered-report';
import { UsageReport } from './components/usage-report';

const WS = 'w1';

const REPORT: Report = {
  days: [
    {
      day: '2026-11-01',
      conversations: 2,
      visitorMessages: 4,
      aiMessages: 3,
      escalations: 1,
      inputTokens: 100,
      outputTokens: 50,
      embeddingTokens: 10,
      costUsd: '0.1200',
    },
    {
      day: '2026-11-02',
      conversations: 1,
      visitorMessages: 2,
      aiMessages: 2,
      escalations: 0,
      inputTokens: 40,
      outputTokens: 20,
      embeddingTokens: 5,
      costUsd: '0.0300',
    },
  ],
  totals: {
    conversations: 3,
    visitorMessages: 6,
    aiMessages: 5,
    escalations: 1,
    inputTokens: 140,
    outputTokens: 70,
    embeddingTokens: 15,
    costUsd: '0.1500',
  },
  feedback: { positive: 3, negative: 1, positiveRate: 0.75 },
  monthToDate: { costUsd: '4.00', capUsd: '10.00' },
};

const TRACE: TraceDetail = {
  id: 't1',
  decision: 'answered',
  decisionReason: 'score_above_threshold',
  origin: 'widget',
  createdAt: '2026-11-02T10:00:00Z',
  promptVersion: null,
  platformPromptVersion: '2026-01-01',
  chat: null,
  embedding: null,
  retrieval: [],
  requestSnapshot: {},
  inputTokens: 10,
  outputTokens: 5,
  embeddingTokens: 0,
  costUsd: '0.01',
  priceKnown: true,
  latencyMs: 100,
  ttftMs: 20,
  error: null,
  feedback: -1,
};

describe('defaultUsageRange', () => {
  it('starts at the first day of the current UTC month and ends today', () => {
    expect(defaultUsageRange(new Date('2026-11-15T23:30:00Z'))).toEqual({
      from: '2026-11-01',
      to: '2026-11-15',
    });
  });
});

describe('UsageReport', () => {
  it('shows totals, the cap bar and the cost chart', async () => {
    mockApi({ [`GET /api/v1/workspaces/${WS}/usage`]: [200, REPORT] });
    renderWithQuery(<UsageReport workspaceId={WS} />);

    expect(await screen.findByRole('img', { name: strings.usage.chart })).toBeInTheDocument();
    expect(screen.getByText('16.7%')).toBeInTheDocument();
    expect(screen.getByText('75.0%')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40');
    expect(screen.getByText('$0.1500')).toBeInTheDocument();
  });

  it('offers the same data as a table', async () => {
    mockApi({ [`GET /api/v1/workspaces/${WS}/usage`]: [200, REPORT] });
    renderWithQuery(<UsageReport workspaceId={WS} />);

    await userEvent.click(await screen.findByRole('button', { name: strings.usage.table }));

    expect(screen.getByRole('cell', { name: '2026-11-01' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '$0.1200' })).toBeInTheDocument();
  });

  it('applies a new inclusive range from the picker', async () => {
    const calls = mockApi({ [`GET /api/v1/workspaces/${WS}/usage`]: [200, REPORT] });
    renderWithQuery(<UsageReport workspaceId={WS} />);

    const from = await screen.findByLabelText(strings.usage.from);
    await userEvent.clear(from);
    await userEvent.type(from, '2026-10-01');
    await userEvent.click(screen.getByRole('button', { name: strings.usage.apply }));

    await waitFor(() => {
      expect(calls.some((call) => call.url.includes('from=2026-10-01'))).toBe(true);
    });
  });
});

describe('UnansweredReport', () => {
  it('links to the conversation and opens add-knowledge for that bot', async () => {
    mockApi({
      [`GET /api/v1/workspaces/${WS}/unanswered`]: [
        200,
        {
          data: [
            {
              messageId: 'm1',
              conversationId: 'c1',
              botId: 'b1',
              content: 'Do you ship to Mars?',
              topScore: 0.2,
              createdAt: '2026-11-01T10:00:00Z',
            },
          ],
          nextCursor: null,
        },
      ],
    });
    renderWithQuery(<UnansweredReport workspaceId={WS} />);

    expect(await screen.findByText('Do you ship to Mars?')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: strings.conversations.open })).toHaveAttribute(
      'href',
      '/w/$workspaceId/conversations/$conversationId',
    );

    await userEvent.click(screen.getByRole('button', { name: strings.usage.addKnowledge }));
    expect(await screen.findByRole('heading', { name: strings.knowledge.add })).toBeInTheDocument();
  });

  it('goes forward and back through cursor pages', async () => {
    const pageOne = {
      messageId: 'm1',
      conversationId: 'c1',
      botId: 'b1',
      content: 'First question',
      topScore: 0.2,
      createdAt: '2026-11-02T10:00:00Z',
    };
    const pageTwo = { ...pageOne, messageId: 'm2', content: 'Second question' };
    mockApi({
      [`GET /api/v1/workspaces/${WS}/unanswered`]: (call) =>
        call.url.includes('cursor=cursor-2')
          ? [200, { data: [pageTwo], nextCursor: null }]
          : [200, { data: [pageOne], nextCursor: 'cursor-2' }],
    });
    renderWithQuery(<UnansweredReport workspaceId={WS} />);

    expect(await screen.findByText('First question')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: strings.app.nextPage }));
    expect(await screen.findByText('Second question')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: strings.app.previousPage }));
    expect(await screen.findByText('First question')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: strings.app.nextPage })).toBeInTheDocument();
  });
});

describe('FeedbackReport', () => {
  it('opens the trace behind a negative rating', async () => {
    mockApi({
      [`GET /api/v1/workspaces/${WS}/feedback`]: [
        200,
        {
          data: [
            {
              messageId: 'm2',
              conversationId: 'c1',
              content: 'Wrong answer',
              traceId: 't1',
              feedbackAt: '2026-11-02T10:00:00Z',
            },
          ],
          nextCursor: null,
        },
      ],
      [`GET /api/v1/workspaces/${WS}/traces/t1`]: [200, TRACE],
    });
    renderWithQuery(<FeedbackReport workspaceId={WS} />);

    expect(await screen.findByText('Wrong answer')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: strings.conversations.trace.title }));
    expect(await screen.findByText(strings.conversations.trace.decision)).toBeInTheDocument();
  });
});
