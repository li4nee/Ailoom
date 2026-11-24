// SPDX-License-Identifier: AGPL-3.0-only
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/features/bots/api', () => ({
  useBots: () => ({ data: [{ id: 'b1', name: 'Help' }], isLoading: false, error: null }),
}));

import { strings } from '@/strings';
import { apiError, mockApi } from '@/test/fetch';
import { renderWithQuery } from '@/test/render';
import type { OutcomesDto } from '@app/shared';

import type { UsageRange } from './api';
import { OutcomesReport } from './components/outcomes-report';

const WS = 'w1';
const RANGE: UsageRange = { from: '2026-11-01', to: '2026-11-02', botId: 'b1' };
const OUTCOMES: OutcomesDto = {
  conversations: 4,
  pending: 1,
  handoffRate: 0.25,
  aiResolutionRate: 2 / 3,
  aiResolved: 2,
  handedOff: 1,
  firstHumanResponse: { medianSeconds: 120, p90Seconds: 300, unanswered: 0 },
  resolutionTime: { medianSeconds: 600, p90Seconds: 900 },
  csat: { satisfiedRate: 1, averageScore: 4.5, responseRate: 0.5, ratings: 2 },
  costPerResolvedUsd: '0.012500',
  daily: [
    { day: '2026-11-01', conversations: 2, aiResolved: 1, handedOff: 1 },
    { day: '2026-11-02', conversations: 2, aiResolved: 1, handedOff: 0 },
  ],
};

function renderReport(range = RANGE, onRangeChange = vi.fn<(next: UsageRange) => void>()) {
  return {
    ...renderWithQuery(
      <OutcomesReport workspaceId={WS} range={range} onRangeChange={onRangeChange} />,
    ),
    onRangeChange,
  };
}

describe('OutcomesReport', () => {
  it('renders metric values with accessible definitions and the daily stacked chart', async () => {
    mockApi({ [`GET /api/v1/workspaces/${WS}/usage/outcomes`]: [200, OUTCOMES] });
    renderReport();

    expect(await screen.findByText('66.7%')).toBeInTheDocument();
    expect(screen.getByText('$0.012500')).toBeInTheDocument();
    expect(screen.getByLabelText(/Definition: Conversations created/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: strings.usage.outcomesChart })).toBeInTheDocument();
    expect(screen.getByText('p90 5 min')).toBeInTheDocument();
  });

  it('shows an em dash for null metrics and a useful empty state', async () => {
    const empty: OutcomesDto = {
      ...OUTCOMES,
      conversations: 0,
      pending: 0,
      handoffRate: null,
      aiResolutionRate: null,
      aiResolved: 0,
      handedOff: 0,
      firstHumanResponse: { medianSeconds: null, p90Seconds: null, unanswered: 0 },
      resolutionTime: { medianSeconds: null, p90Seconds: null },
      csat: { satisfiedRate: null, averageScore: null, responseRate: null, ratings: 0 },
      costPerResolvedUsd: null,
      daily: [],
    };
    mockApi({ [`GET /api/v1/workspaces/${WS}/usage/outcomes`]: [200, empty] });
    renderReport({ from: RANGE.from, to: RANGE.to });

    expect(await screen.findAllByText(strings.usage.outcomesEmpty)).toHaveLength(2);
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(6);
    expect(
      screen.queryByRole('img', { name: strings.usage.outcomesChart }),
    ).not.toBeInTheDocument();
  });

  it('keeps date and bot filters together in the URL update callback', async () => {
    const onRangeChange = vi.fn<(next: UsageRange) => void>();
    mockApi({ [`GET /api/v1/workspaces/${WS}/usage/outcomes`]: [200, OUTCOMES] });
    renderReport({ from: RANGE.from, to: RANGE.to }, onRangeChange);

    const from = await screen.findByLabelText(strings.usage.from);
    await userEvent.clear(from);
    await userEvent.type(from, '2026-10-31');
    await userEvent.selectOptions(screen.getByLabelText(strings.conversations.bot), '');
    await userEvent.click(screen.getByRole('button', { name: strings.usage.apply }));

    await waitFor(() => {
      expect(onRangeChange).toHaveBeenCalledWith({ from: '2026-10-31', to: RANGE.to });
    });
  });

  it('shows a loading state and a readable request error', async () => {
    mockApi({ [`GET /api/v1/workspaces/${WS}/usage/outcomes`]: [500, apiError('internal_error')] });
    renderReport();

    expect(screen.getByRole('status', { name: strings.app.loading })).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
