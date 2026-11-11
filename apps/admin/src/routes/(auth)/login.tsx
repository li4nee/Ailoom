// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';

import { AuthCard } from '@/components/auth-card';
import { LoginForm } from '@/features/auth/components/login-form';
import { safeNext } from '@/features/auth/safe-next';
import { strings } from '@/strings';

export const Route = createFileRoute('/(auth)/login')({
  validateSearch: z.object({ next: z.string().optional() }),
  component: LoginPage,
});

function LoginPage() {
  const { next } = Route.useSearch();
  const navigate = useNavigate();
  return (
    <AuthCard
      title={strings.auth.logInTitle}
      footer={
        <>
          <Link to="/forgot-password" className="underline">
            {strings.auth.forgotLink}
          </Link>
          <span>
            {strings.auth.noAccount}{' '}
            <Link to="/signup" className="underline">
              {strings.auth.signUp}
            </Link>
          </span>
        </>
      }
    >
      <LoginForm onSuccess={() => void navigate({ href: safeNext(next) })} />
    </AuthCard>
  );
}
