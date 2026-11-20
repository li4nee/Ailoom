// SPDX-License-Identifier: AGPL-3.0-only
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormAlert } from '@/components/form-alert';
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

import { useLogoutAll, useRevokeSession, useSessions } from '../api';

function when(value: string | null): string {
  return value === null ? strings.account.never : new Date(value).toLocaleString();
}

/** The user's signed-in devices. `onLoggedOut` runs after "log out everywhere" succeeds. */
export function SessionsPanel({ onLoggedOut }: { onLoggedOut: () => void }) {
  const sessions = useSessions();
  const revoke = useRevokeSession();
  const logoutAll = useLogoutAll();

  if (sessions.isError) return <FormAlert message={errorMessage(sessions.error)} />;
  if (sessions.data === undefined) return <Skeleton className="h-32 w-full" />;

  return (
    <div className="space-y-4">
      <FormAlert message={errorMessage(revoke.error)} />
      <ul className="space-y-3 md:hidden">
        {sessions.data.map((session) => (
          <li key={session.sessionId} className="ledger-panel min-w-0 space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="min-w-0 break-words font-medium">
                {session.userAgent ?? strings.account.unknownDevice}
              </p>
              {session.current ? <Badge>{strings.account.thisDevice}</Badge> : null}
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">{strings.account.ip}</dt>
                <dd className="break-all">{session.ip ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{strings.account.signedIn}</dt>
                <dd>{when(session.createdAt)}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs text-muted-foreground">{strings.account.lastUsed}</dt>
                <dd>{when(session.lastUsedAt)}</dd>
              </div>
            </dl>
            {session.current ? null : (
              <Button
                variant="outline"
                size="sm"
                disabled={revoke.isPending}
                onClick={() => {
                  revoke.mutate(session.sessionId);
                }}
              >
                {strings.account.revoke}
              </Button>
            )}
          </li>
        ))}
      </ul>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{strings.account.device}</TableHead>
              <TableHead>{strings.account.ip}</TableHead>
              <TableHead>{strings.account.signedIn}</TableHead>
              <TableHead>{strings.account.lastUsed}</TableHead>
              <TableHead>
                <span className="sr-only">{strings.members.actions}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.data.map((session) => (
              <TableRow key={session.sessionId}>
                <TableCell className="max-w-sm whitespace-normal break-words">
                  {session.userAgent ?? strings.account.unknownDevice}{' '}
                  {session.current ? <Badge>{strings.account.thisDevice}</Badge> : null}
                </TableCell>
                <TableCell>{session.ip ?? ''}</TableCell>
                <TableCell>{when(session.createdAt)}</TableCell>
                <TableCell>{when(session.lastUsedAt)}</TableCell>
                <TableCell>
                  {session.current ? null : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={revoke.isPending}
                      onClick={() => {
                        revoke.mutate(session.sessionId);
                      }}
                    >
                      {strings.account.revoke}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ConfirmDialog
        trigger={<Button variant="destructive">{strings.account.logOutEverywhere}</Button>}
        title={strings.account.logOutEverywhere}
        description={strings.account.logOutEverywhereIntro}
        confirmLabel={strings.account.logOutEverywhere}
        error={errorMessage(logoutAll.error)}
        pending={logoutAll.isPending}
        onConfirm={() => {
          logoutAll.mutate(undefined, { onSuccess: onLoggedOut });
        }}
      />
    </div>
  );
}
