// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, useNavigate } from '@tanstack/react-router';

import { FormAlert } from '@/components/form-alert';
import { Skeleton } from '@/components/ui/skeleton';
import { useMe } from '@/features/auth/api';
import { LeaveWorkspace } from '@/features/members/components/leave-workspace';
import { useWorkspace } from '@/features/workspaces/api';
import { GeneralSettings } from '@/features/workspaces/components/general-settings';
import { errorMessage } from '@/lib/error-message';

export const Route = createFileRoute('/_app/w/$workspaceId/settings/general')({
  component: GeneralPage,
});

function GeneralPage() {
  const { workspaceId } = Route.useParams();
  const workspace = useWorkspace(workspaceId);
  const navigate = useNavigate();
  const me = useMe().data;
  if (workspace.isError) return <FormAlert message={errorMessage(workspace.error)} />;
  if (workspace.data === undefined) return <Skeleton className="h-40 w-full max-w-md" />;
  return (
    <div className="space-y-10">
      <GeneralSettings
        key={workspace.data.id}
        workspace={workspace.data}
        onDeleted={() => void navigate({ to: '/' })}
      />
      {me ? (
        <LeaveWorkspace
          workspaceId={workspaceId}
          userId={me.id}
          onLeft={() => {
            // The membership list in `me` changed; a reload lands on the next workspace.
            window.location.assign('/');
          }}
        />
      ) : null}
    </div>
  );
}
