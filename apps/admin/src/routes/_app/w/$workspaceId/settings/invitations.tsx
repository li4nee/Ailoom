// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';

import { InvitationsPanel } from '@/features/members/components/invitations-panel';

export const Route = createFileRoute('/_app/w/$workspaceId/settings/invitations')({
  component: function InvitationsPage() {
    const { workspaceId } = Route.useParams();
    return <InvitationsPanel workspaceId={workspaceId} />;
  },
});
