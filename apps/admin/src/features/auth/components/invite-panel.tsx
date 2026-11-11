// SPDX-License-Identifier: AGPL-3.0-only
import { FormAlert } from '@/components/form-alert';
import { Button } from '@/components/ui/button';
import { errorCode, errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';

import { useAcceptInvitation, useInvitationPreview, useMe } from '../api';

/**
 * The page behind the invitation email link. Signed in: accept in one click. Signed out: sign
 * up with the token (which joins the workspace on signup) or log in and come back here.
 */
export function InvitePanel({
  token,
  onAccepted,
}: {
  token: string;
  onAccepted: (workspaceId: string) => void;
}) {
  const preview = useInvitationPreview(token);
  const me = useMe();
  const accept = useAcceptInvitation();

  if (preview.isError) {
    return (
      <p role="alert">
        {errorCode(preview.error) === 'token_expired'
          ? strings.invite.expired
          : strings.invite.invalid}
      </p>
    );
  }
  if (preview.data === undefined || me.isPending) {
    return <p role="status">{strings.app.loading}</p>;
  }

  const back = `/invitations/accept?token=${encodeURIComponent(token)}`;
  return (
    <div className="space-y-4">
      <p>{strings.invite.summary(preview.data.workspaceName, preview.data.role)}</p>
      <p className="text-sm text-muted-foreground">{strings.invite.sentTo(preview.data.email)}</p>
      <FormAlert
        message={errorMessage(accept.error, {
          invalid_token: strings.invite.wrongAccount,
          token_expired: strings.invite.expired,
          email_not_verified: strings.invite.verifyFirst,
        })}
      />
      {me.data ? (
        <Button
          className="w-full"
          disabled={accept.isPending}
          onClick={() => {
            accept.mutate(token, {
              onSuccess: (result) => {
                onAccepted(result.workspaceId);
              },
            });
          }}
        >
          {strings.invite.accept}
        </Button>
      ) : (
        <div className="flex flex-col gap-2">
          <Button asChild className="w-full">
            <a href={`/signup?invitationToken=${encodeURIComponent(token)}`}>
              {strings.invite.signUpToAccept}
            </a>
          </Button>
          <Button asChild variant="outline" className="w-full">
            <a href={`/login?next=${encodeURIComponent(back)}`}>{strings.invite.logInToAccept}</a>
          </Button>
        </div>
      )}
    </div>
  );
}
