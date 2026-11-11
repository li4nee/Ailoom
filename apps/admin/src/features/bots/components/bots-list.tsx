// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from '@tanstack/react-router';

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

import { useBots } from '../api';

export function BotsList({ workspaceId }: { workspaceId: string }) {
  const isAdmin = hasRole(useWorkspaceRole(), 'admin');
  const bots = useBots(workspaceId);

  if (bots.isError) return <FormAlert message={errorMessage(bots.error)} />;
  if (bots.isPending) return <Skeleton className="h-32 w-full" />;
  const rows = bots.data;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{strings.bots.title}</h1>
          <p className="text-sm text-muted-foreground">{strings.bots.intro}</p>
        </div>
        {isAdmin ? (
          <Button asChild>
            <Link to="/w/$workspaceId/bots/new" params={{ workspaceId }}>
              {strings.bots.newBot}
            </Link>
          </Button>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{strings.bots.empty}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{strings.bots.name}</TableHead>
              <TableHead>{strings.bots.chatModel}</TableHead>
              <TableHead>{strings.bots.embeddingModel}</TableHead>
              <TableHead>{strings.bots.publicKey}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((bot) => (
              <TableRow key={bot.id}>
                <TableCell>
                  <Link
                    className="underline"
                    to="/w/$workspaceId/bots/$botId/general"
                    params={{ workspaceId, botId: bot.id }}
                  >
                    {bot.name}
                  </Link>
                </TableCell>
                <TableCell>{bot.chatModel}</TableCell>
                <TableCell>{bot.embeddingModel}</TableCell>
                <TableCell>
                  <code className="text-xs">{bot.publicKey}</code>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
