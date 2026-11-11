// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, Link } from '@tanstack/react-router';

import { AuthCard } from '@/components/auth-card';
import { ForgotPasswordForm } from '@/features/auth/components/forgot-password-form';
import { strings } from '@/strings';

export const Route = createFileRoute('/(auth)/forgot-password')({
  component: () => (
    <AuthCard
      title={strings.auth.forgotTitle}
      footer={
        <Link to="/login" className="underline">
          {strings.auth.logIn}
        </Link>
      }
    >
      <ForgotPasswordForm />
    </AuthCard>
  ),
});
