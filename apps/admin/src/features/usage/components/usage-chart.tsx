// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { strings } from '@/strings';
import type { UsageDay } from '@app/shared';

function maxOf(values: number[]): number {
  return Math.max(0, ...values);
}

function Bars({
  days,
  values,
  label,
  format,
  emptyLabel,
}: {
  days: UsageDay[];
  values: number[];
  label: string;
  format: (value: number) => string;
  emptyLabel: string;
}) {
  const max = maxOf(values);
  const width = 640;
  const height = 140;
  const gap = Math.min(2, (width / Math.max(1, values.length)) * 0.4);
  const barWidth = (width - gap * values.length) / Math.max(1, values.length);

  return (
    <figure className="space-y-1">
      <figcaption className="text-xs font-medium text-muted-foreground">{label}</figcaption>
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${String(width)} ${String(height)}`}
        className="h-36 w-full"
      >
        <title>{label}</title>
        {values.map((value, index) => {
          const barHeight = max === 0 ? 0 : (value / max) * (height - 8);
          return (
            <rect
              key={days[index]?.day ?? index}
              x={index * (barWidth + gap)}
              y={height - barHeight}
              width={barWidth}
              height={barHeight}
              className="fill-primary"
            >
              <title>{`${days[index]?.day ?? ''}: ${format(value)}`}</title>
            </rect>
          );
        })}
      </svg>
      {max === 0 ? <p className="text-xs text-muted-foreground">{emptyLabel}</p> : null}
    </figure>
  );
}

/** The report's data is always available as a table; the chart is an additional view. */
export function UsageChart({ days }: { days: UsageDay[] }) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const costs = days.map((day) => Number(day.costUsd));
  const messages = days.map((day) => day.visitorMessages + day.aiMessages);

  return (
    <section className="space-y-3">
      <div className="flex gap-2">
        <Button
          size="sm"
          variant={view === 'chart' ? 'default' : 'outline'}
          aria-pressed={view === 'chart'}
          onClick={() => {
            setView('chart');
          }}
        >
          {strings.usage.chartView}
        </Button>
        <Button
          size="sm"
          variant={view === 'table' ? 'default' : 'outline'}
          aria-pressed={view === 'table'}
          onClick={() => {
            setView('table');
          }}
        >
          {strings.usage.table}
        </Button>
      </div>

      {days.length === 0 ? (
        <p className="text-sm text-muted-foreground">{strings.usage.empty}</p>
      ) : view === 'chart' ? (
        <div className="space-y-3 rounded-lg border p-3">
          <Bars
            days={days}
            values={costs}
            label={strings.usage.chart}
            format={(value) => `$${value.toFixed(6)}`}
            emptyLabel={strings.usage.zeroCost}
          />
          <Bars
            days={days}
            values={messages}
            label={strings.usage.messages}
            format={(value) => String(value)}
            emptyLabel={strings.usage.zeroMessages}
          />
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{strings.usage.day}</TableHead>
              <TableHead>{strings.usage.conversations}</TableHead>
              <TableHead>{strings.usage.visitorMessages}</TableHead>
              <TableHead>{strings.usage.aiMessages}</TableHead>
              <TableHead>{strings.usage.escalations}</TableHead>
              <TableHead>{strings.usage.tokens}</TableHead>
              <TableHead>{strings.usage.cost}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {days.map((day) => (
              <TableRow key={day.day}>
                <TableCell>{day.day}</TableCell>
                <TableCell className="tabular-nums">{day.conversations}</TableCell>
                <TableCell className="tabular-nums">{day.visitorMessages}</TableCell>
                <TableCell className="tabular-nums">{day.aiMessages}</TableCell>
                <TableCell className="tabular-nums">{day.escalations}</TableCell>
                <TableCell className="tabular-nums">
                  {day.inputTokens + day.outputTokens + day.embeddingTokens}
                </TableCell>
                <TableCell className="tabular-nums">${day.costUsd}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
