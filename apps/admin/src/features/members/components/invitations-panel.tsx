// SPDX-License-Identifier: AGPL-3.0-only
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';

import { FormAlert } from '@/components/form-alert';
import { NativeSelect } from '@/components/native-select';
import { hasRole, useWorkspaceRole } from '@/components/role-gate';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import {
  type CreateInvitationRequest,
  createInvitationRequestSchema,
  INVITATION_ROLES,
} from '@app/shared';

import { useCreateInvitation, useInvitations, useRevokeInvitation } from '../api';

/** Outside render: the expiry label is read once per render, not tracked over time. */
function isPast(iso: string): boolean {
  return new Date(iso).getTime() <= Date.now();
}

function InviteForm({ workspaceId }: { workspaceId: string }) {
  const create = useCreateInvitation(workspaceId);
  const form = useForm<CreateInvitationRequest>({
    resolver: zodResolver(createInvitationRequestSchema),
    defaultValues: { email: '', role: 'agent' },
  });

  const submit = form.handleSubmit((values) => {
    create.mutate(values, {
      onSuccess: () => {
        form.reset({ email: '', role: values.role });
      },
    });
  });

  return (
    <div className="space-y-4">
      <Form {...form}>
        <form
          onSubmit={(event) => void submit(event)}
          className="flex flex-wrap items-end gap-3"
          noValidate
        >
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem className="min-w-64 flex-1">
                <FormLabel>{strings.auth.email}</FormLabel>
                <FormControl>
                  <Input type="email" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="role"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{strings.members.inviteRole}</FormLabel>
                <FormControl>
                  <NativeSelect {...field}>
                    {INVITATION_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {strings.roles[role]}
                      </option>
                    ))}
                  </NativeSelect>
                </FormControl>
              </FormItem>
            )}
          />
          <Button type="submit" disabled={create.isPending}>
            {strings.members.invite}
          </Button>
        </form>
      </Form>
      <FormAlert message={errorMessage(create.error)} />
      {create.data === undefined ? null : create.data.acceptUrl === null ? (
        <p role="status">{strings.members.invitationSent(create.data.email)}</p>
      ) : (
        <div className="space-y-1">
          <Label htmlFor="invitation-link">{strings.members.shareLink}</Label>
          <Input id="invitation-link" readOnly value={create.data.acceptUrl} />
          <p className="text-sm text-muted-foreground">{strings.members.shareHint}</p>
        </div>
      )}
    </div>
  );
}

export function InvitationsPanel({ workspaceId }: { workspaceId: string }) {
  const canManage = hasRole(useWorkspaceRole(), 'admin');
  const invitations = useInvitations(workspaceId, canManage);
  const revoke = useRevokeInvitation(workspaceId);

  if (!canManage) return <p>{strings.members.adminsOnly}</p>;

  return (
    <div className="space-y-6">
      <InviteForm workspaceId={workspaceId} />
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">{strings.members.pending}</h2>
        <FormAlert message={errorMessage(invitations.error ?? revoke.error)} />
        {invitations.data?.length === 0 ? <p>{strings.members.noPending}</p> : null}
        {invitations.data !== undefined && invitations.data.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{strings.members.email}</TableHead>
                <TableHead>{strings.members.role}</TableHead>
                <TableHead>{strings.members.expires}</TableHead>
                <TableHead>{strings.members.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invitations.data.map((invitation) => (
                <TableRow key={invitation.id}>
                  <TableCell>{invitation.email}</TableCell>
                  <TableCell>{strings.roles[invitation.role]}</TableCell>
                  <TableCell>
                    {isPast(invitation.expiresAt)
                      ? strings.members.expired
                      : new Date(invitation.expiresAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={revoke.isPending}
                      onClick={() => {
                        revoke.mutate(invitation.id);
                      }}
                    >
                      {strings.members.revoke}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </section>
    </div>
  );
}
