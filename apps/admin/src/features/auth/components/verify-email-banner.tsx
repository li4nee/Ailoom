// SPDX-License-Identifier: AGPL-3.0-only
import { FormAlert } from '@/components/form-alert';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';

import { useResendVerification } from '../api';

/**
 * Shown to signed-in users who have not verified their address (creating a workspace needs
 * it). An expired or lost link is the common case, so the banner offers a new one.
 */
export function VerifyEmailBanner({ emailVerified }: { emailVerified: boolean }) {
  const resend = useResendVerification();
  if (emailVerified) return null;

  return (
    <Alert className="rounded-none border-x-0 border-t-0">
      <AlertDescription className="flex flex-wrap items-center gap-3">
        <span>{strings.auth.notVerified}</span>
        {resend.isSuccess ? (
          <span role="status">{strings.auth.verificationResent}</span>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={resend.isPending}
            onClick={() => {
              resend.mutate();
            }}
          >
            {strings.auth.resendVerification}
          </Button>
        )}
        <FormAlert message={errorMessage(resend.error)} />
      </AlertDescription>
    </Alert>
  );
}
