// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';

import { FormAlert } from '@/components/form-alert';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useBots } from '@/features/bots/api';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';

import { defaultUsageRange, useUsage, type UsageRange } from '../api';
import { UsageChart } from './usage-chart';
import { UsageTotals } from './usage-totals';

export function UsageReport({ workspaceId }: { workspaceId: string }) {
  const initial = defaultUsageRange();
  const [range, setRange] = useState<UsageRange>(initial);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const report = useUsage(workspaceId, range);
  const bots = useBots(workspaceId);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="ledger-heading text-3xl">{strings.usage.title}</h1>
        <p className="text-sm text-muted-foreground">{strings.usage.intro}</p>
      </header>

      <form
        className="ledger-panel grid w-full grid-cols-1 items-end gap-3 p-4 sm:grid-cols-2 lg:flex"
        onSubmit={(event) => {
          event.preventDefault();
          if (from !== '' && to !== '' && from <= to) {
            setRange({ ...range, from, to });
          }
        }}
      >
        <div className="min-w-0 space-y-2">
          <Label htmlFor="usage-from">{strings.usage.from}</Label>
          <Input
            id="usage-from"
            type="date"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
            }}
          />
        </div>
        <div className="min-w-0 space-y-2">
          <Label htmlFor="usage-to">{strings.usage.to}</Label>
          <Input
            id="usage-to"
            type="date"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
            }}
          />
        </div>
        <div className="min-w-0 space-y-2 lg:min-w-48">
          <Label htmlFor="usage-bot">{strings.conversations.bot}</Label>
          <NativeSelect
            id="usage-bot"
            value={range.botId ?? ''}
            onChange={(event) => {
              const value = event.target.value;
              setRange((current) => {
                const next = { from: current.from, to: current.to };
                return value === '' ? next : { ...next, botId: value };
              });
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
        <Button type="submit" className="w-full sm:w-auto">
          {strings.usage.apply}
        </Button>
      </form>

      <FormAlert message={errorMessage(report.error)} />
      {report.isLoading ? (
        <div className="space-y-4" role="status" aria-label={strings.app.loading}>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton key={index} className="h-20" />
            ))}
          </div>
          <Skeleton className="h-64" />
        </div>
      ) : null}
      {report.data === undefined ? null : (
        <>
          <UsageTotals report={report.data} />
          <UsageChart days={report.data.days} />
        </>
      )}
    </div>
  );
}
