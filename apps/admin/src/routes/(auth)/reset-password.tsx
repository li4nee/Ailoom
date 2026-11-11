// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';

import { AuthCard } from '@/components/auth-card';
import { ResetPasswordForm } from '@/features/auth/components/reset-password-form';
import { strings } from '@/strings';

export const Route = createFileRoute('/(auth)/reset-password')({
  validateSearch: z.object({ token: z.string().optional() }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { token } = Route.useSearch();
  const [done, setDone] = useState(false);
  let body;
  if (token === undefined) body = <p role="alert">{strings.auth.missingToken}</p>;
  else if (done) {
    body = (
      <p role="status">
        {strings.auth.resetSuccess}{' '}
        <Link to="/login" className="underline">
          {strings.auth.logIn}
        </Link>
      </p>
    );
  } else {
    body = (
      <ResetPasswordForm
        token={token}
        onSuccess={() => {
          setDone(true);
        }}
      />
    );
  }
  return <AuthCard title={strings.auth.resetTitle}>{body}</AuthCard>;
}
