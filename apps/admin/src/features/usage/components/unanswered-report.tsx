// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from '@tanstack/react-router';
import { useState } from 'react';

import { FormAlert } from '@/components/form-alert';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useBots } from '@/features/bots/api';
import { AddSourceDialog } from '@/features/knowledge/components/add-source-dialog';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';

import { useUnanswered } from '../api';

export function UnansweredReport({ workspaceId }: { workspaceId: string }) {
  const [botId, setBotId] = useState<string | undefined>(undefined);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const bots = useBots(workspaceId);
  const report = useUnanswered(workspaceId, {
    ...(botId === undefined ? {} : { botId }),
    ...(cursor === undefined ? {} : { cursor }),
  });

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">{strings.usage.unanswered}</h1>
        <p className="text-sm text-muted-foreground">{strings.usage.unansweredIntro}</p>
      </header>

      <div className="max-w-64 space-y-2">
        <label className="text-sm font-medium" htmlFor="unanswered-bot">
          {strings.conversations.bot}
        </label>
        <NativeSelect
          id="unanswered-bot"
          value={botId ?? ''}
          onChange={(event) => {
            setCursor(undefined);
            setBotId(event.target.value === '' ? undefined : event.target.value);
          }}
        >
          <option value="">{strings.conversations.allBots}</option>
          {(bots.data ?? []).map((bot) => (
            <option key={bot.id} value={bot.id}>
              {bot.name}
            </option>
          ))}
        </NativeSelect>
      </div>

      <FormAlert message={errorMessage(report.error)} />
      {report.isLoading ? <p role="status">{strings.app.loading}</p> : null}
      {report.data?.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{strings.usage.emptyUnanswered}</p>
      ) : null}

      {report.data === undefined || report.data.data.length === 0 ? null : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{strings.usage.question}</TableHead>
                <TableHead>{strings.usage.topScore}</TableHead>
                <TableHead>{strings.usage.conversation}</TableHead>
                <TableHead>{strings.conversations.lastMessage}</TableHead>
                <TableHead>{strings.usage.addKnowledge}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.data.data.map((row) => (
                <TableRow key={row.messageId}>
                  <TableCell className="max-w-96 whitespace-normal">{row.content}</TableCell>
                  <TableCell className="tabular-nums">
                    {row.topScore === null
                      ? strings.conversations.trace.none
                      : row.topScore.toFixed(3)}
                  </TableCell>
                  <TableCell>
                    <Link
                      to="/w/$workspaceId/conversations/$conversationId"
                      params={{ workspaceId, conversationId: row.conversationId }}
                      className="underline underline-offset-2"
                    >
                      {strings.conversations.open}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(row.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <AddSourceDialog
                      workspaceId={workspaceId}
                      botId={row.botId}
                      triggerLabel={strings.usage.addKnowledge}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {report.data.nextCursor === null ? null : (
            <Button
              variant="outline"
              onClick={() => {
                const next = report.data.nextCursor;
                if (next !== null) setCursor(next);
              }}
            >
              {strings.usage.nextPage}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
