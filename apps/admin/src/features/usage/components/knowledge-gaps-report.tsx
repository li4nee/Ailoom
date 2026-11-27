// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from '@tanstack/react-router';
import { useState } from 'react';

import { FormAlert } from '@/components/form-alert';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useBots } from '@/features/bots/api';
import { AddSourceDialog } from '@/features/knowledge/components/add-source-dialog';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';

import { useKnowledgeGaps, type UsageRange } from '../api';

function lastThirtyUtcDays(): UsageRange {
  const end = new Date();
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() - 29));
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

function validRange(from: string, to: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    return false;
  }
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    new Date(start).toISOString().slice(0, 10) !== from ||
    new Date(end).toISOString().slice(0, 10) !== to
  ) {
    return false;
  }
  const days = (end - start) / 86_400_000 + 1;
  return Number.isFinite(days) && days <= 90;
}

function DailyTrend({ points }: { points: { day: string; count: number }[] }) {
  const maxCount = Math.max(1, ...points.map((point) => point.count));
  return (
    <div aria-label={strings.usage.gapDailyTrend}>
      <h2 className="mb-2 text-sm font-medium">{strings.usage.gapDailyTrend}</h2>
      <ol className="flex min-h-24 items-end gap-2 overflow-x-auto border-b pb-1">
        {points.map((point) => (
          <li key={point.day} className="flex min-w-9 flex-col items-center gap-1">
            <span className="text-xs text-muted-foreground">{point.count}</span>
            <span
              aria-hidden="true"
              title={`${point.day}: ${String(point.count)}`}
              className="w-4 rounded-t bg-primary"
              style={{ height: `${String(Math.max(4, (point.count / maxCount) * 56))}px` }}
            />
            <time dateTime={point.day} className="text-xs text-muted-foreground">
              {point.day.slice(5)}
            </time>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function KnowledgeGapsReport({ workspaceId }: { workspaceId: string }) {
  const initial = lastThirtyUtcDays();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [botId, setBotId] = useState('');
  const [range, setRange] = useState<UsageRange>(initial);
  const [rangeError, setRangeError] = useState(false);
  const bots = useBots(workspaceId);
  const report = useKnowledgeGaps(workspaceId, range);
  const groupCount = report.data?.totalGroups ?? 0;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold">{strings.usage.knowledgeGaps}</h1>
        <p className="text-sm text-muted-foreground">{strings.usage.knowledgeGapsIntro}</p>
      </header>
      <form
        className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={(event) => {
          event.preventDefault();
          const isValid = validRange(from, to);
          setRangeError(!isValid);
          if (isValid) setRange({ from, to, ...(botId ? { botId } : {}) });
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="gap-from">{strings.usage.from}</Label>
          <Input
            id="gap-from"
            type="date"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
            }}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="gap-to">{strings.usage.to}</Label>
          <Input
            id="gap-to"
            type="date"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
            }}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="gap-bot">{strings.conversations.bot}</Label>
          <NativeSelect
            id="gap-bot"
            value={botId}
            onChange={(event) => {
              setBotId(event.target.value);
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
        <Button type="submit" className="self-end">
          {strings.usage.apply}
        </Button>
      </form>
      {rangeError ? (
        <p role="alert" className="text-sm text-destructive">
          {strings.usage.gapInvalidRange}
        </p>
      ) : null}
      <FormAlert message={errorMessage(report.error)} />
      {report.isLoading ? <p role="status">{strings.app.loading}</p> : null}
      {report.data ? (
        <div className="space-y-1 text-sm text-muted-foreground">
          <p>{strings.usage.gapSelectedRange(range.from, range.to)}</p>
          <p>
            {report.data.totalMessages} {strings.usage.gapTotal}
          </p>
        </div>
      ) : null}
      {groupCount > 50 ? (
        <p role="status" className="text-sm text-muted-foreground">
          {strings.usage.gapTopLimit}
        </p>
      ) : null}
      {report.data?.groups.length === 0 ? (
        <p className="rounded-md border p-4 text-sm text-muted-foreground" role="status">
          {strings.usage.noKnowledgeGaps}
        </p>
      ) : null}
      <ul className="space-y-3">
        {(report.data?.groups ?? []).map((group) => (
          <li key={`${group.botId}:${group.wording}`} className="rounded-lg border p-4">
            <details>
              <summary className="cursor-pointer list-none">
                <span className="font-medium">{group.wording}</span>
                <span className="ml-2 text-sm text-muted-foreground">{group.botName}</span>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-muted-foreground">{strings.usage.gapOccurrences}</dt>
                    <dd>{group.occurrences}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{strings.usage.gapConversations}</dt>
                    <dd>{group.conversations}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{strings.usage.gapLastSeen}</dt>
                    <dd>{new Date(group.lastSeen).toLocaleString()}</dd>
                  </div>
                </dl>
              </summary>
              <div className="mt-4 space-y-4 border-t pt-4">
                <DailyTrend points={group.daily} />
                <h2 className="text-sm font-medium">{strings.usage.gapExamples}</h2>
                <p className="text-sm text-muted-foreground">{strings.usage.gapReviewPrompt}</p>
                <ul className="space-y-2">
                  {group.examples.map((example) => (
                    <li key={example.messageId} className="rounded-md bg-muted/50 p-3 text-sm">
                      <p>{example.content}</p>
                      <Link
                        to="/w/$workspaceId/conversations/$conversationId"
                        params={{ workspaceId, conversationId: example.conversationId }}
                        className="mt-2 inline-flex min-h-10 items-center underline underline-offset-2"
                      >
                        {strings.conversations.open} ·{' '}
                        {new Date(example.createdAt).toLocaleString()}
                      </Link>
                    </li>
                  ))}
                </ul>
                <p className="text-sm text-muted-foreground">{strings.usage.testRetrievalHint}</p>
                <Link
                  to="/w/$workspaceId/knowledge/suggestions"
                  params={{ workspaceId }}
                  className="inline-flex min-h-10 items-center underline underline-offset-2"
                >
                  {strings.usage.gapCorrectionQueue}
                </Link>
                <AddSourceDialog
                  workspaceId={workspaceId}
                  botId={group.botId}
                  triggerLabel={strings.usage.reviewKnowledge}
                />
              </div>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}
