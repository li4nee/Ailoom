// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';

import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormAlert } from '@/components/form-alert';
import { hasRole, useWorkspaceRole } from '@/components/role-gate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import type { CredentialDto } from '@app/shared';

import { useCredentials, useDeleteCredential } from '../api';
import { CredentialForm } from './credential-form';
import { TestButton } from './test-button';

/** Provider documentation, linked from every row (spec §11.1). */
function docsUrl(provider: string): string {
  return `/docs/providers/${provider}`;
}

interface RowProps {
  workspaceId: string;
  credential: CredentialDto;
  canManage: boolean;
  onEdit: (credential: CredentialDto) => void;
}

function CredentialRow({ workspaceId, credential, canManage, onEdit }: RowProps) {
  const remove = useDeleteCredential(workspaceId);
  // The built-in local credential is provisioned by the platform and cannot be changed.
  const builtIn = credential.provider === 'local';

  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-2">
          <a className="underline" href={docsUrl(credential.provider)}>
            {strings.credentials.providers[credential.provider]}
          </a>
          {builtIn ? <Badge variant="secondary">{strings.credentials.builtIn}</Badge> : null}
        </div>
      </TableCell>
      <TableCell>{credential.label}</TableCell>
      <TableCell>
        {credential.secretLast4 === null
          ? '—'
          : strings.credentials.apiKeyKeep(credential.secretLast4)}
      </TableCell>
      <TableCell>
        <TestButton workspaceId={workspaceId} credentialId={credential.id} />
      </TableCell>
      <TableCell className="text-right">
        {builtIn ? (
          <span className="text-xs text-muted-foreground">{strings.credentials.builtInHint}</span>
        ) : canManage ? (
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                onEdit(credential);
              }}
            >
              {strings.credentials.edit}
            </Button>
            <ConfirmDialog
              trigger={
                <Button variant="ghost" size="sm">
                  {strings.credentials.delete}
                </Button>
              }
              title={strings.credentials.deleteConfirm(credential.label)}
              description={strings.credentials.deleteIntro}
              confirmLabel={strings.credentials.delete}
              error={errorMessage(remove.error, { credential_in_use: strings.credentials.inUse })}
              pending={remove.isPending}
              onConfirm={(close) => {
                remove.mutate(credential.id, { onSuccess: close });
              }}
            />
          </div>
        ) : null}
      </TableCell>
    </TableRow>
  );
}

/** The settings page's credentials panel: list, create, edit and delete (spec §11.1). */
export function CredentialList({ workspaceId }: { workspaceId: string }) {
  const canManage = hasRole(useWorkspaceRole(), 'admin');
  const credentials = useCredentials(workspaceId, canManage);
  const [editing, setEditing] = useState<CredentialDto | null>(null);
  const [creating, setCreating] = useState(false);

  // Agents have no read access at all, so their query never runs: say so instead of loading.
  if (!canManage) {
    return <p className="text-sm text-muted-foreground">{strings.credentials.adminsOnly}</p>;
  }
  if (credentials.isError) return <FormAlert message={errorMessage(credentials.error)} />;
  if (credentials.isPending) return <Skeleton className="h-32 w-full" />;

  const rows = credentials.data;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium">{strings.credentials.title}</h2>
          <p className="text-sm text-muted-foreground">{strings.credentials.intro}</p>
        </div>
        {creating || editing !== null ? null : (
          <Button
            type="button"
            onClick={() => {
              setCreating(true);
            }}
          >
            {strings.credentials.add}
          </Button>
        )}
      </div>

      {creating ? (
        <Card>
          <CardHeader>
            <CardTitle>{strings.credentials.add}</CardTitle>
          </CardHeader>
          <CardContent>
            <CredentialForm
              workspaceId={workspaceId}
              onDone={() => {
                setCreating(false);
              }}
            />
          </CardContent>
        </Card>
      ) : null}

      {editing === null ? null : (
        <Card>
          <CardHeader>
            <CardTitle>{editing.label}</CardTitle>
          </CardHeader>
          <CardContent>
            <CredentialForm
              workspaceId={workspaceId}
              credential={editing}
              onDone={() => {
                setEditing(null);
              }}
            />
          </CardContent>
        </Card>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{strings.credentials.none}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{strings.credentials.provider}</TableHead>
              <TableHead>{strings.credentials.label}</TableHead>
              <TableHead>{strings.credentials.apiKey}</TableHead>
              <TableHead>{strings.credentials.test}</TableHead>
              <TableHead className="text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((credential) => (
              <CredentialRow
                key={credential.id}
                workspaceId={workspaceId}
                credential={credential}
                canManage={canManage}
                onEdit={setEditing}
              />
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
