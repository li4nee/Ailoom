// SPDX-License-Identifier: AGPL-3.0-only
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useBots } from '@/features/bots/api';
import { strings } from '@/strings';
import { CONVERSATION_STATUSES, PRIORITIES } from '@app/shared';

import type { InboxFilters as Filters } from '../api';

type TextFilter = 'botId' | 'status' | 'assignedTo' | 'priority' | 'q';

function setFilter(filters: Filters, key: TextFilter, value: string): Filters {
  const kept = Object.fromEntries(
    Object.entries(filters).filter(([name]) => name !== key && name !== 'cursor'),
  ) as Filters;
  return value === '' ? kept : { ...kept, [key]: value };
}

/** Filters live in the URL so a reload, bookmark or back button restores the same inbox. */
export function InboxFilters({
  workspaceId,
  filters,
  onChange,
}: {
  workspaceId: string;
  filters: Filters;
  onChange: (next: Filters) => void;
}) {
  const bots = useBots(workspaceId);
  const activeFilterCount = Object.entries(filters).filter(
    ([key, value]) => key !== 'cursor' && key !== 'limit' && value !== undefined && value !== '',
  ).length;

  return (
    <form
      className="space-y-4 rounded-xl border bg-card p-4 shadow-sm"
      onSubmit={(event) => {
        event.preventDefault();
      }}
      aria-label={strings.conversations.title}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">{strings.conversations.filters}</h2>
          {activeFilterCount > 0 ? (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {strings.conversations.activeFilterCount(activeFilterCount)}
            </span>
          ) : null}
        </div>
        {activeFilterCount > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onChange({});
            }}
          >
            {strings.conversations.clearFilters}
          </Button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1 space-y-2">
          <Label htmlFor="inbox-search">{strings.conversations.search}</Label>
          <Input
            id="inbox-search"
            value={filters.q ?? ''}
            placeholder={strings.conversations.searchPlaceholder}
            onChange={(event) => {
              onChange(setFilter(filters, 'q', event.target.value));
            }}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="inbox-bot">{strings.conversations.bot}</Label>
          <NativeSelect
            id="inbox-bot"
            value={filters.botId ?? ''}
            onChange={(event) => {
              onChange(setFilter(filters, 'botId', event.target.value));
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
        <div className="space-y-2">
          <Label htmlFor="inbox-status">{strings.conversations.status}</Label>
          <NativeSelect
            id="inbox-status"
            value={filters.status ?? ''}
            onChange={(event) => {
              onChange(setFilter(filters, 'status', event.target.value));
            }}
          >
            <option value="">{strings.conversations.allStatuses}</option>
            {CONVERSATION_STATUSES.map((status) => (
              <option key={status} value={status}>
                {strings.conversations.statuses[status]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-2">
          <Label htmlFor="inbox-assignee">{strings.conversations.assigned}</Label>
          <NativeSelect
            id="inbox-assignee"
            value={filters.assignedTo ?? ''}
            onChange={(event) => {
              onChange(setFilter(filters, 'assignedTo', event.target.value));
            }}
          >
            <option value="">{strings.conversations.anyone}</option>
            <option value="me">{strings.conversations.me}</option>
            <option value="none">{strings.conversations.unassigned}</option>
          </NativeSelect>
        </div>
        <div className="space-y-2">
          <Label htmlFor="inbox-priority">{strings.conversations.priority}</Label>
          <NativeSelect
            id="inbox-priority"
            value={filters.priority ?? ''}
            onChange={(event) => {
              onChange(setFilter(filters, 'priority', event.target.value));
            }}
          >
            <option value="">{strings.conversations.allPriorities}</option>
            {PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {strings.conversations.priorities[priority]}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
    </form>
  );
}
