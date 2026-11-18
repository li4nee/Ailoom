// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { WorkspaceRoleProvider } from '@/components/role-gate';
import { strings } from '@/strings';
import { mockApi } from '@/test/fetch';
import { renderWithQuery } from '@/test/render';
import type { BotDto, Role, TestRetrievalResponse } from '@app/shared';

import { TestRetrievalPanel } from './components/test-retrieval-panel';

const WS = 'w1';
const BOT = 'b1';
const ADMIN: Role = 'admin';

const BOT_DTO: BotDto = {
  id: BOT,
  name: 'Help',
  publicKey: 'pk_live_abc',
  allowedOrigins: [],
  chatCredentialId: 'c1',
  chatModel: 'mock-chat',
  embeddingCredentialId: 'c2',
  embeddingModel: 'mock-embed',
  embeddingDim: 384,
  pendingEmbeddingModel: null,
  lastError: null,
  activePromptVersionId: 'v1',
  retrievalThreshold: 0.35,
  noAnswerBehavior: 'offer_handoff',
  handoffEnabled: true,
  automaticHandoffSummaries: false,
  suggestedRepliesEnabled: false,
  agentAssistEnabled: false,
  temperature: 0.2,
  maxOutputTokens: 600,
  monthlySpendCapUsd: null,
  requireChallenge: false,
  allowedLinkDomains: [],
  handoffPhrases: null,
  fallbackMessage: 'No answer.',
  handoffMessage: 'We will reply.',
  appearance: {
    displayName: 'Help',
    themeColor: '#2563eb',
    position: 'right',
    welcomeMessage: 'Hi',
    avatarUrl: null,
    privacyUrl: null,
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const RESPONSE: TestRetrievalResponse = {
  embeddingModel: 'mock-embed',
  threshold: 0.35,
  results: [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2].map((score, index) => ({
    rank: index + 1,
    score,
    used: false,
    chunkId: `c${String(index + 1)}`,
    documentId: 'd1',
    title: 'Refund policy',
    url: null,
    headingPath: '# Refunds',
    preview: `Chunk ${String(index + 1)}`,
  })),
};

function renderPanel() {
  return renderWithQuery(
    <WorkspaceRoleProvider role={ADMIN}>
      <TestRetrievalPanel workspaceId={WS} botId={BOT} />
    </WorkspaceRoleProvider>,
  );
}

function routes(): Record<string, [number, unknown?]> {
  return {
    [`GET /api/v1/workspaces/${WS}/bots/${BOT}`]: [200, BOT_DTO],
    [`POST /api/v1/workspaces/${WS}/bots/${BOT}/test-retrieval`]: [200, RESPONSE],
  };
}

describe('test retrieval panel', () => {
  it('shows rank, three-decimal scores, used markers and the threshold line', async () => {
    mockApi(routes());
    renderPanel();

    await userEvent.type(
      await screen.findByLabelText(strings.knowledge.test.query),
      'How do refunds work?',
    );
    await userEvent.click(screen.getByRole('button', { name: strings.knowledge.test.run }));

    expect(await screen.findByText('0.900')).toBeInTheDocument();
    expect(screen.getByText('0.200')).toBeInTheDocument();
    expect(screen.getAllByText(strings.knowledge.test.used)).toHaveLength(5);
    expect(screen.getAllByText(strings.knowledge.test.unused)).toHaveLength(3);
    expect(screen.getByRole('separator')).toBeInTheDocument();
    expect(screen.getByText(/mock-embed/)).toBeInTheDocument();
  });

  it('recomputes used from the slider with the shared rule and offers to save', async () => {
    mockApi(routes());
    renderPanel();

    await userEvent.type(
      await screen.findByLabelText(strings.knowledge.test.query),
      'How do refunds work?',
    );
    await userEvent.click(screen.getByRole('button', { name: strings.knowledge.test.run }));
    await screen.findByText('0.900');

    fireEvent.change(screen.getByLabelText(/Threshold/), { target: { value: '0.65' } });

    await waitFor(() => {
      expect(screen.getAllByText(strings.knowledge.test.used)).toHaveLength(3);
    });
    expect(screen.getByRole('button', { name: strings.knowledge.test.save })).toBeInTheDocument();
  });
});
