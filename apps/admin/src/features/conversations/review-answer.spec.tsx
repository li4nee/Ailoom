// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { WorkspaceRoleProvider } from '@/components/role-gate';
import { mockApi } from '@/test/fetch';
import { renderWithQuery } from '@/test/render';
import type { AdminMessage, Role } from '@app/shared';

import { MessageTimeline } from './components/message-timeline';

const WS = '11111111-1111-4111-8111-111111111111';
const CID = '22222222-2222-4222-8222-222222222222';
const MID = '33333333-3333-4333-8333-333333333333';
const base: AdminMessage = {
  id: MID,
  role: 'ai',
  content: 'Refunds take five days.',
  citations: null,
  status: 'complete',
  feedback: null,
  agentReview: null,
  author: null,
  traceId: null,
  createdAt: '2026-11-15T10:01:00Z',
};
const messages: AdminMessage[] = [
  {
    ...base,
    id: '44444444-4444-4444-8444-444444444444',
    role: 'visitor',
    content: 'How long do refunds take?',
  },
  base,
];

function asRole(role: Role, ui: React.ReactElement): React.ReactElement {
  return <WorkspaceRoleProvider role={role}>{ui}</WorkspaceRoleProvider>;
}

describe('ReviewAnswer', () => {
  it('appears only for completed AI answers and pre-fills the nearest visitor question', async () => {
    mockApi({});
    renderWithQuery(
      asRole(
        'agent',
        <MessageTimeline
          messages={[
            ...messages,
            { ...base, id: '55555555-5555-4555-8555-555555555555', status: 'streaming' },
          ]}
          workspaceId={WS}
          conversationId={CID}
        />,
      ),
    );
    expect(screen.getAllByRole('button', { name: 'Review answer' })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Review answer' }));
    expect(screen.getByLabelText('Question')).toHaveValue('How long do refunds take?');
    expect(screen.getByLabelText('Answer')).toHaveValue(base.content);
  });

  it('submits the edited correction to the review endpoint', async () => {
    const calls = mockApi({
      [`POST /api/v1/workspaces/${WS}/conversations/${CID}/messages/${MID}/review`]: [
        200,
        {
          review: {
            verdict: 'incorrect',
            correctedAnswer: 'Refunds take 7 days.',
            reviewerId: WS,
            reviewedAt: '2026-11-15T10:02:00Z',
            suggestionId: '66666666-6666-4666-8666-666666666666',
          },
          suggestion: null,
        },
      ],
    });
    renderWithQuery(
      asRole(
        'agent',
        <MessageTimeline messages={messages} workspaceId={WS} conversationId={CID} />,
      ),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Review answer' }));
    fireEvent.change(screen.getByLabelText('Answer'), {
      target: { value: 'Refunds take 7 days.' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Submit correction' }));
    expect(calls.at(-1)?.body).toEqual({
      verdict: 'incorrect',
      question: 'How long do refunds take?',
      answer: 'Refunds take 7 days.',
    });
  });
});
