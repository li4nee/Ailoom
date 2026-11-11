// SPDX-License-Identifier: AGPL-3.0-only
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { strings } from '@/strings';
import { apiError, mockApi } from '@/test/fetch';
import { renderWithQuery } from '@/test/render';

import { InvitePanel } from './components/invite-panel';
import { LoginForm } from './components/login-form';
import { ResetPasswordForm } from './components/reset-password-form';
import { SignupForm } from './components/signup-form';
import { VerifyEmail } from './components/verify-email';
import { safeNext } from './safe-next';

const ME = {
  id: 'u1',
  email: 'alice@example.com',
  name: null,
  emailVerified: true,
  isInstanceAdmin: false,
  memberships: [],
};

const OPEN = { signupMode: 'open', firstUser: false, emailEnabled: true };

describe('safeNext', () => {
  it('keeps same-site paths and rejects everything else', () => {
    expect(safeNext('/w/1/settings?tab=a')).toBe('/w/1/settings?tab=a');
    expect(safeNext(undefined)).toBe('/');
    expect(safeNext('https://evil.example')).toBe('/');
    expect(safeNext('//evil.example')).toBe('/');
    expect(safeNext('/\\evil.example')).toBe('/');
  });
});

describe('LoginForm', () => {
  it('shows the invalid credentials message on a wrong password', async () => {
    mockApi({ 'POST /api/v1/auth/login': [401, apiError('invalid_credentials')] });
    const onSuccess = vi.fn();
    renderWithQuery(<LoginForm onSuccess={onSuccess} />);

    await userEvent.type(screen.getByLabelText(strings.auth.email), 'alice@example.com');
    await userEvent.type(screen.getByLabelText(strings.auth.password), 'wrong password');
    await userEvent.click(screen.getByRole('button', { name: strings.auth.logIn }));

    expect(await screen.findByRole('alert')).toHaveTextContent(strings.auth.invalidCredentials);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('calls onSuccess after a successful login', async () => {
    const calls = mockApi({ 'POST /api/v1/auth/login': [200, ME] });
    const onSuccess = vi.fn();
    renderWithQuery(<LoginForm onSuccess={onSuccess} />);

    await userEvent.type(screen.getByLabelText(strings.auth.email), 'alice@example.com');
    await userEvent.type(screen.getByLabelText(strings.auth.password), 'correct horse battery');
    await userEvent.click(screen.getByRole('button', { name: strings.auth.logIn }));

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledOnce();
    });
    expect(calls[0]?.body).toEqual({
      email: 'alice@example.com',
      password: 'correct horse battery',
    });
  });
});

describe('SignupForm', () => {
  async function fillAndSubmit(): Promise<void> {
    await userEvent.type(await screen.findByLabelText(strings.auth.email), 'bob@example.com');
    await userEvent.type(screen.getByLabelText(strings.auth.password), 'password1234');
    await userEvent.click(screen.getByRole('button', { name: strings.auth.signUp }));
  }

  it('renders one message per password problem', async () => {
    mockApi({
      'GET /api/v1/instance/public': [200, OPEN],
      'POST /api/v1/auth/signup': [
        400,
        apiError('password_policy', [
          { path: 'password', message: 'too_common' },
          { path: 'password', message: 'contains_email' },
        ]),
      ],
    });
    renderWithQuery(<SignupForm onSuccess={vi.fn()} />);

    await fillAndSubmit();

    expect(await screen.findByText(strings.auth.passwordProblems.too_common)).toBeInTheDocument();
    expect(screen.getByText(strings.auth.passwordProblems.contains_email)).toBeInTheDocument();
  });

  it('shows the closed notice when signup is closed', async () => {
    mockApi({
      'GET /api/v1/instance/public': [200, OPEN],
      'POST /api/v1/auth/signup': [403, apiError('signup_closed')],
    });
    renderWithQuery(<SignupForm onSuccess={vi.fn()} />);

    await fillAndSubmit();

    expect(await screen.findByRole('alert')).toHaveTextContent(strings.auth.signupClosed);
  });

  it('shows the first-user hint on an empty instance', async () => {
    mockApi({ 'GET /api/v1/instance/public': [200, { ...OPEN, firstUser: true }] });
    renderWithQuery(<SignupForm onSuccess={vi.fn()} />);

    expect(await screen.findByText(strings.auth.firstUserHint)).toBeInTheDocument();
  });

  it('sends the invitation token along', async () => {
    const calls = mockApi({
      'GET /api/v1/instance/public': [200, OPEN],
      'POST /api/v1/auth/signup': [201, { id: 'u2' }],
    });
    const onSuccess = vi.fn();
    renderWithQuery(<SignupForm invitationToken="tok" onSuccess={onSuccess} />);

    await fillAndSubmit();

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled();
    });
    expect(calls.find((c) => c.url === '/api/v1/auth/signup')?.body).toMatchObject({
      invitationToken: 'tok',
    });
  });
});

