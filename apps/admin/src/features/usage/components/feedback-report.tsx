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
import { useConversation } from '@/features/conversations/api';
import { useCreateEvalCase, useEvalDatasets } from '@/features/eval/api';
import { TraceDrawer } from '@/features/traces/components/trace-drawer';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';

import { useCursorPager, useFeedback } from '../api';

function AddFeedbackToDataset({
  workspaceId,
  conversationId,
  messageId,
}: {
  workspaceId: string;
  conversationId: string;
  messageId: string;
}) {
  const [open, setOpen] = useState(false);
  const [datasetId, setDatasetId] = useState('');
  const [added, setAdded] = useState(false);
  const conversation = useConversation(workspaceId, conversationId, open);
  const botId = conversation.data?.conversation.botId ?? '';
  const datasets = useEvalDatasets(workspaceId, botId, open && botId !== '');
  const addCase = useCreateEvalCase(workspaceId, botId, datasetId);
  const messages = conversation.data?.messages ?? [];
  const targetIndex = messages.findIndex((message) => message.id === messageId);
  const question =
    targetIndex < 0
      ? null
      : ([...messages.slice(0, targetIndex)].reverse().find((message) => message.role === 'visitor')
          ?.content ?? null);
  if (added)
    return <span className="text-sm text-muted-foreground">Added to evaluation dataset.</span>;
  return (
    <div className="space-y-2">
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        Add to dataset
      </Button>
      {open ? (
        <div className="flex flex-wrap items-center gap-2">
          {conversation.isPending ? (
            <span role="status" className="text-sm text-muted-foreground">
              Loading question…
            </span>
          ) : null}
          {question === null && !conversation.isPending ? (
            <span className="text-sm text-muted-foreground">
              No visitor question was found for this answer.
            </span>
          ) : null}
          <select
            aria-label="Evaluation dataset"
            className="min-h-9 max-w-64 rounded-md border bg-background px-2 text-sm"
            value={datasetId}
            onChange={(event) => {
              setDatasetId(event.target.value);
            }}
          >
            <option value="">Choose dataset</option>
            {(datasets.data ?? []).map((dataset) => (
              <option key={dataset.id} value={dataset.id}>
                {dataset.name}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            disabled={!question || !datasetId || addCase.isPending}
            onClick={() => {
              if (question === null) return;
              addCase.mutate(
                {
                  question,
                  expectedDocumentIds: [],
                  toolFixtures: [],
                  history: [],
                  mustInclude: [],
                  mustNotInclude: [],
                  needsExpectation: true,
                  origin: 'feedback',
                  originRef: messageId,
                },
                {
                  onSuccess: () => {
                    setAdded(true);
                  },
                },
              );
            }}
          >
            Save case
          </Button>
          {addCase.isError ? (
            <span role="alert" className="text-sm text-destructive">
              {errorMessage(addCase.error)}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

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
          <ul className="space-y-3 md:hidden">
            {report.data.data.map((row) => (
              <li key={row.messageId} className="ledger-panel min-w-0 space-y-3 p-4">
                <p className="break-words text-sm">{row.content}</p>
                <dl className="grid grid-cols-2 gap-3 border-t border-border pt-3 text-sm">
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">
                      {strings.conversations.trace.feedback}
                    </dt>
                    <dd className="break-words">
                      {row.feedbackAt === null
                        ? strings.conversations.trace.none
                        : new Date(row.feedbackAt).toLocaleString()}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">
                      {strings.conversations.detail.details}
                    </dt>
                    <dd className="break-words">
                      {row.traceId === null ? (
                        strings.conversations.trace.none
                      ) : (
                        <TraceDrawer workspaceId={workspaceId} traceId={row.traceId} />
                      )}
                    </dd>
                  </div>
                </dl>
                <Link
                  to="/w/$workspaceId/conversations/$conversationId"
                  params={{ workspaceId, conversationId: row.conversationId }}
                  className="inline-flex min-h-10 items-center text-sm underline underline-offset-2"
                >
                  {strings.conversations.open}
                </Link>
                <AddFeedbackToDataset
                  workspaceId={workspaceId}
                  conversationId={row.conversationId}
                  messageId={row.messageId}
                />
              </li>
            ))}
          </ul>
          <div className="hidden md:block">
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
                      <AddFeedbackToDataset
                        workspaceId={workspaceId}
                        conversationId={row.conversationId}
                        messageId={row.messageId}
                      />
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
