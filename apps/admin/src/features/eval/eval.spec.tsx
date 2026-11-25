// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createCase: vi.fn() }));

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
  usePromptVersions: () => ({ data: [] }),
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
    data: { data: [], nextCursor: null },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useEvalRuns: () => ({ data: { data: [] }, isError: false, refetch: vi.fn() }),
  useEvalResults: () => ({ data: { data: [] }, isPending: false, isError: false }),
  useEvalRun: () => ({ data: undefined }),
  useCreateEvalDataset: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateEvalCase: () => ({ mutate: mocks.createCase, isPending: false }),
  useStartEvalRun: () => ({ mutate: vi.fn(), isPending: false }),
  useSetEvalGate: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { WorkspaceRoleProvider } from '@/components/role-gate';
import { renderWithQuery } from '@/test/render';

import { EvaluatePage } from './evaluate-page';

describe('EvaluatePage', () => {
  beforeEach(() => mocks.createCase.mockReset());

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
