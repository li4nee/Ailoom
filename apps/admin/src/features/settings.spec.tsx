// SPDX-License-Identifier: AGPL-3.0-only
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { RoleGate, WorkspaceRoleProvider } from '@/components/role-gate';
import { strings } from '@/strings';
import { apiError, mockApi } from '@/test/fetch';
import { renderWithQuery } from '@/test/render';
import type { Role } from '@app/shared';

import { DeleteAccount } from './account/components/delete-account';
import { SessionsPanel } from './account/components/sessions-panel';
import { InstanceSettingsPanel } from './instance/components/instance-settings-panel';
import { InvitationsPanel } from './members/components/invitations-panel';
import { MembersPanel } from './members/components/members-panel';

const WS = 'w1';
const MEMBERS = [
  {
    userId: 'u-owner',
    email: 'owner@example.com',
    name: 'Olive',
    role: 'owner',
    joinedAt: '2026-01-01T00:00:00Z',
  },
  {
    userId: 'u-admin',
    email: 'admin@example.com',
    name: null,
    role: 'admin',
    joinedAt: '2026-01-02T00:00:00Z',
  },
  {
    userId: 'u-agent',
    email: 'agent@example.com',
    name: null,
    role: 'agent',
    joinedAt: '2026-01-03T00:00:00Z',
  },
];

function asRole(role: Role, ui: React.ReactElement): React.ReactElement {
  return <WorkspaceRoleProvider role={role}>{ui}</WorkspaceRoleProvider>;
}

describe('RoleGate', () => {
  it('renders children only when the role is high enough', () => {
    renderWithQuery(
      asRole(
        'admin',
        <>
          <RoleGate min="agent">
            <span>agent-content</span>
          </RoleGate>
          <RoleGate min="admin">
            <span>admin-content</span>
          </RoleGate>
          <RoleGate min="owner">
            <span>owner-content</span>
          </RoleGate>
        </>,
      ),
    );

    expect(screen.getByText('agent-content')).toBeInTheDocument();
    expect(screen.getByText('admin-content')).toBeInTheDocument();
    expect(screen.queryByText('owner-content')).not.toBeInTheDocument();
  });
});

