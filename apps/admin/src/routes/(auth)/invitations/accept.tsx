// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';

import { AuthCard } from '@/components/auth-card';
import { InvitePanel } from '@/features/auth/components/invite-panel';
import { strings } from '@/strings';

/** The link in the invitation email (`/invitations/accept?token=…`). */
export const Route = createFileRoute('/(auth)/invitations/accept')({
  validateSearch: z.object({ token: z.string().optional() }),
  component: AcceptInvitationPage,
});

function AcceptInvitationPage() {
  const { token } = Route.useSearch();
  const navigate = useNavigate();
  return (
    <AuthCard title={strings.invite.title}>
      {token === undefined ? (
        <p role="alert">{strings.auth.missingToken}</p>
      ) : (
        <InvitePanel
          token={token}
          onAccepted={(workspaceId) => void navigate({ href: `/w/${workspaceId}` })}
        />
      )}
    </AuthCard>
  );
}
