// SPDX-License-Identifier: AGPL-3.0-only
import { FormAlert } from '@/components/form-alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';

import { type InboxFilters as Filters, useConversations } from '../api';
import { ConversationList } from './conversation-list';
import { InboxFilters } from './inbox-filters';
import { NotificationToggle } from './notification-toggle';

/** The live inbox page body; filters are owned by the route and stored in the URL. */
export function Inbox({
  workspaceId,
  filters,
  onFiltersChange,
}: {
  workspaceId: string;
  filters: Filters;
  onFiltersChange: (next: Filters) => void;
}) {
  const conversations = useConversations(workspaceId, filters);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="ledger-heading text-3xl">{strings.conversations.title}</h1>
          <p className="text-sm text-muted-foreground">{strings.conversations.intro}</p>
        </div>
        <NotificationToggle />
      </header>

      <InboxFilters workspaceId={workspaceId} filters={filters} onChange={onFiltersChange} />
      <FormAlert message={errorMessage(conversations.error)} />

      {conversations.isLoading ? (
        <div
          className="ledger-panel overflow-hidden"
          role="status"
          aria-label={strings.app.loading}
        >
          <div className="flex min-h-11 items-center border-b border-border bg-secondary px-4 text-xs font-medium text-muted-foreground">
            {strings.app.loading}
          </div>
          <div className="space-y-4 p-4">
            {Array.from({ length: 5 }, (_, index) => (
              <div
                key={index}
                className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] items-center gap-4"
              >
                <Skeleton className="h-10 w-full max-w-56" />
                <Skeleton className="h-10 w-full" />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <>
          <ConversationList
            workspaceId={workspaceId}
            conversations={conversations.data?.data ?? []}
            filters={filters}
          />
          {conversations.data?.nextCursor !== null &&
          conversations.data?.nextCursor !== undefined ? (
            <Button
              variant="outline"
              onClick={() => {
                onFiltersChange({ ...filters, cursor: conversations.data?.nextCursor ?? '' });
              }}
            >
              {strings.app.nextPage}
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}