describe('VerifyEmail', () => {
  it('posts the token once and shows success', async () => {
    const calls = mockApi({ 'POST /api/v1/auth/verify-email': [200, { ok: true }] });
    renderWithQuery(
      <StrictMode>
        <VerifyEmail token="tok" />
      </StrictMode>,
    );

    expect(await screen.findByText(strings.auth.verifySuccess)).toBeInTheDocument();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({ token: 'tok' });
  });

  it('shows the expired state', async () => {
    mockApi({ 'POST /api/v1/auth/verify-email': [401, apiError('token_expired')] });
    renderWithQuery(<VerifyEmail token="tok" />);

    expect(await screen.findByText(strings.auth.verifyExpired)).toBeInTheDocument();
  });
});

describe('ResetPasswordForm', () => {
  it('catches a confirmation mismatch without calling the API', async () => {
    const calls = mockApi({});
    renderWithQuery(<ResetPasswordForm token="tok" onSuccess={vi.fn()} />);

    await userEvent.type(screen.getByLabelText(strings.auth.newPassword), 'password1234');
    await userEvent.type(screen.getByLabelText(strings.auth.confirmPassword), 'password9999');
    await userEvent.click(screen.getByRole('button', { name: strings.auth.resetPassword }));

    expect(await screen.findByText(strings.auth.passwordMismatch)).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });
});

describe('InvitePanel', () => {
  const PREVIEW = { workspaceName: 'Acme', role: 'agent', email: 'bob@example.com' };

  it('shows workspace and role and offers accept when signed in', async () => {
    const calls = mockApi({
      'GET /api/v1/invitations/preview': [200, PREVIEW],
      'GET /api/v1/auth/me': [200, { ...ME, email: 'bob@example.com' }],
      'POST /api/v1/invitations/accept': [200, { workspaceId: 'w1', role: 'agent' }],
    });
    const onAccepted = vi.fn();
    renderWithQuery(<InvitePanel token="tok" onAccepted={onAccepted} />);

    expect(await screen.findByText(strings.invite.summary('Acme', 'agent'))).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: strings.invite.accept }));

    await waitFor(() => {
      expect(onAccepted).toHaveBeenCalledWith('w1');
    });
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ token: 'tok' });
  });

  it('offers sign up or log in when signed out', async () => {
    mockApi({
      'GET /api/v1/invitations/preview': [200, PREVIEW],
      'GET /api/v1/auth/me': [401, apiError('unauthorized')],
    });
    renderWithQuery(<InvitePanel token="tok" onAccepted={vi.fn()} />);

    expect(
      await screen.findByRole('link', { name: strings.invite.signUpToAccept }),
    ).toHaveAttribute('href', '/signup?invitationToken=tok');
    expect(screen.getByRole('link', { name: strings.invite.logInToAccept })).toHaveAttribute(
      'href',
      `/login?next=${encodeURIComponent('/invitations/accept?token=tok')}`,
    );
  });

  it('shows the expired state', async () => {
    mockApi({
      'GET /api/v1/invitations/preview': [410, apiError('token_expired')],
      'GET /api/v1/auth/me': [401, apiError('unauthorized')],
    });
    renderWithQuery(<InvitePanel token="tok" onAccepted={vi.fn()} />);

    expect(await screen.findByText(strings.invite.expired)).toBeInTheDocument();
  });
});
