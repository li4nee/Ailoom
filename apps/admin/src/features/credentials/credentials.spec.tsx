// SPDX-License-Identifier: AGPL-3.0-only
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { WorkspaceRoleProvider } from '@/components/role-gate';
import { strings } from '@/strings';
import { apiError, mockApi } from '@/test/fetch';
import { renderWithQuery } from '@/test/render';
import type { CredentialDto, Role } from '@app/shared';

import { CredentialForm } from './components/credential-form';
import { CredentialList } from './components/credential-list';

const WS = 'w1';

const OPENAI: CredentialDto = {
  id: 'c-openai',
  provider: 'openai',
  label: 'Production',
  secretLast4: '1234',
  baseUrl: null,
  lastUsedAt: null,
  lastErrorAt: null,
  lastError: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const LOCAL: CredentialDto = {
  ...OPENAI,
  id: 'c-local',
  provider: 'local',
  label: 'Built-in (local)',
  secretLast4: null,
};

// Through a variable: the a11y lint reads a literal `role` prop as an ARIA role.
const ADMIN: Role = 'admin';

function asAdmin(ui: React.ReactElement): React.ReactElement {
  return <WorkspaceRoleProvider role={ADMIN}>{ui}</WorkspaceRoleProvider>;
}

describe('CredentialForm', () => {
  it('shows the API key only for key providers and the base URL only for endpoint providers', async () => {
    mockApi({});
    renderWithQuery(<CredentialForm workspaceId={WS} />);

    expect(screen.getByLabelText(strings.credentials.apiKey)).toBeInTheDocument();
    expect(screen.queryByLabelText(strings.credentials.baseUrl)).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText(strings.credentials.provider), 'ollama');

    expect(screen.getByLabelText(strings.credentials.baseUrl)).toBeInTheDocument();
    expect(screen.queryByLabelText(strings.credentials.apiKey)).not.toBeInTheDocument();
  });

  it('never pre-fills the key on edit and shows the stored last4 as a placeholder', () => {
    mockApi({});
    renderWithQuery(<CredentialForm workspaceId={WS} credential={OPENAI} />);

    const key = screen.getByLabelText(strings.credentials.apiKey);
    expect(key).toHaveAttribute('type', 'password');
    expect(key).toHaveAttribute('autocomplete', 'off');
    expect(key).toHaveValue('');
    expect(key).toHaveAttribute('placeholder', strings.credentials.apiKeyKeep('1234'));
    // The provider of an existing credential is not changeable.
    expect(screen.queryByLabelText(strings.credentials.provider)).not.toBeInTheDocument();
  });
});

describe('CredentialList', () => {
  it('shows the built-in local credential as read-only', async () => {
    mockApi({ [`GET /api/v1/workspaces/${WS}/credentials`]: [200, [LOCAL, OPENAI]] });
    renderWithQuery(asAdmin(<CredentialList workspaceId={WS} />));

    const builtIn = (await screen.findByText(strings.credentials.builtIn)).closest('tr');
    if (builtIn === null) throw new Error('no row');
    expect(within(builtIn).queryByRole('button', { name: strings.credentials.edit })).toBeNull();
    expect(within(builtIn).queryByRole('button', { name: strings.credentials.delete })).toBeNull();

    const keyed = screen.getByText(OPENAI.label).closest('tr');
    if (keyed === null) throw new Error('no row');
    expect(within(keyed).getByRole('button', { name: strings.credentials.edit })).toBeVisible();
  });

  it('links every provider to its documentation page', async () => {
    mockApi({ [`GET /api/v1/workspaces/${WS}/credentials`]: [200, [OPENAI]] });
    renderWithQuery(asAdmin(<CredentialList workspaceId={WS} />));

    const link = await screen.findByRole('link', {
      name: strings.credentials.providers.openai,
    });
    expect(link).toHaveAttribute('href', '/docs/providers/openai');
  });

  it('reports a successful connection test', async () => {
    mockApi({
      [`GET /api/v1/workspaces/${WS}/credentials`]: [200, [OPENAI]],
      [`POST /api/v1/workspaces/${WS}/credentials/c-openai/test`]: [200, { ok: true }],
    });
    renderWithQuery(asAdmin(<CredentialList workspaceId={WS} />));

    await userEvent.click(await screen.findByRole('button', { name: strings.credentials.test }));

    expect(await screen.findByText(strings.credentials.testOk)).toBeInTheDocument();
  });

  it('shows the error code wording and the hint when a test fails', async () => {
    mockApi({
      [`GET /api/v1/workspaces/${WS}/credentials`]: [200, [OPENAI]],
      [`POST /api/v1/workspaces/${WS}/credentials/c-openai/test`]: [
        200,
        { ok: false, code: 'auth_failed', hint: 'Check the key.' },
      ],
    });
    renderWithQuery(asAdmin(<CredentialList workspaceId={WS} />));

    await userEvent.click(await screen.findByRole('button', { name: strings.credentials.test }));

    expect(
      await screen.findByText(
        strings.credentials.testFailed(`${strings.credentials.errors.auth_failed} Check the key.`),
      ),
    ).toBeInTheDocument();
  });

  it('explains when a credential cannot be deleted because a bot uses it', async () => {
    mockApi({
      [`GET /api/v1/workspaces/${WS}/credentials`]: [200, [OPENAI]],
      [`DELETE /api/v1/workspaces/${WS}/credentials/c-openai`]: [
        409,
        apiError('credential_in_use'),
      ],
    });
    renderWithQuery(asAdmin(<CredentialList workspaceId={WS} />));

    const row = (await screen.findByText(OPENAI.label)).closest('tr');
    if (row === null) throw new Error('no row');
    await userEvent.click(within(row).getByRole('button', { name: strings.credentials.delete }));

    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: strings.credentials.delete }));

    await waitFor(() => {
      expect(screen.getByText(strings.credentials.inUse)).toBeInTheDocument();
    });
  });
});