describe('MembersPanel', () => {
  it('agents get an admins-only notice and the list is never requested', () => {
    const calls = mockApi({});
    renderWithQuery(asRole('agent', <MembersPanel workspaceId={WS} currentUserId="u-agent" />));

    expect(screen.getByText(strings.members.listAdminsOnly)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('owner sees "Transfer ownership"; admins do not', async () => {
    mockApi({ [`GET /api/v1/workspaces/${WS}/members`]: [200, MEMBERS] });
    const { unmount } = renderWithQuery(
      asRole('owner', <MembersPanel workspaceId={WS} currentUserId="u-owner" />),
    );
    expect(
      await screen.findAllByRole('button', { name: strings.members.transferOwnership }),
    ).toHaveLength(4);
    unmount();

    renderWithQuery(asRole('admin', <MembersPanel workspaceId={WS} currentUserId="u-admin" />));
    await screen.findAllByText('agent@example.com');
    expect(
      screen.queryByRole('button', { name: strings.members.transferOwnership }),
    ).not.toBeInTheDocument();
  });

  it('removing a member asks for confirmation in a dialog', async () => {
    const calls = mockApi({
      [`GET /api/v1/workspaces/${WS}/members`]: [200, MEMBERS],
      [`DELETE /api/v1/workspaces/${WS}/members/u-agent`]: [204],
    });
    const confirmSpy = vi.spyOn(window, 'confirm');
    renderWithQuery(asRole('admin', <MembersPanel workspaceId={WS} currentUserId="u-admin" />));

    const row = (await screen.findAllByText('agent@example.com'))[0]!.closest('li');
    if (row === null) throw new Error('no row');
    await userEvent.click(within(row).getByRole('button', { name: strings.members.remove }));

    const dialog = await screen.findByRole('dialog');
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    await userEvent.click(within(dialog).getByRole('button', { name: strings.members.remove }));

    await waitFor(() => {
      expect(calls.some((c) => c.method === 'DELETE')).toBe(true);
    });
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});

describe('InvitationsPanel', () => {
  it('agents cannot invite', async () => {
    mockApi({ [`GET /api/v1/workspaces/${WS}/invitations`]: [200, []] });
    renderWithQuery(asRole('agent', <InvitationsPanel workspaceId={WS} />));

    expect(await screen.findByText(strings.members.adminsOnly)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: strings.members.invite })).not.toBeInTheDocument();
  });

  it('admins invite and see the link to share', async () => {
    const calls = mockApi({
      [`GET /api/v1/workspaces/${WS}/invitations`]: [200, []],
      [`POST /api/v1/workspaces/${WS}/invitations`]: [
        201,
        {
          id: 'i1',
          email: 'bob@example.com',
          role: 'agent',
          invitedBy: 'u-admin',
          expiresAt: '2026-01-08T00:00:00Z',
          acceptUrl: 'http://localhost/invitations/accept?token=t',
        },
      ],
    });
    renderWithQuery(asRole('admin', <InvitationsPanel workspaceId={WS} />));

    await userEvent.type(await screen.findByLabelText(strings.auth.email), 'bob@example.com');
    await userEvent.click(screen.getByRole('button', { name: strings.members.invite }));

    expect(
      await screen.findByDisplayValue('http://localhost/invitations/accept?token=t'),
    ).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      email: 'bob@example.com',
      role: 'agent',
    });
  });
});

describe('InvitationsPanel with email delivery', () => {
  it('confirms the email was sent and shows no link', async () => {
    mockApi({
      [`GET /api/v1/workspaces/${WS}/invitations`]: [200, []],
      [`POST /api/v1/workspaces/${WS}/invitations`]: [
        201,
        {
          id: 'i1',
          email: 'bob@example.com',
          role: 'agent',
          invitedBy: 'u-admin',
          expiresAt: '2026-01-08T00:00:00Z',
          acceptUrl: null,
        },
      ],
    });
    renderWithQuery(asRole('admin', <InvitationsPanel workspaceId={WS} />));

    await userEvent.type(await screen.findByLabelText(strings.auth.email), 'bob@example.com');
    await userEvent.click(screen.getByRole('button', { name: strings.members.invite }));

    expect(
      await screen.findByText(strings.members.invitationSent('bob@example.com')),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(strings.members.shareLink)).not.toBeInTheDocument();
  });
});

describe('SessionsPanel', () => {
  const SESSIONS = [
    {
      sessionId: 's1',
      userAgent: 'Firefox',
      ip: '203.0.113.1',
      lastUsedAt: null,
      createdAt: '2026-01-01T00:00:00Z',
      current: true,
    },
    {
      sessionId: 's2',
      userAgent: 'Safari',
      ip: '203.0.113.2',
      lastUsedAt: null,
      createdAt: '2026-01-02T00:00:00Z',
      current: false,
    },
  ];

  it('marks the current session', async () => {
    mockApi({ 'GET /api/v1/auth/sessions': [200, SESSIONS] });
    renderWithQuery(<SessionsPanel onLoggedOut={vi.fn()} />);

    const table = await screen.findByRole('table');
    const current = within(table).getByText('Firefox').closest('tr');
    if (current === null) throw new Error('no row');
    expect(within(current).getByText(strings.account.thisDevice)).toBeInTheDocument();
    const other = within(table).getByText('Safari').closest('tr');
    if (other === null) throw new Error('no row');
    expect(within(other).queryByText(strings.account.thisDevice)).not.toBeInTheDocument();
  });

  it('"Log out everywhere" calls /logout-all, then hands over to the login page', async () => {
    const calls = mockApi({
      'GET /api/v1/auth/sessions': [200, SESSIONS],
      'POST /api/v1/auth/logout-all': [204],
    });
    const onLoggedOut = vi.fn();
    renderWithQuery(<SessionsPanel onLoggedOut={onLoggedOut} />);

    await userEvent.click(
      await screen.findByRole('button', { name: strings.account.logOutEverywhere }),
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(
      within(dialog).getByRole('button', { name: strings.account.logOutEverywhere }),
    );

    await waitFor(() => {
      expect(onLoggedOut).toHaveBeenCalledOnce();
    });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toContain('POST /api/v1/auth/logout-all');
  });
});

describe('DeleteAccount', () => {
  it('shows the sole-owner explanation', async () => {
    mockApi({ 'DELETE /api/v1/auth/me': [409, apiError('sole_owner')] });
    renderWithQuery(<DeleteAccount onDeleted={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: strings.account.deleteAccount }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(strings.auth.password), 'my password');
    await userEvent.click(
      within(dialog).getByRole('button', { name: strings.account.deleteAccount }),
    );

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(strings.account.soleOwner);
  });
});

describe('InstanceSettingsPanel', () => {
  it('is not available to non-admins', () => {
    mockApi({});
    renderWithQuery(<InstanceSettingsPanel isInstanceAdmin={false} />);

    expect(screen.getByText(strings.instance.notAllowed)).toBeInTheDocument();
  });

  it('shows the signup mode to instance admins', async () => {
    mockApi({
      'GET /api/v1/instance/settings': [
        200,
        { signupMode: 'invite', signupModeSource: 'env', emailEnabled: true },
      ],
    });
    renderWithQuery(<InstanceSettingsPanel isInstanceAdmin />);

    expect(await screen.findByLabelText(strings.instance.signupMode)).toHaveValue('invite');
  });
});
