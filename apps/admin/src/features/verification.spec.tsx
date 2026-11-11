// SPDX-License-Identifier: AGPL-3.0-only
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { strings } from '@/strings';
import { apiError, mockApi } from '@/test/fetch';
import { renderWithQuery } from '@/test/render';

import { VerifyEmailBanner } from './auth/components/verify-email-banner';
import { CreateWorkspaceForm } from './workspaces/components/create-workspace-form';

describe('VerifyEmailBanner', () => {
  it('resends the verification email', async () => {
    const calls = mockApi({ 'POST /api/v1/auth/resend-verification': [204] });
    renderWithQuery(<VerifyEmailBanner emailVerified={false} />);

    await userEvent.click(screen.getByRole('button', { name: strings.auth.resendVerification }));

    expect(await screen.findByText(strings.auth.verificationResent)).toBeInTheDocument();
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST /api/v1/auth/resend-verification',
    ]);
  });

  it('is hidden once the email is verified', () => {
    mockApi({});
    renderWithQuery(<VerifyEmailBanner emailVerified />);

    expect(screen.queryByText(strings.auth.notVerified)).not.toBeInTheDocument();
  });
});

describe('CreateWorkspaceForm', () => {
  it('explains that the email must be verified first', async () => {
    mockApi({ 'POST /api/v1/workspaces': [403, apiError('email_not_verified')] });
    renderWithQuery(<CreateWorkspaceForm onCreated={vi.fn()} />);

    await userEvent.type(screen.getByLabelText(strings.workspaces.name), 'Acme');
    await userEvent.click(screen.getByRole('button', { name: strings.workspaces.create }));

    expect(await screen.findByRole('alert')).toHaveTextContent(strings.workspaces.verifyFirst);
  });
});
