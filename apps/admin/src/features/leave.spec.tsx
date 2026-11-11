// SPDX-License-Identifier: AGPL-3.0-only
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { WorkspaceRoleProvider } from '@/components/role-gate';
import { strings } from '@/strings';
import { mockApi } from '@/test/fetch';
import { renderWithQuery } from '@/test/render';
import type { Role } from '@app/shared';

import { LeaveWorkspace } from './members/components/leave-workspace';

// Variables, not literals: jsx-a11y reads a literal `role` prop as an ARIA role.
const AGENT: Role = 'agent';
const OWNER: Role = 'owner';

describe('LeaveWorkspace', () => {
  it('lets a non-owner leave after confirming', async () => {
    const calls = mockApi({ 'DELETE /api/v1/workspaces/w1/members/u1': [204] });
    const onLeft = vi.fn();
    renderWithQuery(
      <WorkspaceRoleProvider role={AGENT}>
        <LeaveWorkspace workspaceId="w1" userId="u1" onLeft={onLeft} />
      </WorkspaceRoleProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: strings.members.leave }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: strings.members.leave }));

    await waitFor(() => {
      expect(onLeft).toHaveBeenCalledOnce();
    });
    expect(calls.map((c) => c.method)).toEqual(['DELETE']);
  });

  it('is not offered to the owner', () => {
    mockApi({});
    renderWithQuery(
      <WorkspaceRoleProvider role={OWNER}>
        <LeaveWorkspace workspaceId="w1" userId="u1" onLeft={vi.fn()} />
      </WorkspaceRoleProvider>,
    );

    expect(screen.queryByRole('button', { name: strings.members.leave })).not.toBeInTheDocument();
  });
});
