// SPDX-License-Identifier: AGPL-3.0-only
import { screen } from '@testing-library/react';
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
    data: [
      { id: 'b1', name: 'Help' },
      { id: 'b2', name: 'Sales' },
    ],
    isLoading: false,
    error: null,
  }),
}));

import { strings } from '@/strings';
import { mockApi } from '@/test/fetch';
import { renderWithQuery } from '@/test/render';
import type { ConversationListItem } from '@app/shared';

import type { InboxFilters } from './api';
import { Inbox } from './components/inbox';
import { InboxFilters as FiltersForm } from './components/inbox-filters';

const WS = 'w1';

const CONVERSATION: ConversationListItem = {
  id: 'c1',
  botId: 'b1',
  botName: 'Help',
  status: 'needs_human',
  contact: { id: 'ct1', name: 'Ada', email: 'ada@example.com' },
  assignedTo: null,
  handoffReason: 'explicit_request',
  handoffRequestedAt: '2026-11-15T10:00:00Z',
  lastMessageAt: '2026-11-15T10:00:00Z',
  lastMessagePreview: 'Can a person help?',
  unansweredByHuman: true,
};

const routes = (): Record<string, [number, unknown?]> => ({
  [`GET /api/v1/workspaces/${WS}/conversations`]: [200, { data: [CONVERSATION], nextCursor: null }],
  [`GET /api/v1/workspaces/${WS}/conversations/counts`]: [200, { needsHuman: 1, mine: 0 }],
});

describe('Inbox', () => {
  it('points needing-human conversations out in the list', async () => {
    const calls = mockApi(routes());
    renderWithQuery(<Inbox workspaceId={WS} filters={{}} onFiltersChange={() => undefined} />);

    expect(await screen.findByText('Ada')).toBeInTheDocument();
    expect(screen.getAllByText(strings.conversations.statuses.needs_human)).not.toHaveLength(1);
    expect(calls[0]?.url).toBe(`/api/v1/workspaces/${WS}/conversations`);
  });

  it('round-trips filters into the list request', async () => {
    const calls = mockApi(routes());
    renderWithQuery(
      <Inbox
        workspaceId={WS}
        filters={{ status: 'needs_human', assignedTo: 'me', q: 'refund' }}
        onFiltersChange={() => undefined}
      />,
    );

    await screen.findByText('Ada');
    expect(calls[0]?.url).toContain('status=needs_human');
    expect(calls[0]?.url).toContain('assignedTo=me');
    expect(calls[0]?.url).toContain('q=refund');
  });

  it('shows the filtered empty state instead of the first-run one', async () => {
    mockApi({
      [`GET /api/v1/workspaces/${WS}/conversations`]: [200, { data: [], nextCursor: null }],
    });
    renderWithQuery(
      <Inbox workspaceId={WS} filters={{ q: 'nothing' }} onFiltersChange={() => undefined} />,
    );

    expect(await screen.findByText(strings.conversations.emptyFilters)).toBeInTheDocument();
  });
});

describe('InboxFilters', () => {
  it('clears the cursor and omits an empty status', async () => {
    const onChange = vi.fn<(next: InboxFilters) => void>();
    renderWithQuery(
      <FiltersForm
        workspaceId={WS}
        filters={{ cursor: 'abc', status: 'needs_human' }}
        onChange={onChange}
      />,
    );

    await userEvent.selectOptions(
      screen.getByLabelText(strings.conversations.status),
      strings.conversations.allStatuses,
    );

    expect(onChange).toHaveBeenCalledWith({});
  });
});
