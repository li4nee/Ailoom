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
const REPLY_ID = '0193a111-2222-7333-8444-555555555555';

const MESSAGE: AdminMessage = {
  id: '0193a111-2222-7333-8444-555555555565',
  role: 'ai',
  content: 'Refunds take five days.',
  citations: [{ n: 1, chunkId: 'k1', documentId: 'd1', title: 'Refunds', url: null }],
  status: 'complete',
  feedback: null,
  agentReview: null,
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
    workflowVersion: 1,
    assignedTo: null,
    handoffReason: 'explicit_request',
    handoffRequestedAt: '2026-11-15T10:01:00Z',
    priority: 'normal',
    lastMessageAt: '2026-11-15T10:02:00Z',
    closedAt: null,
    metadata: {},
    createdAt: '2026-11-15T10:00:00Z',
  },
  contact: {
    id: 'ct1',
    name: 'Ada',
    email: 'ada@example.com',
    externalId: null,
    attributes: {},
    firstSeenAt: '2026-11-15T10:00:00Z',
    lastSeenAt: '2026-11-15T10:02:00Z',
  },
  contactHistory: [],
  crmLinks: [],
  handoffSummaryEnabled: false,
  handoffSummary: null,
  suggestedRepliesEnabled: false,
  suggestedReply: null,
  messages: [
    {
      id: '0193a111-2222-7333-8444-555555555566',
      role: 'visitor',
      content: 'How long do refunds take?',
      citations: null,
      status: 'complete',
      feedback: null,
      agentReview: null,
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
  toolCalls: [],
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
    [`GET /api/v1/workspaces/${WS}/saved-replies`]: [
      200,
      [
        {
          id: REPLY_ID,
          title: 'Greeting',
          body: 'Hello, how can I help?',
          sortOrder: 0,
          archivedAt: null,
          updatedAt: '2026-11-18T00:00:00Z',
        },
      ],
    ],
    [`GET /api/v1/workspaces/${WS}/conversations/${CID}/internal-notes`]: [200, []],
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
    expect(screen.getAllByText('ada@example.com')).toHaveLength(2);
  });

  it('renders linked CRM records as safe external links', async () => {
    mockApi(
      routes({
        ...DETAIL,
        crmLinks: [
          {
            integrationId: 'integration-1',
            integrationName: 'Acme HubSpot',
            provider: 'hubspot',
            objectType: 'contact',
            externalObjectId: 'contact-42',
            url: 'https://app.hubspot.com/contacts/12345678/record/0-1/contact-42',
          },
        ],
      }),
    );
    renderWithQuery(<ConversationDetail workspaceId={WS} conversationId={CID} />);

    const link = await screen.findByRole('link', { name: 'Acme HubSpot: contact' });
    expect(link).toHaveAttribute(
      'href',
      'https://app.hubspot.com/contacts/12345678/record/0-1/contact-42',
    );
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
  });

  it('shows the replay drawer with retrieval and deleted sources', async () => {
    mockApi(routes());
    renderWithQuery(<ConversationDetail workspaceId={WS} conversationId={CID} />);

    fireEvent.click(await screen.findByRole('button', { name: strings.conversations.trace.title }));

    expect(await screen.findAllByText(strings.conversations.trace.deleted)).toHaveLength(2);
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

  it('inserts a saved reply into the composer without sending it', async () => {
    const calls = mockApi(routes());
    renderWithQuery(<ConversationDetail workspaceId={WS} conversationId={CID} />);
    const composer = await screen.findByLabelText(strings.conversations.detail.composer);
    await screen.findByRole('option', { name: 'Greeting' });
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: strings.conversations.detail.savedReplies }),
      REPLY_ID,
    );
    await userEvent.click(
      screen.getByRole('button', { name: strings.conversations.detail.insertSavedReply }),
    );
    expect(composer).toHaveValue('Hello, how can I help?');
    expect(calls.some((call) => call.method === 'POST' && call.url.endsWith('/messages'))).toBe(
      false,
    );
  });

  it('inserts a grounded suggestion as an editable draft without sending it', async () => {
    const artifact = {
      id: '0193a111-2222-7333-8444-555555555560',
      kind: 'suggested_reply',
      state: 'ready',
      sourceThroughMessageId: MESSAGE.id,
      promptVersion: 'suggested-reply-v1',
      traceId: '0193a111-2222-7333-8444-555555555561',
      content: {
        draft: 'Refunds take five days. [1]',
        insufficientContext: false,
        citations: [
          {
            n: 1,
            chunkId: 'k1',
            documentId: 'd1',
            title: 'Refund policy',
            url: 'https://help.example.com/refunds',
          },
        ],
      },
      error: null,
      createdAt: '2026-11-18T10:00:00Z',
    };
    const calls = mockApi({
      ...routes({ ...DETAIL, suggestedRepliesEnabled: true }),
      [`POST /api/v1/workspaces/${WS}/conversations/${CID}/agent-assist/suggested-reply`]: [
        200,
        artifact,
      ],
    });
    renderWithQuery(<ConversationDetail workspaceId={WS} conversationId={CID} />);

    await userEvent.click(
      await screen.findByRole('button', { name: strings.conversations.detail.suggestReply }),
    );
    expect(await screen.findByText('Refunds take five days. [1]')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Refund policy' })).toHaveAttribute(
      'href',
      'https://help.example.com/refunds',
    );
    await userEvent.click(
      screen.getByRole('button', { name: strings.conversations.detail.insertSuggestion }),
    );

    expect(screen.getByLabelText(strings.conversations.detail.composer)).toHaveValue(
      'Refunds take five days. [1]',
    );
    expect(calls.some((call) => call.method === 'POST' && call.url.endsWith('/messages'))).toBe(
      false,
    );
  });

  it('adds a workspace-visible internal note without sending or appending a customer message', async () => {
    const note = {
      id: '0193a111-2222-7333-8444-555555555567',
      conversationId: '0193a111-2222-7333-8444-555555555568',
      author: { id: '0193a111-2222-7333-8444-555555555569', name: 'Ada Agent' },
      body: 'Check the order dashboard.',
      version: 1,
      createdAt: '2026-11-18T10:00:00Z',
      updatedAt: '2026-11-18T10:00:00Z',
      deletedAt: null,
      deletedBy: null,
    };
    const calls = mockApi({
      ...routes(),
      [`GET /api/v1/workspaces/${WS}/conversations/${CID}/internal-notes`]: [200, [note]],
      [`POST /api/v1/workspaces/${WS}/conversations/${CID}/internal-notes`]: [201, note],
    });
    renderWithQuery(<ConversationDetail workspaceId={WS} conversationId={CID} />);

    expect(await screen.findByText('Check the order dashboard.')).toBeInTheDocument();
    expect(screen.getByText(strings.conversations.detail.internalNotesWarning)).toBeInTheDocument();
    await userEvent.type(
      screen.getByLabelText(strings.conversations.detail.internalNoteComposer),
      'Check the order dashboard.',
    );
    await userEvent.click(
      screen.getByRole('button', { name: strings.conversations.detail.addInternalNote }),
    );
    await waitFor(() => {
      expect(
        calls.some(
          (call) =>
            call.method === 'POST' &&
            call.url.endsWith('/internal-notes') &&
            JSON.stringify(call.body).includes('Check the order dashboard.'),
        ),
      ).toBe(true);
    });
    expect(calls.some((call) => call.method === 'POST' && call.url.endsWith('/messages'))).toBe(
      false,
    );
  });

  it('blocks inserting a suggestion when newer messages make it stale', async () => {
    const artifact = {
      id: '0193a111-2222-7333-8444-555555555562',
      kind: 'suggested_reply',
      state: 'ready',
      sourceThroughMessageId: '0193a111-2222-7333-8444-555555555563',
      promptVersion: 'suggested-reply-v1',
      traceId: '0193a111-2222-7333-8444-555555555564',
      content: { draft: 'Old suggestion', insufficientContext: false, citations: [] },
      error: null,
      createdAt: '2026-11-18T10:00:00Z',
    };
    mockApi({
      ...routes({ ...DETAIL, suggestedRepliesEnabled: true }),
      [`POST /api/v1/workspaces/${WS}/conversations/${CID}/agent-assist/suggested-reply`]: [
        200,
        artifact,
      ],
    });
    renderWithQuery(<ConversationDetail workspaceId={WS} conversationId={CID} />);

    await userEvent.click(
      await screen.findByRole('button', { name: strings.conversations.detail.suggestReply }),
    );
    expect(
      await screen.findByText(strings.conversations.detail.suggestionStale),
    ).toBeInTheDocument();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await userEvent.click(
      screen.getByRole('button', { name: strings.conversations.detail.useStaleSuggestion }),
    );
    expect(screen.getByLabelText(strings.conversations.detail.composer)).toHaveValue(
      'Old suggestion',
    );
  });

  it('labels a stale handoff summary and regenerates it as an explicit agent action', async () => {
    const artifact: NonNullable<Detail['handoffSummary']> = {
      id: '0193a111-2222-7333-8444-555555555556',
      kind: 'handoff_summary',
      state: 'ready',
      sourceThroughMessageId: '0193a111-2222-7333-8444-555555555557',
      promptVersion: 'handoff-summary-v1',
      traceId: '0193a111-2222-7333-8444-555555555558',
      content: {
        issue: 'Refund delay',
        actionsAttempted: ['Checked order status'],
        customerFacts: [],
        sentimentUrgency: [],
        unresolvedQuestion: 'When will it arrive?',
      },
      error: null,
      createdAt: '2026-11-15T10:02:00Z',
    };
    const calls = mockApi({
      ...routes({ ...DETAIL, handoffSummaryEnabled: true, handoffSummary: artifact }),
      [`POST /api/v1/workspaces/${WS}/conversations/${CID}/agent-assist/handoff-summary`]: [
        201,
        {
          ...artifact,
          id: '0193a111-2222-7333-8444-555555555559',
          state: 'queued',
          content: null,
          traceId: null,
        },
      ],
    });
    renderWithQuery(<ConversationDetail workspaceId={WS} conversationId={CID} />);

    expect(await screen.findByText('Refund delay')).toBeInTheDocument();
    expect(screen.getByText('This summary may be out of date.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Regenerate summary' }));
    await waitFor(() => {
      expect(
        calls.some(
          (call) => call.method === 'POST' && call.url.endsWith('/agent-assist/handoff-summary'),
        ),
      ).toBe(true);
    });
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
