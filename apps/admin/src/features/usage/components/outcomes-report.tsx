// SPDX-License-Identifier: AGPL-3.0-only
import { useState, type ReactNode } from 'react';

import { FormAlert } from '@/components/form-alert';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useBots } from '@/features/bots/api';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';
import type { OutcomesDto } from '@app/shared';

import { type UsageRange, useOutcomes } from '../api';

const DEFINITIONS = {
  conversations:
    'Conversations created in the selected UTC date range that contain at least one visitor message.',
  pending: 'Open conversations with no handoff that are still inside the 24-hour idle window.',
  handoffRate: 'Conversations with a handoff timestamp divided by all conversations.',
  aiResolved:
    'No handoff; at least one complete AI answer; no AI thumbs-down; and closed or idle for at least 24 hours.',
  aiResolutionRate:
    'AI-resolved conversations divided by AI-resolved plus handed-off conversations. Pending conversations are excluded.',
  firstHumanResponse:
    'For handed-off conversations, the median and p90 seconds from the first handoff to the first agent reply. Unanswered conversations are reported separately.',
  resolutionTime:
    'For handed-off conversations that are closed, the median and p90 seconds from first handoff to closure.',
  csat: 'Among rated conversations, satisfied means a score of 4 or 5. Response rate is rated divided by closed conversations.',
  cost: 'All generation-trace cost for these conversations, including agent-assist traces, divided by AI-resolved plus closed handed-off conversations. Playground is excluded.',
} as const;

