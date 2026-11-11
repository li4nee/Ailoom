// SPDX-License-Identifier: AGPL-3.0-only
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useWorkspaceRole } from '@/components/role-gate';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';

import { useRemoveMember } from '../api';

/** Any member except the owner can leave; the owner transfers ownership first. */
export function LeaveWorkspace({
  workspaceId,
  userId,
  onLeft,
}: {
  workspaceId: string;
  userId: string;
  onLeft: () => void;
}) {
  const role = useWorkspaceRole();
  const leave = useRemoveMember(workspaceId);
  if (role === null || role === 'owner') return null;

  return (
    <section className="max-w-md space-y-2">
      <h2 className="text-lg font-semibold">{strings.members.leave}</h2>
      <p className="text-sm text-muted-foreground">{strings.members.leaveIntro}</p>
      <ConfirmDialog
        trigger={<Button variant="outline">{strings.members.leave}</Button>}
        title={strings.members.leaveConfirm}
        description={strings.members.leaveIntro}
        confirmLabel={strings.members.leave}
        error={errorMessage(leave.error)}
        pending={leave.isPending}
        onConfirm={() => {
          leave.mutate(userId, { onSuccess: onLeft });
        }}
      />
    </section>
  );
}
