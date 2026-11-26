// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createCase: vi.fn(),
  startRun: vi.fn(),
  cases: vi.fn(),
  runs: vi.fn(),
}));

vi.mock('@/features/bots/api', () => ({
  useBot: () => ({
    data: {
      id: 'bot-1',
      name: 'Support',
      chatCredentialId: 'cred-1',
      chatModel: 'mock-chat',
      retrievalMode: 'vector',
      retrievalThreshold: 0.3,
      embeddingCredentialId: 'embed-1',
      embeddingModel: 'mock-embed',
      embeddingDim: 384,
      activePromptVersionId: 'prompt-1',
      evalGate: null,
    },
  }),
  usePromptVersions: () => ({ data: [{ id: 'draft-2', version: 2 }] }),
}));
vi.mock('@/features/credentials/api', () => ({
  useCredentials: () => ({ data: [{ id: 'cred-1', label: 'Mock', provider: 'mock' }] }),
}));
vi.mock('./api', () => ({
  useEvalDatasets: () => ({
    data: [{ id: 'dataset-1', name: 'Smoke', caseCount: 0 }],
    isPending: false,
  }),
  useEvalCases: () => ({
    data: { data: mocks.cases() as unknown[], nextCursor: null },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useEvalRuns: () => ({
    data: { data: mocks.runs() as unknown[] },
    isError: false,
    refetch: vi.fn(),
  }),
  useEvalResults: () => ({ data: { data: [] }, isPending: false, isError: false }),
  useEvalRun: () => ({ data: undefined }),
  useCreateEvalDataset: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateEvalCase: () => ({ mutate: mocks.createCase, isPending: false }),
  useStartEvalRun: () => ({ mutate: mocks.startRun, isPending: false }),
  useSetEvalGate: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { WorkspaceRoleProvider } from '@/components/role-gate';
import { renderWithQuery } from '@/test/render';

import { EvaluatePage } from './evaluate-page';

describe('EvaluatePage', () => {
  beforeEach(() => {
    mocks.createCase.mockReset();
    mocks.startRun.mockReset();
    mocks.cases.mockReset().mockReturnValue([]);
    mocks.runs.mockReset().mockReturnValue([]);
  });

  it('starts an evaluation against the linked draft version', () => {
    mocks.cases.mockReturnValue([
      {
        id: 'case-1',
        question: 'How long does shipping take?',
        expectedAnswer: 'Two days.',
        toolFixtures: [],
      },
    ]);
    renderWithQuery(
      // eslint-disable-next-line jsx-a11y/aria-role
      <WorkspaceRoleProvider role="admin">
        <EvaluatePage
          workspaceId="ws-1"
          botId="bot-1"
          selection={{ datasetId: 'dataset-1', promptVersionId: 'draft-2' }}
        />
      </WorkspaceRoleProvider>,
    );

    expect(screen.getByLabelText('Prompt version')).toHaveValue('draft-2');
    fireEvent.click(screen.getByRole('button', { name: 'Start run' }));
    expect(mocks.startRun).toHaveBeenCalledWith(
      {
        promptVersionId: 'draft-2',
        judgeCredentialId: 'cred-1',
        judgeModel: 'mock-chat',
        retrievalMode: 'vector',
      },
      expect.any(Object),
    );
  });

  it('lets an admin choose a compatible run from the other retrieval mode', () => {
    mocks.cases.mockReturnValue([
      {
        id: 'case-1',
        question: 'How long does shipping take?',
        expectedAnswer: 'Two days.',
        toolFixtures: [],
      },
    ]);
    mocks.runs.mockReturnValue([
      {
        id: 'vector-run-1',
        status: 'completed',
        createdAt: '2026-11-26T00:00:00.000Z',
        casesDone: 1,
        casesTotal: 1,
        costUsd: 0,
        config: {
          retrievalMode: 'vector',
          comparisonOnly: false,
          promptVersionId: 'prompt-1',
          chatCredentialId: 'cred-1',
          chatModel: 'mock-chat',
          retrievalThreshold: 0.3,
          judgeCredentialId: 'cred-1',
          judgeModel: 'mock-chat',
          embeddingCredentialId: 'embed-1',
          embeddingModel: 'mock-embed',
          embeddingDim: 384,
        },
        summary: { passRate: 1, inconclusive: false },
      },
    ]);
    renderWithQuery(
      // eslint-disable-next-line jsx-a11y/aria-role
      <WorkspaceRoleProvider role="admin">
        <EvaluatePage workspaceId="ws-1" botId="bot-1" selection={{ datasetId: 'dataset-1' }} />
      </WorkspaceRoleProvider>,
    );

    fireEvent.change(screen.getByLabelText('Retrieval mode'), { target: { value: 'hybrid' } });
    fireEvent.change(screen.getByLabelText('Compare against'), {
      target: { value: 'vector-run-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start run' }));

    expect(mocks.startRun).toHaveBeenCalledWith(
      {
        judgeCredentialId: 'cred-1',
        judgeModel: 'mock-chat',
        retrievalMode: 'hybrid',
        baselineRunId: 'vector-run-1',
      },
      expect.any(Object),
    );
  });

  it('requires a question and at least one expectation before adding a case', () => {
    // The provider's `role` prop is a workspace role, not an ARIA role.
    renderWithQuery(
      // eslint-disable-next-line jsx-a11y/aria-role
      <WorkspaceRoleProvider role="admin">
        <EvaluatePage workspaceId="ws-1" botId="bot-1" />
      </WorkspaceRoleProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add case' }));
    expect(screen.getByText('Enter a question and an expected answer.')).toBeTruthy();
    expect(mocks.createCase).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Question'), {
      target: { value: 'How long does shipping take?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add case' }));
    expect(screen.getByText('Enter a question and an expected answer.')).toBeTruthy();
    expect(mocks.createCase).not.toHaveBeenCalled();
  });
});
