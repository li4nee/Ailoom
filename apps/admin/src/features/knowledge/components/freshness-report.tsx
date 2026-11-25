// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from '@tanstack/react-router';

import { FormAlert } from '@/components/form-alert';
import { Skeleton } from '@/components/ui/skeleton';
import { useBots } from '@/features/bots/api';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';
import type { FreshnessQuery } from '@app/shared';

import { useFreshness } from '../api';

export function FreshnessReport({
  workspaceId,
  filters,
  onChange,
}: {
  workspaceId: string;
  filters: FreshnessQuery;
  onChange: (filters: FreshnessQuery) => void;
}) {
  const bots = useBots(workspaceId);
  const report = useFreshness(workspaceId, filters);
  if (report.isError) return <FormAlert message={errorMessage(report.error)} />;
  if (report.isPending) return <Skeleton className="h-40 w-full" />;
  const items = report.data.pages.flatMap((page) => page.data);
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <label className="text-sm">
          {strings.knowledge.freshness.days}
          <select
            className="ml-2 rounded-md border bg-background p-2"
            value={filters.days}
            onChange={(event) => {
              onChange({ ...filters, days: Number(event.currentTarget.value) });
            }}
          >
            {[7, 30, 90, 180, 365].map((days) => (
              <option key={days} value={days}>
                {days}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          {strings.knowledge.freshness.bot}
          <select
            className="ml-2 rounded-md border bg-background p-2"
            value={filters.botId ?? ''}
            onChange={(event) => {
              const botId = event.currentTarget.value;
              onChange({ days: filters.days, ...(botId === '' ? {} : { botId }) });
            }}
          >
            <option value="">{strings.knowledge.freshness.allBots}</option>
            {bots.data?.map((bot) => (
              <option key={bot.id} value={bot.id}>
                {bot.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {bots.isError ? <FormAlert message={errorMessage(bots.error)} /> : null}
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{strings.knowledge.freshness.empty}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {items.map((item) => (
            <li
              key={item.documentId}
              className="flex flex-wrap items-center justify-between gap-3 p-3"
            >
              <div className="min-w-0">
                <Link
                  to="/w/$workspaceId/bots/$botId/knowledge/documents/$documentId"
                  params={{ workspaceId, botId: item.botId, documentId: item.documentId }}
                  className="font-medium underline"
                >
                  {item.title ?? item.url ?? strings.knowledge.document.title}
                </Link>
                <p className="break-all text-xs text-muted-foreground">
                  {item.url ?? strings.knowledge.types.text}
                </p>
              </div>
              <div className="text-right text-xs text-muted-foreground">
                <p>
                  {item.status === 'unreachable'
                    ? strings.knowledge.unreachable
                    : item.status === 'removed'
                      ? strings.knowledge.removed
                      : strings.knowledge.freshness.stale}
                </p>
                <p>
                  {strings.knowledge.freshness.checked}:{' '}
                  {item.lastCheckedAt === null
                    ? strings.knowledge.freshness.never
                    : new Date(item.lastCheckedAt).toLocaleDateString()}
                </p>
                <p>
                  {strings.knowledge.freshness.changed}:{' '}
                  {item.lastChangedAt === null
                    ? strings.knowledge.freshness.never
                    : new Date(item.lastChangedAt).toLocaleDateString()}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {report.hasNextPage ? (
        <button
          type="button"
          className="rounded-md border px-3 py-2 text-sm"
          disabled={report.isFetchingNextPage}
          onClick={() => void report.fetchNextPage()}
        >
          {report.isFetchingNextPage
            ? strings.knowledge.freshness.loadingMore
            : strings.knowledge.freshness.loadMore}
        </button>
      ) : null}
    </section>
  );
}
