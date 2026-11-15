// SPDX-License-Identifier: AGPL-3.0-only
import { FormAlert } from '@/components/form-alert';
import { Button } from '@/components/ui/button';
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
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{strings.conversations.title}</h1>
          <p className="text-sm text-muted-foreground">{strings.conversations.intro}</p>
        </div>
        <NotificationToggle />
      </header>

      <InboxFilters workspaceId={workspaceId} filters={filters} onChange={onFiltersChange} />
      <FormAlert message={errorMessage(conversations.error)} />

      {conversations.isLoading ? (
        <p role="status">{strings.app.loading}</p>
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
