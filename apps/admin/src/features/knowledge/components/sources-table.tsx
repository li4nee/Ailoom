// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from '@tanstack/react-router';

import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormAlert } from '@/components/form-alert';
import { hasRole, useWorkspaceRole } from '@/components/role-gate';
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
import type { SourceDto } from '@app/shared';

import { useDeleteSource, useResync, useSources } from '../api';
import { SourceStatus } from './source-status';

function SourceActions({
  workspaceId,
  botId,
  source,
}: {
  workspaceId: string;
  botId: string;
  source: SourceDto;
}) {
  const resync = useResync(workspaceId, botId, source.id);
  const remove = useDeleteSource(workspaceId, botId, source.id);
  const busy = source.status === 'deleting';

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={busy || resync.isPending}
        onClick={() => {
          resync.mutate();
        }}
      >
        {strings.knowledge.resync}
      </Button>
      <ConfirmDialog
        trigger={
          <Button variant="outline" size="sm" disabled={busy}>
            {strings.knowledge.delete}
          </Button>
        }
        title={strings.knowledge.deleteTitle}
        description={strings.knowledge.deleteIntro}
        confirmLabel={strings.knowledge.delete}
        error={remove.isError ? errorMessage(remove.error) : null}
        pending={remove.isPending}
        onConfirm={(close) => {
          remove.mutate(undefined, { onSuccess: close });
        }}
      />
    </div>
  );
}

export function SourcesTable({ workspaceId, botId }: { workspaceId: string; botId: string }) {
  const isAdmin = hasRole(useWorkspaceRole(), 'admin');
  const sources = useSources(workspaceId, botId);

  if (sources.isError) return <FormAlert message={errorMessage(sources.error)} />;
  if (sources.isPending) return <Skeleton className="h-32 w-full" />;
  if (sources.data.length === 0) {
    return <p className="text-sm text-muted-foreground">{strings.knowledge.empty}</p>;
  }

  return (
    <div className="space-y-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{strings.knowledge.sources}</TableHead>
            <TableHead>{strings.knowledge.type}</TableHead>
            <TableHead>{strings.knowledge.status}</TableHead>
            <TableHead>{strings.knowledge.lastSynced}</TableHead>
            {isAdmin ? <TableHead>{strings.knowledge.addSource}</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sources.data.map((source) => (
            <TableRow key={source.id}>
              <TableCell>
                <Link
                  to="/w/$workspaceId/bots/$botId/knowledge/$sourceId"
                  params={{ workspaceId, botId, sourceId: source.id }}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {source.title}
                </Link>
                {source.error === null ? null : (
                  <p className="text-xs text-destructive">{source.error}</p>
                )}
              </TableCell>
              <TableCell>{strings.knowledge.types[source.type]}</TableCell>
              <TableCell>
                <SourceStatus
                  status={source.status}
                  pagesDone={source.pagesDone}
                  pagesTotal={source.pagesTotal}
                />
                {source.warningCount > 0 ? (
                  <p className="mt-1 text-xs text-amber-700">
                    {strings.knowledge.warningCount(source.warningCount)}
                  </p>
                ) : null}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {source.lastSyncedAt === null
                  ? '—'
                  : new Date(source.lastSyncedAt).toLocaleString()}
              </TableCell>
              {isAdmin ? (
                <TableCell>
                  <SourceActions workspaceId={workspaceId} botId={botId} source={source} />
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {isAdmin ? null : (
        <p className="text-sm text-muted-foreground">{strings.knowledge.agentsReadOnly}</p>
      )}
    </div>
  );
}
