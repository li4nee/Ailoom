// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createCase: vi.fn(),
  startRun: vi.fn(),
  cases: vi.fn(),
}));

vi.mock('@/features/bots/api', () => ({
  useBot: () => ({
    data: {
      id: 'bot-1',
      name: 'Support',
      chatCredentialId: 'cred-1',
      chatModel: 'mock-chat',
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
  useEvalRuns: () => ({ data: { data: [] }, isError: false, refetch: vi.fn() }),
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
      { promptVersionId: 'draft-2', judgeCredentialId: 'cred-1', judgeModel: 'mock-chat' },
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
