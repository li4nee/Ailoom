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

import { useCursorPager, useUnanswered } from '../api';

export function UnansweredReport({ workspaceId }: { workspaceId: string }) {
  const [botId, setBotId] = useState<string | undefined>(undefined);
  const pager = useCursorPager();
  const bots = useBots(workspaceId);
  const report = useUnanswered(workspaceId, {
    ...(botId === undefined ? {} : { botId }),
    ...(pager.cursor === undefined ? {} : { cursor: pager.cursor }),
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
            pager.reset();
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
          <ul className="space-y-3 md:hidden">
            {report.data.data.map((row) => (
              <li key={row.messageId} className="ledger-panel min-w-0 space-y-3 p-4">
                <p className="break-words text-sm">{row.content}</p>
                <dl className="grid grid-cols-2 gap-3 border-t border-border pt-3 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">{strings.usage.topScore}</dt>
                    <dd className="tabular-nums">
                      {row.topScore === null
                        ? strings.conversations.trace.none
                        : row.topScore.toFixed(3)}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">{strings.usage.askedAt}</dt>
                    <dd className="break-words">{new Date(row.createdAt).toLocaleString()}</dd>
                  </div>
                </dl>
                <div className="flex flex-wrap items-center gap-3">
                  <Link
                    to="/w/$workspaceId/conversations/$conversationId"
                    params={{ workspaceId, conversationId: row.conversationId }}
                    className="inline-flex min-h-10 items-center text-sm underline underline-offset-2"
                  >
                    {strings.conversations.open}
                  </Link>
                  <AddSourceDialog
                    workspaceId={workspaceId}
                    botId={row.botId}
                    triggerLabel={strings.usage.addKnowledge}
                  />
                </div>
              </li>
            ))}
          </ul>
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{strings.usage.question}</TableHead>
                  <TableHead>{strings.usage.topScore}</TableHead>
                  <TableHead>{strings.usage.conversation}</TableHead>
                  <TableHead>{strings.usage.askedAt}</TableHead>
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
          </div>
          <div className="flex gap-2">
            {pager.hasPrevious ? (
              <Button
                variant="outline"
                onClick={() => {
                  pager.previous();
                }}
              >
                {strings.app.previousPage}
              </Button>
            ) : null}
            {report.data.nextCursor === null ? null : (
              <Button
                variant="outline"
                onClick={() => {
                  const next = report.data.nextCursor;
                  if (next !== null) pager.next(next);
                }}
              >
                {strings.app.nextPage}
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