function percent(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`;
}

function score(value: number | null): string {
  return value === null ? '—' : value.toFixed(2);
}

function duration(value: number | null): string {
  if (value === null) return '—';
  if (value < 60) return `${String(Math.round(value))} ${strings.usage.seconds}`;
  const minutes = Math.round(value / 60);
  if (minutes < 60) return `${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${String(hours)} hr` : `${String(hours)} hr ${String(remainder)} min`;
}

function Definition({ text }: { text: string }) {
  return (
    <button
      type="button"
      title={text}
      aria-label={`${strings.usage.definitions}: ${text}`}
      className="ml-1 inline-flex size-5 cursor-help items-center justify-center rounded-full border text-xs text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      i
    </button>
  );
}

function Metric({
  label,
  definition,
  children,
}: {
  label: string;
  definition: string;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-lg border bg-card p-4">
      <h2 className="flex min-h-10 items-start text-sm font-medium text-muted-foreground">
        {label}
        <Definition text={definition} />
      </h2>
      {children}
    </section>
  );
}

function DailyChart({ report }: { report: OutcomesDto }) {
  const width = 720;
  const height = 160;
  const max = Math.max(1, ...report.daily.map((day) => day.aiResolved + day.handedOff));
  const gap = Math.min(3, (width / Math.max(1, report.daily.length)) * 0.35);
  const barWidth = (width - gap * report.daily.length) / Math.max(1, report.daily.length);

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <h2 className="text-sm font-medium">{strings.usage.outcomesChart}</h2>
      {report.conversations === 0 ? (
        <p className="text-sm text-muted-foreground">{strings.usage.outcomesEmpty}</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-4 text-xs" aria-label={strings.usage.outcomesChart}>
            <span className="inline-flex items-center gap-2">
              <span aria-hidden="true" className="size-3 rounded-sm bg-primary" />
              {strings.usage.aiResolved}
            </span>
            <span className="inline-flex items-center gap-2">
              <span aria-hidden="true" className="size-3 rounded-sm bg-chart-2" />
              {strings.usage.handedOff}
            </span>
          </div>
          <svg
            role="img"
            aria-label={strings.usage.outcomesChart}
            viewBox={`0 0 ${String(width)} ${String(height)}`}
            className="h-40 w-full"
          >
            <title>{strings.usage.outcomesChart}</title>
            {report.daily.map((day, index) => {
              const x = index * (barWidth + gap);
              const aiHeight = (day.aiResolved / max) * (height - 8);
              const handoffHeight = (day.handedOff / max) * (height - 8);
              return (
                <g key={day.day}>
                  <rect
                    x={x}
                    y={height - aiHeight}
                    width={barWidth}
                    height={aiHeight}
                    className="fill-primary"
                  />
                  <rect
                    x={x}
                    y={height - aiHeight - handoffHeight}
                    width={barWidth}
                    height={handoffHeight}
                    className="fill-chart-2"
                  >
                    <title>{`${day.day}: ${String(day.aiResolved)} ${strings.usage.aiResolved}, ${String(day.handedOff)} ${strings.usage.handedOff}`}</title>
                  </rect>
                </g>
              );
            })}
          </svg>
        </>
      )}
    </section>
  );
}

export function OutcomesReport({
  workspaceId,
  range: appliedRange,
  onRangeChange,
}: {
  workspaceId: string;
  range: UsageRange;
  onRangeChange: (range: UsageRange) => void;
}) {
  const [from, setFrom] = useState(appliedRange.from);
  const [to, setTo] = useState(appliedRange.to);
  const [botId, setBotId] = useState(appliedRange.botId ?? '');
  const report = useOutcomes(workspaceId, appliedRange);
  const bots = useBots(workspaceId);
  const data = report.data;
  const botOptions = bots.data ?? [];

  return (
    <div className="space-y-5">
      <header>
        <h1 className="ledger-heading text-3xl">{strings.usage.outcomes}</h1>
        <p className="text-sm text-muted-foreground">{strings.usage.outcomesIntro}</p>
      </header>

      <form
        className="ledger-panel grid w-full grid-cols-1 items-end gap-3 p-4 sm:grid-cols-2 lg:flex"
        onSubmit={(event) => {
          event.preventDefault();
          if (from !== '' && to !== '' && from <= to) {
            onRangeChange({ from, to, ...(botId === '' ? {} : { botId }) });
          }
        }}
      >
        <div className="min-w-0 space-y-2">
          <Label htmlFor="outcomes-from">{strings.usage.from}</Label>
          <Input
            id="outcomes-from"
            type="date"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
            }}
          />
        </div>
        <div className="min-w-0 space-y-2">
          <Label htmlFor="outcomes-to">{strings.usage.to}</Label>
          <Input
            id="outcomes-to"
            type="date"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
            }}
          />
        </div>
        <div className="min-w-0 space-y-2 lg:min-w-48">
          <Label htmlFor="outcomes-bot">{strings.conversations.bot}</Label>
          <NativeSelect
            id="outcomes-bot"
            value={botId}
            onChange={(event) => {
              setBotId(event.target.value);
            }}
          >
            <option value="">{strings.conversations.allBots}</option>
            {botOptions.map((bot) => (
              <option key={bot.id} value={bot.id}>
                {bot.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit" className="w-full sm:w-auto">
          {strings.usage.apply}
        </Button>
      </form>

      <FormAlert message={errorMessage(report.error)} />
      {report.isLoading ? (
        <div className="space-y-4" role="status" aria-label={strings.app.loading}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton key={index} className="h-24" />
            ))}
          </div>
          <Skeleton className="h-48" />
        </div>
      ) : null}
      {data === undefined ? null : (
        <>
          {data.conversations === 0 ? (
            <p className="rounded-md border p-4 text-sm text-muted-foreground" role="status">
              {strings.usage.outcomesEmpty}
            </p>
          ) : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label={strings.usage.conversations} definition={DEFINITIONS.conversations}>
              <p className="text-2xl font-semibold tabular-nums">{data.conversations}</p>
            </Metric>
            <Metric label={strings.usage.pending} definition={DEFINITIONS.pending}>
              <p className="text-2xl font-semibold tabular-nums">{data.pending}</p>
            </Metric>
            <Metric label={strings.usage.handoffRate} definition={DEFINITIONS.handoffRate}>
              <p className="text-2xl font-semibold tabular-nums">{percent(data.handoffRate)}</p>
              <p className="text-xs text-muted-foreground">
                {data.handedOff} {strings.usage.handedOff}
              </p>
            </Metric>
            <Metric
              label={strings.usage.aiResolutionRate}
              definition={DEFINITIONS.aiResolutionRate}
            >
              <p className="text-2xl font-semibold tabular-nums">
                {percent(data.aiResolutionRate)}
              </p>
              <p className="text-xs text-muted-foreground">
                {data.aiResolved} {strings.usage.aiResolved}
              </p>
            </Metric>
            <Metric
              label={strings.usage.firstHumanResponse}
              definition={DEFINITIONS.firstHumanResponse}
            >
              <p className="text-2xl font-semibold tabular-nums">
                {duration(data.firstHumanResponse.medianSeconds)}
              </p>
              <p className="text-xs text-muted-foreground">
                p90 {duration(data.firstHumanResponse.p90Seconds)}
              </p>
              <p className="text-xs text-muted-foreground">
                {strings.usage.unansweredHandoffs}: {data.firstHumanResponse.unanswered}
              </p>
            </Metric>
            <Metric label={strings.usage.resolutionTime} definition={DEFINITIONS.resolutionTime}>
              <p className="text-2xl font-semibold tabular-nums">
                {duration(data.resolutionTime.medianSeconds)}
              </p>
              <p className="text-xs text-muted-foreground">
                p90 {duration(data.resolutionTime.p90Seconds)}
              </p>
            </Metric>
            <Metric label={strings.usage.csat} definition={DEFINITIONS.csat}>
              <p className="text-2xl font-semibold tabular-nums">
                {percent(data.csat.satisfiedRate)}
              </p>
              <p className="text-xs text-muted-foreground">
                {strings.usage.averageScore}: {score(data.csat.averageScore)} / 5
              </p>
              <p className="text-xs text-muted-foreground">
                {strings.usage.responseRate}: {percent(data.csat.responseRate)} ·{' '}
                {data.csat.ratings} {strings.usage.ratings}
              </p>
            </Metric>
            <Metric label={strings.usage.costPerResolved} definition={DEFINITIONS.cost}>
              <p className="text-2xl font-semibold tabular-nums">
                {data.costPerResolvedUsd === null ? '—' : `$${data.costPerResolvedUsd}`}
              </p>
            </Metric>
          </div>
          <DailyChart report={data} />
        </>
      )}
    </div>
  );
}
