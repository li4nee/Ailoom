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
import { TraceDrawer } from '@/features/traces/components/trace-drawer';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';

import { useCursorPager, useFeedback } from '../api';

export function FeedbackReport({ workspaceId }: { workspaceId: string }) {
  const [botId, setBotId] = useState<string | undefined>(undefined);
  const pager = useCursorPager();
  const bots = useBots(workspaceId);
  const report = useFeedback(workspaceId, {
    rating: '-1',
    ...(botId === undefined ? {} : { botId }),
    ...(pager.cursor === undefined ? {} : { cursor: pager.cursor }),
  });

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">{strings.usage.feedback}</h1>
        <p className="text-sm text-muted-foreground">{strings.usage.feedbackIntro}</p>
      </header>

      <div className="max-w-64 space-y-2">
        <label className="text-sm font-medium" htmlFor="feedback-bot">
          {strings.conversations.bot}
        </label>
        <NativeSelect
          id="feedback-bot"
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
        <p className="text-sm text-muted-foreground">{strings.usage.emptyFeedback}</p>
      ) : null}

      {report.data === undefined || report.data.data.length === 0 ? null : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{strings.usage.answer}</TableHead>
                <TableHead>{strings.usage.conversation}</TableHead>
                <TableHead>{strings.conversations.trace.feedback}</TableHead>
                <TableHead>{strings.conversations.detail.details}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.data.data.map((row) => (
                <TableRow key={row.messageId}>
                  <TableCell className="max-w-96 whitespace-normal">{row.content}</TableCell>
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
                    {row.feedbackAt === null
                      ? strings.conversations.trace.none
                      : new Date(row.feedbackAt).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    {row.traceId === null ? (
                      strings.conversations.trace.none
                    ) : (
                      <TraceDrawer workspaceId={workspaceId} traceId={row.traceId} />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
