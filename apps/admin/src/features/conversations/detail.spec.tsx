// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, screen, waitFor } from '@testing-library/react';
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

import { strings } from '@/strings';
import { mockApi } from '@/test/fetch';
import { renderWithQuery } from '@/test/render';
import type { AdminMessage, ConversationDetail as Detail, TraceDetail } from '@app/shared';

import { ConversationDetail } from './components/conversation-detail';
import { needsHumanNotification } from './notifications';

const WS = 'w1';
const CID = 'c1';
const TRACE_ID = 't1';

const MESSAGE: AdminMessage = {
  id: 'm2',
  role: 'ai',
  content: 'Refunds take five days.',
  citations: [{ n: 1, chunkId: 'k1', documentId: 'd1', title: 'Refunds', url: null }],
  status: 'complete',
  feedback: null,
  author: null,
  traceId: TRACE_ID,
  createdAt: '2026-11-15T10:01:00Z',
};

const DETAIL: Detail = {
  conversation: {
    id: CID,
    botId: 'b1',
    botName: 'Help',
    channel: 'widget',
    status: 'needs_human',
    assignedTo: null,
    handoffReason: 'explicit_request',
    handoffRequestedAt: '2026-11-15T10:01:00Z',
    priority: 'normal',
    lastMessageAt: '2026-11-15T10:02:00Z',
    closedAt: null,
    metadata: {},
    createdAt: '2026-11-15T10:00:00Z',
  },
  contact: { id: 'ct1', name: 'Ada', email: 'ada@example.com' },
  messages: [
    {
      id: 'm1',
      role: 'visitor',
      content: 'How long do refunds take?',
      citations: null,
      status: 'complete',
      feedback: null,
      author: null,
      traceId: null,
      createdAt: '2026-11-15T10:00:00Z',
    },
    MESSAGE,
  ],
};

const TRACE: TraceDetail = {
  id: TRACE_ID,
  decision: 'answered',
  decisionReason: 'score_above_threshold',
  origin: 'widget',
  createdAt: '2026-11-15T10:01:00Z',
  promptVersion: { id: 'p1', version: 3, systemPrompt: 'Be helpful.' },
  platformPromptVersion: '2026-01-01',
  chat: { provider: 'mock', model: 'chat' },
  embedding: { provider: 'mock', model: 'embed' },
  retrieval: [
    {
      rank: 1,
      score: 0.91,
      used: true,
      chunkId: 'k1',
      documentId: null,
      sourceTitle: null,
      preview: null,
      sourceDeleted: true,
    },
  ],
  requestSnapshot: { messages: [{ role: 'visitor', content: 'How long?' }] },
  inputTokens: 120,
  outputTokens: 40,
  embeddingTokens: 8,
  costUsd: '0.0012',
  priceKnown: true,
  latencyMs: 800,
  ttftMs: 200,
  error: null,
  feedback: null,
};

const ME = {
  id: 'u1',
  email: 'agent@example.com',
  name: 'Ada Agent',
  emailVerified: true,
  isInstanceAdmin: false,
  memberships: [{ workspaceId: WS, workspaceName: 'Acme', role: 'agent' }],
};

function routes(detail: Detail = DETAIL): Record<string, [number, unknown?]> {
  return {
    [`GET /api/v1/auth/me`]: [200, ME],
    [`GET /api/v1/workspaces/${WS}/conversations/${CID}`]: [200, detail],
    [`GET /api/v1/workspaces/${WS}/traces/${TRACE_ID}`]: [200, TRACE],
    [`POST /api/v1/workspaces/${WS}/conversations/${CID}/messages`]: [
      200,
      {
        ...MESSAGE,
        id: 'm3',
        role: 'agent',
        author: { id: 'u1', name: 'Ada Agent' },
        content: 'Hello!',
      },
    ],
    [`POST /api/v1/workspaces/${WS}/conversations/${CID}/takeover`]: [200, { status: 'human' }],
  };
}

describe('needsHumanNotification', () => {
  it('uses the bot name and the latest visitor message', () => {
    expect(needsHumanNotification(DETAIL, WS)).toEqual({
      workspaceId: WS,
      conversationId: CID,
      botName: 'Help',
      preview: 'How long do refunds take?',
    });
  });

  it('falls back when the visitor sent no text', () => {
    const empty = {
      ...DETAIL,
      messages: DETAIL.messages.filter((message) => message.role !== 'visitor'),
    };
    expect(needsHumanNotification(empty, WS).preview).toBe(
      strings.conversations.notificationFallback,
    );
  });
});

describe('ConversationDetail', () => {
  it('renders the timeline and contact in order', async () => {
    mockApi(routes());
    renderWithQuery(<ConversationDetail workspaceId={WS} conversationId={CID} />);

    expect(await screen.findByText('How long do refunds take?')).toBeInTheDocument();
    expect(screen.getByText('Refunds take five days.')).toBeInTheDocument();
    expect(screen.getByText('Refunds')).toBeInTheDocument();
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
  });

  it('shows the replay drawer with retrieval and deleted sources', async () => {
    mockApi(routes());
    renderWithQuery(<ConversationDetail workspaceId={WS} conversationId={CID} />);

    fireEvent.click(await screen.findByRole('button', { name: strings.conversations.trace.title }));

    expect(await screen.findByText(strings.conversations.trace.deleted)).toBeInTheDocument();
    expect(screen.getByText('0.910')).toBeInTheDocument();
    expect(screen.getByText(/"role": "visitor"/)).toBeInTheDocument();
  });

  it('sends a reply and clears the composer', async () => {
    const calls = mockApi(routes());
    renderWithQuery(<ConversationDetail workspaceId={WS} conversationId={CID} />);

    const composer = await screen.findByLabelText(strings.conversations.detail.composer);
    await userEvent.type(composer, 'Hello!');
    await userEvent.click(screen.getByRole('button', { name: strings.conversations.detail.send }));

    await waitFor(() => {
      expect(composer).toHaveValue('');
    });
    expect(
      calls.find(
        (call) =>
          call.method === 'POST' &&
          call.url === `/api/v1/workspaces/${WS}/conversations/${CID}/messages`,
      )?.body,
    ).toEqual({ content: 'Hello!' });
  });

  it('takes over a needing-human conversation', async () => {
    const calls = mockApi(routes());
    renderWithQuery(<ConversationDetail workspaceId={WS} conversationId={CID} />);

    await userEvent.click(
      await screen.findByRole('button', { name: strings.conversations.detail.takeover }),
    );

    await waitFor(() => {
      expect(
        calls.some(
          (call) =>
            call.method === 'POST' &&
            call.url === `/api/v1/workspaces/${WS}/conversations/${CID}/takeover`,
        ),
      ).toBe(true);
    });
  });

  it('warns when another agent owns the conversation', async () => {
    mockApi(
      routes({
        ...DETAIL,
        conversation: {
          ...DETAIL.conversation,
          status: 'human',
          assignedTo: { id: 'u2', name: 'Grace' },
        },
      }),
    );
    renderWithQuery(<ConversationDetail workspaceId={WS} conversationId={CID} />);

    expect(
      await screen.findByText(strings.conversations.detail.alreadyAssigned('Grace')),
    ).toBeInTheDocument();
  });
});
