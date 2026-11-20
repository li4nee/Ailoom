// SPDX-License-Identifier: AGPL-3.0-only

import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormAlert } from '@/components/form-alert';
import { NativeSelect } from '@/components/native-select';
import { hasRole, RoleGate, useWorkspaceRole } from '@/components/role-gate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';
import { INVITATION_ROLES, type InvitationRole, type MemberDto } from '@app/shared';

import { useChangeRole, useMembers, useRemoveMember, useTransferOwnership } from '../api';

const MEMBER_ERRORS = {
  cannot_modify_owner: strings.members.cannotModifyOwner,
  sole_owner: strings.members.soleOwner,
} as const;

function isInvitationRole(value: string): value is InvitationRole {
  return (INVITATION_ROLES as readonly string[]).includes(value);
}

function MemberActions({ workspaceId, member }: { workspaceId: string; member: MemberDto }) {
  const changeRole = useChangeRole(workspaceId);
  const remove = useRemoveMember(workspaceId);
  const transfer = useTransferOwnership(workspaceId);

  // The owner is changed only by transferring ownership, never from this row.
  if (member.role === 'owner') return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <NativeSelect
        aria-label={strings.members.changeRole(member.email)}
        value={member.role}
        disabled={changeRole.isPending}
        onChange={(event) => {
          const role = event.target.value;
          if (isInvitationRole(role)) changeRole.mutate({ userId: member.userId, role });
        }}
      >
        {INVITATION_ROLES.map((role) => (
          <option key={role} value={role}>
            {strings.roles[role]}
          </option>
        ))}
      </NativeSelect>
      <ConfirmDialog
        trigger={
          <Button variant="outline" size="sm">
            {strings.members.remove}
          </Button>
        }
        title={strings.members.removeConfirm(member.email)}
        description={strings.members.removeIntro}
        confirmLabel={strings.members.remove}
        error={errorMessage(remove.error, MEMBER_ERRORS)}
        pending={remove.isPending}
        onConfirm={(close) => {
          remove.mutate(member.userId, { onSuccess: close });
        }}
      />
      <RoleGate min="owner">
        <ConfirmDialog
          trigger={
            <Button variant="ghost" size="sm">
              {strings.members.transferOwnership}
            </Button>
          }
          title={strings.members.transferConfirm(member.email)}
          description={strings.members.transferIntro}
          confirmLabel={strings.members.transferOwnership}
          error={errorMessage(transfer.error)}
          pending={transfer.isPending}
          onConfirm={(close) => {
            transfer.mutate(member.userId, { onSuccess: close });
          }}
        />
      </RoleGate>
      <FormAlert message={errorMessage(changeRole.error, MEMBER_ERRORS)} />
    </div>
  );
}

/** The member list and its controls are for admins and the owner (spec §17.3). */
export function MembersPanel({
  workspaceId,
  currentUserId,
}: {
  workspaceId: string;
  currentUserId: string;
}) {
  const isAdmin = hasRole(useWorkspaceRole(), 'admin');
  const members = useMembers(workspaceId, isAdmin);

  if (!isAdmin) return <p>{strings.members.listAdminsOnly}</p>;
  if (members.isError) return <FormAlert message={errorMessage(members.error)} />;
  if (members.data === undefined) return <Skeleton className="h-32 w-full" />;

  return (
    <div className="space-y-3">
      <ul className="space-y-3 md:hidden">
        {members.data.map((member) => (
          <li key={member.userId} className="ledger-panel min-w-0 space-y-3 p-4">
            <div className="min-w-0 space-y-1">
              <p className="break-all font-medium">
                {member.email}
                {member.userId === currentUserId ? (
                  <span className="ml-2 text-muted-foreground">{strings.members.you}</span>
                ) : null}
              </p>
              {member.name ? (
                <p className="break-words text-sm text-muted-foreground">{member.name}</p>
              ) : null}
              <Badge variant={member.role === 'owner' ? 'default' : 'secondary'}>
                {strings.roles[member.role]}
              </Badge>
            </div>
            {member.role === 'owner' ? null : (
              <MemberActions workspaceId={workspaceId} member={member} />
            )}
          </li>
        ))}
      </ul>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{strings.members.email}</TableHead>
              <TableHead>{strings.members.name}</TableHead>
              <TableHead>{strings.members.role}</TableHead>
              <RoleGate min="admin">
                <TableHead>{strings.members.actions}</TableHead>
              </RoleGate>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.data.map((member) => (
              <TableRow key={member.userId}>
                <TableCell>
                  {member.email}{' '}
                  {member.userId === currentUserId ? (
                    <span className="text-muted-foreground">{strings.members.you}</span>
                  ) : null}
                </TableCell>
                <TableCell>{member.name ?? ''}</TableCell>
                <TableCell>
                  <Badge variant={member.role === 'owner' ? 'default' : 'secondary'}>
                    {strings.roles[member.role]}
                  </Badge>
                </TableCell>
                <RoleGate min="admin">
                  <TableCell>
                    <MemberActions workspaceId={workspaceId} member={member} />
                  </TableCell>
                </RoleGate>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
