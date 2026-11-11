// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';

import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormAlert } from '@/components/form-alert';
import { hasRole, RoleGate, useWorkspaceRole } from '@/components/role-gate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';
import { emailSchema, type WorkspaceDto } from '@app/shared';

import { useDeleteWorkspace, useUpdateWorkspace } from '../api';

function parseEmails(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

export function GeneralSettings({
  workspace,
  onDeleted,
}: {
  workspace: WorkspaceDto;
  onDeleted: () => void;
}) {
  const canEdit = hasRole(useWorkspaceRole(), 'admin');
  const update = useUpdateWorkspace(workspace.id);
  const remove = useDeleteWorkspace(workspace.id);
  const [name, setName] = useState(workspace.name);
  const [emails, setEmails] = useState(workspace.settings.notificationEmails.join('\n'));
  const invalidEmail = parseEmails(emails).find((email) => !emailSchema.safeParse(email).success);

  return (
    <div className="space-y-8">
      <form
        className="max-w-md space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (invalidEmail !== undefined || name.trim() === '') return;
          update.mutate({
            name: name.trim(),
            settings: { notificationEmails: parseEmails(emails) },
          });
        }}
      >
        {canEdit ? null : (
          <p className="text-sm text-muted-foreground">{strings.workspaces.readOnly}</p>
        )}
        <div className="space-y-1">
          <Label htmlFor="workspace-name">{strings.workspaces.name}</Label>
          <Input
            id="workspace-name"
            value={name}
            maxLength={100}
            disabled={!canEdit}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="notification-emails">{strings.workspaces.notificationEmails}</Label>
          <textarea
            id="notification-emails"
            className="min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
            value={emails}
            disabled={!canEdit}
            aria-describedby="notification-emails-hint"
            aria-invalid={invalidEmail !== undefined}
            onChange={(event) => {
              setEmails(event.target.value);
            }}
          />
          <p id="notification-emails-hint" className="text-sm text-muted-foreground">
            {strings.workspaces.notificationEmailsHint}
          </p>
        </div>
        <FormAlert
          message={
            invalidEmail === undefined
              ? errorMessage(update.error)
              : `${strings.auth.email}: ${invalidEmail}`
          }
        />
        {update.isSuccess ? <p role="status">{strings.workspaces.saved}</p> : null}
        <RoleGate min="admin">
          <Button type="submit" disabled={update.isPending}>
            {strings.workspaces.save}
          </Button>
        </RoleGate>
      </form>
      <RoleGate min="owner">
        <section className="max-w-md space-y-2">
          <h2 className="text-lg font-semibold">{strings.workspaces.deleteTitle}</h2>
          <p className="text-sm text-muted-foreground">{strings.workspaces.deleteIntro}</p>
          <ConfirmDialog
            trigger={<Button variant="destructive">{strings.workspaces.deleteButton}</Button>}
            title={strings.workspaces.deleteConfirm(workspace.name)}
            description={strings.workspaces.deleteIntro}
            confirmLabel={strings.workspaces.deleteButton}
            error={errorMessage(remove.error)}
            pending={remove.isPending}
            onConfirm={() => {
              remove.mutate(undefined, { onSuccess: onDeleted });
            }}
          />
        </section>
      </RoleGate>
    </div>
  );
}
