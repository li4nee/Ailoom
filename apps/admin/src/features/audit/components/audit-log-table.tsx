// SPDX-License-Identifier: AGPL-3.0-only
import { FormAlert } from '@/components/form-alert';
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

import { useAuditLog } from '../api';

export function AuditLogTable({ workspaceId }: { workspaceId: string }) {
  const log = useAuditLog(workspaceId);

  if (log.isError) return <FormAlert message={errorMessage(log.error)} />;
  if (log.data === undefined) return <Skeleton className="h-32 w-full" />;

  const entries = log.data.pages.flatMap((page) => page.data);
  if (entries.length === 0) return <p>{strings.audit.empty}</p>;

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{strings.audit.when}</TableHead>
            <TableHead>{strings.audit.action}</TableHead>
            <TableHead>{strings.audit.actor}</TableHead>
            <TableHead>{strings.audit.target}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry) => (
            <TableRow key={entry.id}>
              <TableCell>{new Date(entry.createdAt).toLocaleString()}</TableCell>
              <TableCell>
                <code>{entry.action}</code>
              </TableCell>
              <TableCell>{entry.actorUserId ?? ''}</TableCell>
              <TableCell>
                {entry.targetType === null ? '' : `${entry.targetType} ${entry.targetId ?? ''}`}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {log.hasNextPage ? (
        <Button
          variant="outline"
          disabled={log.isFetchingNextPage}
          onClick={() => void log.fetchNextPage()}
        >
          {strings.audit.loadMore}
        </Button>
      ) : null}
    </div>
  );
}
