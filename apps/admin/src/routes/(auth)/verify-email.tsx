// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, Link } from '@tanstack/react-router';
import { z } from 'zod';

import { AuthCard } from '@/components/auth-card';
import { VerifyEmail } from '@/features/auth/components/verify-email';
import { strings } from '@/strings';

export const Route = createFileRoute('/(auth)/verify-email')({
  validateSearch: z.object({ token: z.string().optional() }),
  component: VerifyEmailPage,
});

function VerifyEmailPage() {
  const { token } = Route.useSearch();
  return (
    <AuthCard
      title={strings.auth.verifying}
      footer={
        <Link to="/" className="underline">
          {strings.auth.continue}
        </Link>
      }
    >
      {token === undefined ? (
        <p role="alert">{strings.auth.missingToken}</p>
      ) : (
        <VerifyEmail token={token} />
      )}
    </AuthCard>
  );
}
