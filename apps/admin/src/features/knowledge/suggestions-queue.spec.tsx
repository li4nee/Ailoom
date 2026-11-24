// SPDX-License-Identifier: AGPL-3.0-only
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { WorkspaceRoleProvider } from '@/components/role-gate';
import { mockApi } from '@/test/fetch';
import { renderWithQuery } from '@/test/render';
import type { KnowledgeSuggestionDto, Role } from '@app/shared';

import { SuggestionsQueue } from './components/suggestions-queue';

const WS = '11111111-1111-4111-8111-111111111111';
const SUGGESTION = '22222222-2222-4222-8222-222222222222';
const BOT = '33333333-3333-4333-8333-333333333333';
const SOURCE = '44444444-4444-4444-8444-444444444444';
const item: KnowledgeSuggestionDto = {
  id: SUGGESTION,
  botId: BOT,
  botName: 'Support bot',
  messageId: null,
  conversationId: null,
  question: 'How long do refunds take?',
  answer: 'Refunds take 7 days.',
  status: 'pending',
  createdBy: { id: WS, name: 'Agent' },
  reviewedBy: null,
  reviewedAt: null,
  rejectReason: null,
  sourceId: null,
  createdAt: '2026-11-15T10:00:00Z',
};

function asRole(role: Role, ui: React.ReactElement): React.ReactElement {
  return <WorkspaceRoleProvider role={role}>{ui}</WorkspaceRoleProvider>;
}

describe('SuggestionsQueue', () => {
  it('lets admins approve a correction and then links to its source', async () => {
    const calls = mockApi({
      [`GET /api/v1/workspaces/${WS}/knowledge/suggestions`]: [
        200,
        { data: [item], nextCursor: null },
      ],
      [`POST /api/v1/workspaces/${WS}/knowledge/suggestions/${SUGGESTION}/approve`]: [
        200,
        { suggestion: { ...item, status: 'approved', sourceId: SOURCE }, sourceId: SOURCE },
      ],
    });
    renderWithQuery(asRole('admin', <SuggestionsQueue workspaceId={WS} />));
    await userEvent.click(await screen.findByRole('button', { name: 'Approve into knowledge' }));
    expect(screen.getByLabelText('Title')).toHaveValue('Correction: How long do refunds take?');
    await userEvent.click(screen.getByRole('button', { name: 'Approve into knowledge' }));
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      title: 'Correction: How long do refunds take?',
      question: item.question,
      answer: item.answer,
    });
  });

  it('shows suggestions read-only to agents', async () => {
    mockApi({
      [`GET /api/v1/workspaces/${WS}/knowledge/suggestions`]: [
        200,
        { data: [item], nextCursor: null },
      ],
    });
    renderWithQuery(asRole('agent', <SuggestionsQueue workspaceId={WS} />));
    expect(await screen.findByText(item.question)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Approve into knowledge' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
  });

  it('renders an empty queue', async () => {
    mockApi({
      [`GET /api/v1/workspaces/${WS}/knowledge/suggestions`]: [200, { data: [], nextCursor: null }],
    });
    renderWithQuery(asRole('admin', <SuggestionsQueue workspaceId={WS} />));
    expect(await screen.findByText('No knowledge suggestions yet.')).toBeInTheDocument();
  });
});
