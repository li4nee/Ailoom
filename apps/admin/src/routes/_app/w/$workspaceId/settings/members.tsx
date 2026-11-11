// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';

import { useMe } from '@/features/auth/api';
import { MembersPanel } from '@/features/members/components/members-panel';

export const Route = createFileRoute('/_app/w/$workspaceId/settings/members')({
  component: MembersPage,
});

function MembersPage() {
  const { workspaceId } = Route.useParams();
  const me = useMe().data;
  if (me === undefined || me === null) return null;
  return <MembersPanel workspaceId={workspaceId} currentUserId={me.id} />;
}
