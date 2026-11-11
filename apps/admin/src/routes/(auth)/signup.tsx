// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';

import { AuthCard } from '@/components/auth-card';
import { SignupForm } from '@/features/auth/components/signup-form';
import { strings } from '@/strings';

export const Route = createFileRoute('/(auth)/signup')({
  validateSearch: z.object({ invitationToken: z.string().optional() }),
  component: SignupPage,
});

function SignupPage() {
  const { invitationToken } = Route.useSearch();
  const [done, setDone] = useState(false);
  const footer = (
    <span>
      {strings.auth.haveAccount}{' '}
      <Link to="/login" className="underline">
        {strings.auth.logIn}
      </Link>
    </span>
  );
  return (
    <AuthCard title={strings.auth.signUpTitle} footer={footer}>
      {done ? (
        <p role="status">{strings.auth.signedUpCheckEmail}</p>
      ) : (
        <SignupForm
          {...(invitationToken === undefined ? {} : { invitationToken })}
          onSuccess={() => {
            setDone(true);
          }}
        />
      )}
    </AuthCard>
  );
}
